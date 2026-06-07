/**
 * evaluate.ts — Gravity-Lock AI Evaluation Function
 *
 * Scores a board position from the perspective of `color`.
 * Higher score = better for `color`.
 *
 * Two-tier architecture:
 *   1. If NNUE WASM is available → delegates to nnueBridge.evaluate()
 *   2. Otherwise → uses the manual heuristic evaluation below
 *
 * Manual evaluation dimensions:
 *   1. Control zone area (每方控制格子数)
 *   2. Core safety (核心8邻域中被己方控制的格子数)
 *   3. Core proximity to d4 (接近d4的距离奖励)
 *   4. Core evolved bonus (核心到达中行进化)
 *   5. Enemy core locked (敌方核心被锁定 = 大奖励)
 *   6. Anchor survival count (锚点存活数)
 *   7. Anchor locked penalty (锚点被锁扣分)
 *   8. Anchor overload threat (敌方锚点过载倒计时奖励)
 *   9. Flux activity (流子活跃度)
 */

import {
  BoardGrid,
  Piece,
  PieceType,
  Color,
  Position,
  CENTER,
  CORE_EVOLVE_ROW,
  posToString,
  posEquals,
  opponentColor,
  overloadKey,
  isValidPosition,
} from '../engine/types';
import { getPieces, getCore, createInitialBoard } from '../engine/board';
import {
  getControlZone,
  isLocked,
  isCoreEvolved,
  ALL_DIRECTIONS,
} from '../engine/gravity';
import { nnueBridge } from './nnueBridge';

// ─── Scoring Weights ──────────────────────────────────────────────────────────

