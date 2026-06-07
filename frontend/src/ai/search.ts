/**
 * search.ts — Alpha-Beta Search Engine for Nexus Gravity Chess
 *
 * Implements iterative-deepening Alpha-Beta with:
 *   - Transposition table (LRU, 10 000 entries) for position reuse
 *   - Move ordering heuristics (push > toward-d4 > capture-like)
 *   - Quiescence search (optional shallow extension)
 *   - Depth limits tied to AI strength level
 *   - Core evolution and Anchor overload awareness
 */

import {
  BoardGrid,
  Move,
  Color,
  Position,
  PieceType,
  GameStatus,
  opponentColor,
  posEquals,
  posToString,
  CENTER,
} from '../engine/types';
import { Game } from '../engine/game';
import { MoveGenerator } from '../engine/movegen';
import { RuleEngine } from '../engine/rules';
import { evaluate, evaluateWithState } from './evaluate';
import { dqnEvaluate, isDQNLoaded } from './dqnEval';
import { getControlZone, isLocked, isCoreEvolved } from '../engine/gravity';
import { getPieces, getCore, boardToArray } from '../engine/board';

// ─── AI Difficulty ────────────────────────────────────────────────────────────

export type AiDifficulty = 'beginner' | 'intermediate' | 'advanced';

const DIFFICULTY_DEPTH: Record<AiDifficulty, number> = {
  beginner: 1,
  intermediate: 3,
  advanced: 6, // Increased from 4 → 6 with transposition table support
};

const DIFFICULTY_TIME_MS: Record<AiDifficulty, number> = {
  beginner: 150,
  intermediate: 800,
  advanced: 2500,
};

// ─── Transposition Table ──────────────────────────────────────────────────────

interface TTEntry {
  /** Search depth this entry was recorded at */
  depth: number;
  /** Centipawn score */
  score: number;
  /** Best move found at this position */
  move: Move | null;
  /** Bound type */
  flag: 'exact' | 'alpha' | 'beta';
}

const TT_MAX_SIZE = 10000;
const TT_EVICT_COUNT = 1000;

/**
 * Transposition Table using a Map with simple LRU-like eviction.
 *
 * Because Map preserves insertion order, deleting the first N keys
 * removes the least-recently-inserted entries.
 */
class TranspositionTable {
  private table: Map<string, TTEntry> = new Map();

  /** Retrieve a cached entry (if any). */
  get(key: string): TTEntry | undefined {
    return this.table.get(key);
  }

  /** Store an entry, evicting old ones if at capacity. */
  set(key: string, entry: TTEntry): void {
    // LRU eviction: delete the oldest entries when near capacity
    if (this.table.size >= TT_MAX_SIZE) {
      let count = 0;
      for (const k of this.table.keys()) {
        this.table.delete(k);
        count++;
        if (count >= TT_EVICT_COUNT) break;
      }
    }
    this.table.set(key, entry);
  }

  /** Clear all entries. */
  clear(): void {
    this.table.clear();
  }

  /** Number of entries currently stored. */
  get size(): number {
    return this.table.size;
  }
}

/** Shared transposition table instance (one per search invocation). */
let tt: TranspositionTable = new TranspositionTable();
let ttHitCount = 0;
let killerMoves: Array<[Move | null, Move | null]> = [];
let historyHeuristic: Map<string, number> = new Map();

// ─── Search Result ────────────────────────────────────────────────────────────

export interface SearchResult {
  /** The best move found */
  bestMove: Move | null;
  /** Evaluation of the best move (centipawn-like) */
  score: number;
  /** Number of nodes searched */
  nodesSearched: number;
  /** Depth actually reached */
  depth: number;
  /** Number of transposition table hits */
  ttHits: number;
}

// ─── Search Function ─────────────────────────────────────────────────────────

/**
 * Run Alpha-Beta search from the current game state for the given color.
 *
 * @param game     The current Game instance (will not be mutated).
 * @param color    The AI's color (the maximizing side).
 * @param difficulty Controls search depth.
 */
export function search(
  game: Game,
  color: Color,
  difficulty: AiDifficulty = 'intermediate',
): SearchResult {
  const maxDepth = DIFFICULTY_DEPTH[difficulty];
  const deadline = Date.now() + DIFFICULTY_TIME_MS[difficulty];
  const state = game.state;
  const moves = MoveGenerator.generateMoves(state, color);

  if (moves.length === 0) {
    return {
      bestMove: null,
      score: -9999,
      nodesSearched: 0,
      depth: 0,
      ttHits: 0,
    };
  }

  // Fresh transposition table for each search
  tt = new TranspositionTable();
  ttHitCount = 0;
  killerMoves = Array.from({ length: maxDepth + 2 }, () => [null, null]);
  historyHeuristic = new Map();

  // Order moves for better pruning
  const orderedMoves = orderMoves(moves, state.board, color);

  let bestMove: Move = orderedMoves[0];
  let bestScore = -Infinity;
  let nodesSearched = 0;
  let reachedDepth = 0;

  const runRoot = (depth: number, alphaStart: number, betaStart: number): { move: Move; score: number } => {
    let alpha = alphaStart;
    const beta = betaStart;
    let depthBestMove: Move = orderedMoves[0];
    let depthBestScore = -Infinity;

    for (const move of orderedMoves) {
      if (Date.now() >= deadline) {
        break;
      }
      const clone = cloneGame(game);
      const result = clone.makeMoveFast(move);

      if (!result.success) {
        continue;
      }

      nodesSearched++;

      if (result.gameOver) {
        const winner = clone.state.winner;
        let score: number;
        if (winner === color) {
          score = 9000 + depth;
        } else if (winner === null) {
          score = 0;
        } else {
          score = -9000 - depth;
        }
        if (score > depthBestScore) {
          depthBestScore = score;
          depthBestMove = move;
        }
        alpha = Math.max(alpha, score);
        continue;
      }

      const score = -alphaBeta(
        clone,
        depth - 1,
        -beta,
        -alpha,
        opponentColor(color),
        deadline,
        1,
      );

      nodesSearched += 1;

      if (score > depthBestScore) {
        depthBestScore = score;
        depthBestMove = move;
      }
      alpha = Math.max(alpha, score);
    }

    return { move: depthBestMove, score: depthBestScore };
  };

  // Iterative deepening
  for (let depth = 1; depth <= maxDepth; depth++) {
    if (Date.now() >= deadline) {
      break;
    }
    let alpha = -Infinity;
    let beta = Infinity;
    if (depth > 1 && Number.isFinite(bestScore)) {
      alpha = bestScore - 60;
      beta = bestScore + 60;
    }

    let root = runRoot(depth, alpha, beta);
    if (root.score <= alpha || root.score >= beta) {
      root = runRoot(depth, -Infinity, Infinity);
    }

    if (Date.now() >= deadline) {
      break;
    }
    // Carry forward best from this depth iteration
    bestScore = root.score;
    bestMove = root.move;
    reachedDepth = depth;

    const pvIdx = orderedMoves.findIndex((m) => posEquals(m.from, bestMove.from) && posEquals(m.to, bestMove.to));
    if (pvIdx > 0) {
      const [pv] = orderedMoves.splice(pvIdx, 1);
      orderedMoves.unshift(pv);
    }
  }

  return {
    bestMove,
    score: bestScore,
    nodesSearched,
    depth: reachedDepth,
    ttHits: ttHitCount,
  };
}

// ─── Alpha-Beta Recursion ────────────────────────────────────────────────────

/**
 * Standard negamax-style Alpha-Beta recursion with transposition table.
 *
 * @param game   Clone of the game in a post-move state.
 * @param depth  Remaining depth to search.
 * @param alpha  Lower bound.
 * @param beta   Upper bound.
 * @param color  The side that is currently maximizing.
 */