const WEIGHTS = {
  /** Points per square in control zone */
  CONTROL_AREA: 3,
  /** Points per controlled square in core's 8-neighbourhood */
  CORE_SAFETY: 25,
  /**
   * Points per step closer to d4 (inverted: 6 - manhattanDistance).
   * Weight is calibrated to 15 so that proximity alone does not overwhelm
   * the positional evaluation — the strong incentive to occupy d4 comes
   * from CORE_ON_D4 (500) and D4_PRESSURE_BONUS (25 per overlapping neighbor).
   */
  CORE_D4_PROXIMITY: 15,
  /** Bonus when enemy core is locked */
  ENEMY_CORE_LOCKED: 300,
  /** Points per surviving anchor */
  ANCHOR_SURVIVAL: 80,
  /** Points per flux that is not locked */
  FLUX_ACTIVITY: 15,
  /** Bonus for controlling d4 neighbour squares (via control zone) */
  D4_PRESSURE: 20,
  /**
   * Bonus per square in the core's 8-neighbourhood that is ALSO adjacent to d4.
   * This creates a smooth gradient that rewards approaching the sanctuary.
   */
  D4_PRESSURE_BONUS: 25,
  /** Bonus when own core is on d4 */
  CORE_ON_D4: 500,
  /** Penalty when own core is locked */
  OWN_CORE_LOCKED: -400,
  /** Bonus when own Core is evolved (on row 3, control zone expanded) */
  CORE_EVOLVED_BONUS: 80,
  /** Penalty per own Anchor that is currently locked in enemy zone */
  ANCHOR_LOCKED_PENALTY: -60,
  /** Bonus per enemy Anchor that has overload counter >= 1 (threat of removal) */
  ANCHOR_OVERLOAD_THREAT: 40,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Evaluate the board position from `color`'s perspective.
 *
 * Tier 1: NNUE WASM (if available) — fast, neural-network-based evaluation.
 * Tier 2: Manual heuristic (fallback) — hand-crafted evaluation function.
 *
 * @returns Centipawn-like score (higher = better for `color`).
 */
export function evaluate(board: BoardGrid, color: Color): number {
  // Tier 1: Try NNUE WASM
  if (nnueBridge.isAvailable()) {
    try {
      return nnueBridge.evaluate(board, color);
    } catch (err) {
      console.warn(
        '[evaluate] NNUE WASM evaluate failed — falling back to manual:',
        err,
      );
    }
  }

  // Tier 2: Manual heuristic evaluation
  return evaluateManual(board, color);
}

/**
 * Returns whether the evaluator is currently using the NNUE neural network
 * (true) or the fallback manual heuristic (false).
 */
export function useNNUE(): boolean {
  return nnueBridge.isAvailable();
}

// ─── Manual Evaluation ────────────────────────────────────────────────────────

/**
 * Manual heuristic evaluation function.
 *
 * This is the pure hand-crafted evaluator — extracted so that tests
 * can verify its behaviour independently of WASM availability.
 */
export function evaluateManual(board: BoardGrid, color: Color): number {
  const enemyColor = opponentColor(color);
  const myZone = getControlZone(board, color);
  const enemyZone = getControlZone(board, enemyColor);

  let score = 0;

  // 1. Control zone area
  score += myZone.size * WEIGHTS.CONTROL_AREA;
  score -= enemyZone.size * WEIGHTS.CONTROL_AREA;

  // 2. Core safety
  try {
    const myCore = getCore(board, color);
    score += evaluateCoreSafety(myCore, myZone, enemyZone, board, color);
  } catch {
    // Core not found — extremely bad
    score -= 10000;
  }

  // 3. Enemy core status
  try {
    const enemyCore = getCore(board, enemyColor);
    score += evaluateEnemyCoreStatus(enemyCore, myZone, enemyZone, board, color);
  } catch {
    // Enemy core not found — extremely good
    score += 10000;
  }

  // 4. Anchor survival count and lock status
  score += evaluateAnchorStatus(board, color, myZone, enemyZone);

  // 5. Flux activity
  score += evaluateFluxActivity(board, color, myZone, enemyZone);

  // 6. d4 pressure (control zone based)
  score += evaluateD4Pressure(myZone, enemyZone, board, color);

  return score;
}

/**
 * Evaluate the board position with explicit overload tracker context.
 * Used by AI search when the GameState is available (provides more accurate
 * anchor overload evaluation).
 */
export function evaluateWithState(
  board: BoardGrid,
  color: Color,
  anchorOverloadTracker?: Map<string, number>,
): number {
  let score = evaluate(board, color);

  // Add anchor overload threat evaluation if tracker is available
  if (anchorOverloadTracker !== undefined && anchorOverloadTracker.size > 0) {
    const enemyColor = opponentColor(color);
    const enemyAnchors = getPieces(board, enemyColor).filter(
      (p: Piece) => p.type === PieceType.ANCHOR,
    );
    for (const anchor of enemyAnchors) {
      const key = overloadKey(anchor.pos.col, anchor.pos.row);
      const count = anchorOverloadTracker.get(key) ?? 0;
      if (count >= 1) {
        score += WEIGHTS.ANCHOR_OVERLOAD_THREAT * count;
      }
    }
  }

  return score;
}

// ─── Sub-evaluators ───────────────────────────────────────────────────────────

/**
 * Evaluate the safety of our core.
 *
 * Key changes from v1:
 *   - d4 proximity uses weight 15 (down from 40) to avoid positional noise.
 *   - New D4_PRESSURE_BONUS (25) is added per core neighbour that touches d4.
 *   - Core safety (controlled neighbours) still at 25 per.
 */
function evaluateCoreSafety(
  core: Piece,
  myZone: Set<string>,
  _enemyZone: Set<string>,
  board: BoardGrid,
  color: Color,
): number {
  let score = 0;

  // Count controlled neighbours
  let controlledNeighbours = 0;
  for (const dir of ALL_DIRECTIONS) {
    const nb: Position = {
      col: core.pos.col + dir.col,
      row: core.pos.row + dir.row,
    };
    const nbKey = posToString(nb);
    if (myZone.has(nbKey)) {
      controlledNeighbours++;
    }
  }
  score += controlledNeighbours * WEIGHTS.CORE_SAFETY;

  // Proximity to d4 (Manhattan distance) — calibrated weight 15
  const distToD4 =
    Math.abs(core.pos.col - CENTER.col) + Math.abs(core.pos.row - CENTER.row);
  // Max distance on 7x7 board from d4 is 6 (corner to center)
  score += (6 - distToD4) * WEIGHTS.CORE_D4_PROXIMITY;

  // Core on d4 = huge bonus
  if (posEquals(core.pos, CENTER)) {
    score += WEIGHTS.CORE_ON_D4;
  }

  // Core evolved bonus (on row 3 → expanded control zone)
  if (isCoreEvolved(core)) {
    score += WEIGHTS.CORE_EVOLVED_BONUS;
  }

  // D4 Pressure Bonus: for each square in the core's 8-neighbourhood
  // that is also a neighbour of d4 (Manhattan distance == 1 from CENTER),
  // add D4_PRESSURE_BONUS.
  // This creates a smooth gradient: the closer the core gets to d4,
  // the more its control overlaps with the sanctuary perimeter.
  let d4PressureCount = 0;
  for (const dir of ALL_DIRECTIONS) {
    const nb: Position = {
      col: core.pos.col + dir.col,
      row: core.pos.row + dir.row,
    };
    if (!isValidPosition(nb)) {
      continue;
    }
    const nbDistToD4 =
      Math.abs(nb.col - CENTER.col) + Math.abs(nb.row - CENTER.row);
    if (nbDistToD4 === 1) {
      d4PressureCount++;
    }
  }
  score += d4PressureCount * WEIGHTS.D4_PRESSURE_BONUS;

  // Core locked penalty
  const locked = isLocked(core, board, myZone, _enemyZone);
  if (locked) {
    score += WEIGHTS.OWN_CORE_LOCKED;
  }

  return score;
}

/**
 * Evaluate the enemy core's status.
 * Rewards locking the enemy core and pushing it away from d4.
 */
function evaluateEnemyCoreStatus(
  enemyCore: Piece,
  myZone: Set<string>,
  enemyZone: Set<string>,
  board: BoardGrid,
  color: Color,
): number {
  let score = 0;

  // Bonus if enemy core is locked
  const enemyColor = opponentColor(color);
  const locked = isLocked(enemyCore, board, enemyZone, myZone);
  if (locked) {
    score += WEIGHTS.ENEMY_CORE_LOCKED;
  }

  // Penalty if enemy core is close to d4
  const distToD4 =
    Math.abs(enemyCore.pos.col - CENTER.col) +
    Math.abs(enemyCore.pos.row - CENTER.row);
  score -= (6 - distToD4) * WEIGHTS.CORE_D4_PROXIMITY * 0.5;

  // Penalty if enemy core is evolved (on row 3 with expanded control)
  if (isCoreEvolved(enemyCore)) {
    score -= WEIGHTS.CORE_EVOLVED_BONUS * 0.5;
  }

  // Penalize enemy core's own controlled neighbours (symmetry with our evaluateCoreSafety).
  // Without this penalty, the evaluation has a bias favoring both sides
  // simultaneously on symmetric positions.
  let enemyControlledNeighbours = 0;
  for (const dir of ALL_DIRECTIONS) {
    const nb: Position = {
      col: enemyCore.pos.col + dir.col,
      row: enemyCore.pos.row + dir.row,
    };
    const nbKey = posToString(nb);
    if (enemyZone.has(nbKey)) {
      enemyControlledNeighbours++;
    }
  }
  score -= enemyControlledNeighbours * WEIGHTS.CORE_SAFETY;

  // Count how many of enemy core's neighbours we control (siege pressure)
  let siegePressure = 0;
  for (const dir of ALL_DIRECTIONS) {
    const nb: Position = {
      col: enemyCore.pos.col + dir.col,
      row: enemyCore.pos.row + dir.row,
    };
    const nbKey = posToString(nb);
    if (myZone.has(nbKey)) {
      siegePressure++;
    }
  }
  score += siegePressure * WEIGHTS.CORE_SAFETY * 0.8;

  return score;
}

/**
 * Evaluate anchor status: count, lock status, and overload threat.
 */
function evaluateAnchorStatus(
  board: BoardGrid,
  color: Color,
  myZone: Set<string>,
  enemyZone: Set<string>,
): number {
  let score = 0;
  const enemyColor = opponentColor(color);

  const myPieces = getPieces(board, color);
  const enemyPieces = getPieces(board, enemyColor);

  const myAnchors = myPieces.filter((p: Piece) => p.type === PieceType.ANCHOR);
  const enemyAnchors = enemyPieces.filter((p: Piece) => p.type === PieceType.ANCHOR);

  // Anchor survival count
  score += myAnchors.length * WEIGHTS.ANCHOR_SURVIVAL;
  score -= enemyAnchors.length * WEIGHTS.ANCHOR_SURVIVAL;

  // Anchor locked penalty (own anchors in enemy zone)
  for (const anchor of myAnchors) {
    const posKey = posToString(anchor.pos);
    if (enemyZone.has(posKey)) {
      score += WEIGHTS.ANCHOR_LOCKED_PENALTY;
    }
  }

  // Enemy anchors that are in our control zone (counterpart)
  for (const anchor of enemyAnchors) {
    const posKey = posToString(anchor.pos);
    if (myZone.has(posKey)) {
      score -= WEIGHTS.ANCHOR_LOCKED_PENALTY; // good for us
    }
  }

  return score;
}

/**
 * Evaluate flux activity: reward having unlocked (mobile) fluxes.
 */
function evaluateFluxActivity(
  board: BoardGrid,
  color: Color,
  myZone: Set<string>,
  enemyZone: Set<string>,
): number {
  let score = 0;

  const myFluxes = getPieces(board, color).filter(
    (p) => p.type === PieceType.FLUX,
  );
  const enemyColor = opponentColor(color);
  const enemyFluxes = getPieces(board, enemyColor).filter(
    (p) => p.type === PieceType.FLUX,
  );

  // Count unlocked fluxes (flux is immune, so always unlocked)
  // Activity = number of valid landing spots
  for (const flux of myFluxes) {
    let landingSpots = 0;
    for (const dir of ALL_DIRECTIONS) {
      const p: Position = {
        col: flux.pos.col + dir.col * 2,
        row: flux.pos.row + dir.row * 2,
      };
      // Quick bounds check (without needing board lookup for fast eval)
      if (
        p.col >= 0 && p.col < 7 &&
        p.row >= 0 && p.row < 7 &&
        board[p.row][p.col] === null
      ) {
        landingSpots++;
      }
    }
    score += landingSpots * WEIGHTS.FLUX_ACTIVITY;
  }

  for (const flux of enemyFluxes) {
    let landingSpots = 0;
    for (const dir of ALL_DIRECTIONS) {
      const p: Position = {
        col: flux.pos.col + dir.col * 2,
        row: flux.pos.row + dir.row * 2,
      };
      if (
        p.col >= 0 && p.col < 7 &&
        p.row >= 0 && p.row < 7 &&
        board[p.row][p.col] === null
      ) {
        landingSpots++;
      }
    }
    score -= landingSpots * WEIGHTS.FLUX_ACTIVITY;
  }

  return score;
}

/**
 * Evaluate d4 sanctuary pressure.
 * Rewards controlling squares adjacent to d4.
 */
function evaluateD4Pressure(
  myZone: Set<string>,
  enemyZone: Set<string>,
  board: BoardGrid,
  color: Color,
): number {
  let score = 0;

  // d4 neighbours
  for (const dir of ALL_DIRECTIONS) {
    const nb: Position = {
      col: CENTER.col + dir.col,
      row: CENTER.row + dir.row,
    };
    if (nb.col < 0 || nb.col >= 7 || nb.row < 0 || nb.row >= 7) {
      continue;
    }
    const nbKey = posToString(nb);
    if (myZone.has(nbKey)) {
      score += WEIGHTS.D4_PRESSURE;
    }
    if (enemyZone.has(nbKey)) {
      score -= WEIGHTS.D4_PRESSURE;
    }
  }

  return score;
}

// ─── Manhattan Distance Utility ───────────────────────────────────────────────

function manhattanDist(a: Position, b: Position): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

// ─── Evaluation Self-Test ─────────────────────────────────────────────────────

/**
 * Run a set of self-consistency checks on the manual evaluation function.
 *
 * Tests:
 *   1. Initial position → eval ≈ 0 (symmetric balance)
 *   2. White core moves 1 step toward d4 → eval delta > 0
 *   3. White core on d4 → eval > 500 (clear advantage)
 *
 * @returns Object with `passed` flag and list of `details` strings.
 */
export function runEvalSelfTest(): { passed: boolean; details: string[] } {
  const details: string[] = [];
  let passed = true;

  try {
    // ── Test 1: Initial position eval ≈ 0 ───────────────────────────────
    const initialBoard: BoardGrid = createInitialBoard();
    const initialEval = evaluateManual(initialBoard, Color.WHITE);

    const pass1 = Math.abs(initialEval) <= 50;
    details.push(
      pass1
        ? `  ✅  Test 1 PASS — Initial eval: ${initialEval} (within ±50)`
        : `  ❌  Test 1 FAIL — Initial eval: ${initialEval} (expected ±50)`,
    );
    if (!pass1) passed = false;

    // ── Test 2: Core toward d4 → delta > 0 ─────────────────────────────
    const testBoard2: BoardGrid = createInitialBoard();
    const whiteCore2 = getCore(testBoard2, Color.WHITE);
    const beforeEval = evaluateManual(testBoard2, Color.WHITE);

    // Find a valid square one step closer to d4
    let coreMoveTo: Position | null = null;
    for (const dir of ALL_DIRECTIONS) {
      const candidate: Position = {
        col: whiteCore2.pos.col + dir.col,
        row: whiteCore2.pos.row + dir.row,
      };
      if (!isValidPosition(candidate)) continue;
      if (testBoard2[candidate.row][candidate.col] !== null) continue;
      const candDist = manhattanDist(candidate, CENTER);
      const curDist = manhattanDist(whiteCore2.pos, CENTER);
      if (candDist < curDist) {
        coreMoveTo = candidate;
        break;
      }
    }

    if (coreMoveTo !== null) {
      // Move the core on the test board
      testBoard2[whiteCore2.pos.row][whiteCore2.pos.col] = null;
      const movedCore: Piece = {
        type: PieceType.CORE,
        color: Color.WHITE,
        pos: { col: coreMoveTo.col, row: coreMoveTo.row },
      };
      testBoard2[coreMoveTo.row][coreMoveTo.col] = movedCore;
      const afterEval = evaluateManual(testBoard2, Color.WHITE);
      const delta = afterEval - beforeEval;

      const pass2 = delta > 0;
      details.push(
        pass2
          ? `  ✅  Test 2 PASS — Core-toward-d4: ${beforeEval} → ${afterEval} (delta=${delta})`
          : `  ❌  Test 2 FAIL — Core-toward-d4: ${beforeEval} → ${afterEval} (delta=${delta}, should be >0)`,
      );
      if (!pass2) passed = false;
    } else {
      details.push('  ⚠️  Test 2 SKIP — Could not find a toward-d4 move for the core');
    }

    // ── Test 3: Core on d4 → eval > 500 ────────────────────────────────
    const testBoard3: BoardGrid = createInitialBoard();
    const whiteCore3 = getCore(testBoard3, Color.WHITE);
    // Move white core to d4, clear the destination if occupied
    if (testBoard3[CENTER.row][CENTER.col] !== null) {
      testBoard3[CENTER.row][CENTER.col] = null;
    }
    testBoard3[whiteCore3.pos.row][whiteCore3.pos.col] = null;
    const d4Core: Piece = {
      type: PieceType.CORE,
      color: Color.WHITE,
      pos: { col: CENTER.col, row: CENTER.row },
    };
    testBoard3[CENTER.row][CENTER.col] = d4Core;
    const d4Eval = evaluateManual(testBoard3, Color.WHITE);

    const pass3 = d4Eval > 500;
    details.push(
      pass3
        ? `  ✅  Test 3 PASS — Core on d4 eval: ${d4Eval} ( > 500)`
        : `  ❌  Test 3 FAIL — Core on d4 eval: ${d4Eval} (should be > 500)`,
    );
    if (!pass3) passed = false;
  } catch (err) {
    details.push(`  ❌  ERROR — Self-test threw an exception: ${String(err)}`);
    passed = false;
  }

  return { passed, details };
}

// ─── Public Weight Accessor (for tests) ──────────────────────────────────────

export { WEIGHTS };