function alphaBeta(
  game: Game,
  depth: number,
  alpha: number,
  beta: number,
  color: Color,
  deadline: number,
  ply: number,
): number {
  if (Date.now() >= deadline) {
    return evaluateWithState(
      game.state.board,
      color,
      game.state.anchorOverloadTracker,
    );
  }
  // ── Transposition Table Probe ────────────────────────────────────────────
  const posKey = ttKey(game);
  const ttEntry = tt.get(posKey);

  if (ttEntry !== undefined && ttEntry.depth >= depth) {
    ttHitCount++;
    if (ttEntry.flag === 'exact') {
      return ttEntry.score;
    }
    if (ttEntry.flag === 'alpha' && ttEntry.score <= alpha) {
      return alpha;
    }
    if (ttEntry.flag === 'beta' && ttEntry.score >= beta) {
      return beta;
    }
  }

  // ── Terminal: depth zero → evaluate ──────────────────────────────────────
  if (depth <= 0) {
    return evaluateWithState(
      game.state.board,
      color,
      game.state.anchorOverloadTracker,
    );
  }

  // ── Terminal: game over ──────────────────────────────────────────────────
  if (game.state.status !== GameStatus.IN_PROGRESS) {
    const winner = game.state.winner;
    if (winner === color) return 9000 + depth;
    if (winner === null) return 0;
    return -9000 - depth;
  }

  // ── Generate & order moves ───────────────────────────────────────────────
  const moves = MoveGenerator.generateMoves(game.state, color);

  // No legal moves → check game result
  if (moves.length === 0) {
    const result = RuleEngine.getGameResult(game.state, false);
    if (result.status === GameStatus.DRAW) return 0;
    if (result.winner === color) return 9000;
    return -9000;
  }

  // Try TT best-move first if available
  const orderedMoves = orderMovesInternal(moves, game.state.board, color, historyHeuristic);
  if (ttEntry !== undefined && ttEntry.move !== null) {
    // Move TT best move to front of the list
    const ttMoveIdx = orderedMoves.findIndex(
      (m) =>
        posEquals(m.from, ttEntry.move!.from) &&
        posEquals(m.to, ttEntry.move!.to),
    );
    if (ttMoveIdx > 0) {
      const [ttMove] = orderedMoves.splice(ttMoveIdx, 1);
      orderedMoves.unshift(ttMove);
    }
  }

  const killers = killerMoves[ply];
  if (killers !== undefined) {
    for (const km of killers) {
      if (km === null) continue;
      const idx = orderedMoves.findIndex((m) => posEquals(m.from, km.from) && posEquals(m.to, km.to));
      if (idx > 0) {
        const [k] = orderedMoves.splice(idx, 1);
        orderedMoves.unshift(k);
      }
    }
  }

  // ── Search ───────────────────────────────────────────────────────────────
  let bestVal = -Infinity;
  let bestMove: Move | null = null;
  const originalAlpha = alpha;

  for (const move of orderedMoves) {
    const clone = cloneGame(game);
    const moveResult = clone.makeMoveFast(move);

    if (!moveResult.success) {
      continue;
    }

    let score: number;
    if (moveResult.gameOver) {
      const winner = clone.state.winner;
      if (winner === color) {
        score = 9000 + depth;
      } else if (winner === null) {
        score = 0;
      } else {
        score = -9000 - depth;
      }
    } else {
      score = -alphaBeta(
        clone,
        depth - 1,
        -beta,
        -alpha,
        opponentColor(color),
        deadline,
        ply + 1,
      );
    }

    if (score > bestVal) {
      bestVal = score;
      bestMove = move;
    }
    alpha = Math.max(alpha, score);

    if (alpha >= beta) {
      if (bestMove !== null) {
        const pair = killerMoves[ply];
        if (pair !== undefined) {
          if (pair[0] === null || !posEquals(pair[0].from, bestMove.from) || !posEquals(pair[0].to, bestMove.to)) {
            pair[1] = pair[0];
            pair[0] = bestMove;
          }
        }
        const hk = moveHistoryKey(bestMove);
        historyHeuristic.set(hk, (historyHeuristic.get(hk) ?? 0) + depth * depth);
      }
      break; // Beta cutoff
    }
  }

  // ── Store in transposition table ─────────────────────────────────────────
  const flag: 'exact' | 'alpha' | 'beta' =
    bestVal <= originalAlpha ? 'alpha' : bestVal >= beta ? 'beta' : 'exact';

  tt.set(posKey, { depth, score: bestVal, move: bestMove, flag });

  return bestVal;
}

// ─── Move Ordering ───────────────────────────────────────────────────────────

/**
 * Order moves to improve Alpha-Beta pruning efficiency.
 *
 * Priority order:
 *   1. Push moves (displace enemy core) — highest tactical value
 *   2. Moves toward d4 (sanctuary victory)
 *   3. Core moves (positional importance)
 *   4. Core moves that evolve (reach row 3)
 *   5. Moves into enemy control zone (aggression)
 *   6. Everything else
 */
function orderMoves(moves: Move[], board: BoardGrid, color: Color): Move[] {
  return orderMovesInternal(moves, board, color, undefined);
}

function orderMovesInternal(
  moves: Move[],
  board: BoardGrid,
  color: Color,
  history: Map<string, number> | undefined,
): Move[] {
  const enemyColor = opponentColor(color);
  const myZone = getControlZone(board, color);
  const enemyZone = getControlZone(board, enemyColor);

  const scored: Array<{ move: Move; score: number }> = moves.map((move) => {
    let score = 0;

    // 1. Push moves
    if (move.flag === 1) {
      score += 1000;
    }

    // 2. Toward d4
    const fromDist = manhattanDist(move.from, CENTER);
    const toDist = manhattanDist(move.to, CENTER);
    if (toDist < fromDist) {
      score += 100;
    }

    // 3. Core moves
    if (move.piece.type === PieceType.CORE) {
      score += 50;

      // 4. Core evolving (reaching row 3)
      if (move.to.row === 3) {
        score += 80; // CORE_EVOLVED_BONUS value
      }
    }

    // 5. Anchor escaping enemy zone (avoid overload)
    if (move.piece.type === PieceType.ANCHOR) {
      const fromKey = posToString(move.from);
      const toKey = posToString(move.to);
      if (enemyZone.has(fromKey) && !enemyZone.has(toKey)) {
        // Escaping enemy zone — high priority to avoid overload
        score += 200;
      }
    }

    // 6. Moves into enemy control zone (aggression)
    const toKey = posToString(move.to);
    if (enemyZone.has(toKey)) {
      score -= 30; // Slightly penalize moving into danger
    }

    // 7. Moves that gain control of d4 neighbours
    const d4Dist = manhattanDist(move.to, CENTER);
    if (d4Dist <= 1) {
      score += 40;
    }

    if (history !== undefined) {
      const h = history.get(moveHistoryKey(move)) ?? 0;
      score += Math.min(400, Math.floor(h / 4));
    }

    return { move, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.move);
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function manhattanDist(a: Position, b: Position): number {
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

function cloneGame(game: Game): Game {
  const clone = new Game();
  clone.state = game.state.clone();
  // Suppress callbacks during search
  clone.onStateChange = undefined;
  clone.onGameOver = undefined;
  return clone;
}

function moveHistoryKey(move: Move): string {
  return `${move.piece.type}${posToString(move.from)}${posToString(move.to)}`;
}

function ttKey(game: Game): string {
  const state = game.state;
  const boardKey = boardToArray(state.board).join('');
  const turnKey = state.turn === Color.WHITE ? 'w' : 'b';
  const cw = state.coreCooldown.get(Color.WHITE) === true ? '1' : '0';
  const cb = state.coreCooldown.get(Color.BLACK) === true ? '1' : '0';
  const sanctuaryKey =
    state.sanctuaryOccupied === Color.WHITE
      ? 'w'
      : state.sanctuaryOccupied === Color.BLACK
        ? 'b'
        : '-';

  let trackerKey = '';
  if (state.anchorOverloadTracker.size > 0) {
    const entries = Array.from(state.anchorOverloadTracker.entries());
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    trackerKey = entries.map(([k, v]) => `${k}:${v}`).join(',');
  }

  return `${boardKey}|${turnKey}|${cw}${cb}|${sanctuaryKey}|${trackerKey}`;
}

// ─── Quick Evaluation for Debug ──────────────────────────────────────────────

/**
 * Print evaluation range info to console for verification.
 */
export function debugEvalRange(): void {
  const game = new Game();
  const board = game.state.board;

  const whiteScore = evaluate(board, Color.WHITE);
  const blackScore = evaluate(board, Color.BLACK);
  const symmetry = whiteScore + blackScore;

  console.log('[AI Debug] Evaluation Range Check:');
  console.log(`  White eval: ${whiteScore}`);
  console.log(`  Black eval: ${blackScore}`);
  console.log(`  Symmetry check (should be ~0): ${symmetry}`);
  console.log(`  Eval range: -1000 to +1000 nominal`);

  // Check if AI understands sanctuary goal
  // Move white core one step toward d4 and see if score improves
  const testGame = new Game();
  const whiteMoves = MoveGenerator.generateMoves(testGame.state, Color.WHITE);
  const d4Moves = whiteMoves.filter(
    (m) =>
      m.piece.type === PieceType.CORE &&
      manhattanDist(m.to, CENTER) < manhattanDist(m.from, CENTER),
  );
  if (d4Moves.length > 0) {
    const beforeEval = evaluate(testGame.state.board, Color.WHITE);
    testGame.makeMove(d4Moves[0].from, d4Moves[0].to);
    const afterEval = evaluate(testGame.state.board, Color.WHITE);
    const delta = afterEval - beforeEval;
    console.log(
      `  Core-toward-d4: ${beforeEval} → ${afterEval} (delta=${delta})`,
    );
    if (afterEval > beforeEval) {
      console.log('  ✅ AI correctly prefers advancing core toward d4');
    } else {
      console.log('  ⚠️  AI may not prefer advancing core toward d4');
    }
  }
}
