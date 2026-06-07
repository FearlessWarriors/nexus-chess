/**
 * rules.ts — Gravity-Lock Rule Engine
 *
 * Replaces the traditional check/checkmate/stalemate system with:
 *   - Gravity lock detection
 *   - Sanctuary victory (core on d4 for one full turn)
 *   - Siege victory (enemy core trapped: 8-neighbourhood controlled + core locked)
 *   - Push mechanics
 *   - Position repetition draw
 *   - 50-move rule draw
 *   - Anchor overload (anchor trapped 2 consecutive turns → removed)
 */

import {
  BoardGrid,
  Piece,
  PieceType,
  Color,
  Position,
  Move,
  GameState,
  GameStatus,
  BOARD_SIZE,
  CENTER,
  REPETITION_LIMIT,
  FIFTY_MOVE_LIMIT,
  isValidPosition,
  posEquals,
  posToString,
  opponentColor,
  overloadKey,
} from './types';
import {
  getPiece,
  getPieces,
  getCore,
  boardToArray,
} from './board';
import {
  ALL_DIRECTIONS,
  getControlZone,
  isLocked as gravityIsLocked,
} from './gravity';

// ─── Rule Engine ──────────────────────────────────────────────────────────────

export class RuleEngine {
  // ── Lock Detection ───────────────────────────────────────────────────────

  /**
   * Check if a specific piece is locked.
   * Delegates to gravity.ts for the actual computation.
   */
  static isLocked(piece: Piece, state: GameState): boolean {
    return gravityIsLocked(piece, state.board);
  }

  /**
   * Get all locked pieces for the given color.
   */
  static getLockedPieces(state: GameState, color: Color): Piece[] {
    const pieces = getPieces(state.board, color);
    const myZone = getControlZone(state.board, color);
    const enemyColor = opponentColor(color);
    const enemyZone = getControlZone(state.board, enemyColor);

    return pieces.filter((p) => gravityIsLocked(p, state.board, myZone, enemyZone));
  }

  // ── Sanctuary Victory ────────────────────────────────────────────────────

  /**
   * Sanctuary Victory: the given color's core occupies d4 at the start
   * of their turn AND was already on d4 at the start of the previous
   * (their own) turn — meaning it survived one full opponent turn on d4.
   *
   * We track this via state.sanctuaryOccupied: when a turn starts, if
   * the current color's core is on d4 AND sanctuaryOccupied === currentColor,
   * that means the core was there last turn too → victory.
   */
  static isSanctuaryVictory(state: GameState, color: Color): boolean {
    // Must be color's turn
    if (state.turn !== color) {
      return false;
    }
    // Core must be on d4
    const core = getCore(state.board, color);
    if (!posEquals(core.pos, CENTER)) {
      return false;
    }
    // sanctuaryOccupied must equal this color (meaning: last turn start,
    // the core was already on d4)
    if (state.sanctuaryOccupied !== color) {
      return false;
    }
    return true;
  }

  // ── Siege Victory ────────────────────────────────────────────────────────

  /**
   * Siege Victory (困锁胜利): the enemy core is completely trapped.
   *
   * Conditions:
   *   1. Enemy core's 8-neighbourhood is fully covered by our control zone
   *      or occupied by our pieces.
   *   2. Enemy core is locked (in our control zone).
   */
  static isSiegeVictory(state: GameState, color: Color): boolean {
    const enemyColor = opponentColor(color);
    let enemyCore: Piece;
    try {
      enemyCore = getCore(state.board, enemyColor);
    } catch {
      return false;
    }

    const myZone = getControlZone(state.board, color);
    const enemyZone = getControlZone(state.board, enemyColor);

    // Condition 1: all 8 neighbours of the enemy core must be
    // controlled by us OR occupied by our pieces
    for (const dir of ALL_DIRECTIONS) {
      const nb: Position = {
        col: enemyCore.pos.col + dir.col,
        row: enemyCore.pos.row + dir.row,
      };
      if (!isValidPosition(nb)) {
        // Off-board doesn't count against us — skip
        continue;
      }
      const nbKey = posToString(nb);
      const piece = getPiece(state.board, nb.col, nb.row);
      if (piece !== null && piece.color === color) {
        // Occupied by our piece — counts as controlled
        continue;
      }
      if (myZone.has(nbKey)) {
        // In our control zone
        continue;
      }
      // This neighbour is NOT controlled → siege not complete
      return false;
    }

    // Condition 2: enemy core must be locked
    if (!gravityIsLocked(enemyCore, state.board, enemyZone, myZone)) {
      return false;
    }

    return true;
  }

  // ── Push Detection ───────────────────────────────────────────────────────

  /**
   * Check if the given color can push the enemy core this turn.
   *
   * Conditions:
   *   1. Enemy core is inside our control zone
   *   2. At least 6 of the 8 neighbours of the enemy core are in our control zone
   *   3. Enemy core is NOT on d4
   */
  static canPushEnemyCore(state: GameState, color: Color): boolean {
    const enemyColor = opponentColor(color);
    let enemyCore: Piece;
    try {
      enemyCore = getCore(state.board, enemyColor);
    } catch {
      return false;
    }

    // Condition 3: cannot push from d4
    if (posEquals(enemyCore.pos, CENTER)) {
      return false;
    }

    const myZone = getControlZone(state.board, color);
    const coreKey = posToString(enemyCore.pos);

    // Condition 1: enemy core in our control zone
    if (!myZone.has(coreKey)) {
      return false;
    }

    // Condition 2: at least 6 of 8 neighbours in our control zone
    let controlledCount = 0;
    for (const dir of ALL_DIRECTIONS) {
      const nb: Position = {
        col: enemyCore.pos.col + dir.col,
        row: enemyCore.pos.row + dir.row,
      };
      if (!isValidPosition(nb)) {
        continue;
      }
      if (myZone.has(posToString(nb))) {
        controlledCount++;
      }
    }

    return controlledCount >= 6;
  }

  /**
   * Execute a push: move the enemy core to one of its empty adjacent squares.
   * Returns the destination position, or null if no valid push destination.
   *
   * This is a "suggestion" — the actual push happens in game.ts.
   */
  static executePush(
    state: GameState,
    color: Color,
    preferredDest?: Position,
  ): Position | null {
    const enemyColor = opponentColor(color);
    let enemyCore: Piece;
    try {
      enemyCore = getCore(state.board, enemyColor);
    } catch {
      return null;
    }

    // Collect all empty neighbours
    const emptyNeighbours: Position[] = [];
    for (const dir of ALL_DIRECTIONS) {
      const nb: Position = {
        col: enemyCore.pos.col + dir.col,
        row: enemyCore.pos.row + dir.row,
      };
      if (!isValidPosition(nb)) {
        continue;
      }
      const piece = getPiece(state.board, nb.col, nb.row);
      if (piece === null) {
        emptyNeighbours.push(nb);
      }
    }

    if (emptyNeighbours.length === 0) {
      return null; // nowhere to push (should not happen if conditions met)
    }

    // If a preferred destination is specified and valid, use it
    if (preferredDest !== undefined) {
      const found = emptyNeighbours.find(
        (p) => posEquals(p, preferredDest),
      );
      if (found !== undefined) {
        return found;
      }
    }

    // Default: push towards the enemy's own side (away from pusher's side)
    const myBackRank = color === Color.WHITE ? 6 : 0;
    emptyNeighbours.sort((a, b) => {
      const distA = Math.abs(a.row - myBackRank);
      const distB = Math.abs(b.row - myBackRank);
      return distB - distA; // furthest from our back rank first
    });

    return emptyNeighbours[0];
  }

  // ── Repetition Detection ─────────────────────────────────────────────────

  /**
   * Check if the current position has been repeated REPETITION_LIMIT times
   * within the game.
   */
  static isPositionRepeated(state: GameState): boolean {
    const key = boardPositionKey(state);
    const count = state.positionCount.get(key) ?? 0;
    return count >= REPETITION_LIMIT;
  }

  /**
   * Check the 50-move rule: 50 full moves (100 half-moves) without a
   * "substantive" move. Under gravity rules, every non-push move resets
   * the clock (since there are no captures, we treat all non-push moves
   * as "substantive").
   *
   * Actually, we keep the half-move clock: it increments on every move.
   * The 50-move rule triggers after 100 half-moves (50 full moves).
   * In a game without captures, this serves as a "game too long" draw.
   */
  static isFiftyMoveRule(state: GameState): boolean {
    return state.halfMoveClock >= FIFTY_MOVE_LIMIT * 2;
  }

  // ── Game Result ──────────────────────────────────────────────────────────

  /**
   * Aggregate all termination conditions and return the game result.
   */
  static getGameResult(
    state: GameState,
    hasLegalMoves: boolean,
  ): { status: GameStatus; winner: Color | null } {
    const currentColor = state.turn;

    // 1. Sanctuary Victory (highest priority)
    if (RuleEngine.isSanctuaryVictory(state, currentColor)) {
      return {
        status:
          currentColor === Color.WHITE
            ? GameStatus.WHITE_WIN
            : GameStatus.BLACK_WIN,
        winner: currentColor,
      };
    }

    // 2. Siege Victory — the side to move is trapped
    if (RuleEngine.isSiegeVictory(state, opponentColor(currentColor))) {
      // The opponent has besieged the current player's core
      const winner = opponentColor(currentColor);
      return {
        status:
          winner === Color.WHITE ? GameStatus.WHITE_WIN : GameStatus.BLACK_WIN,
        winner,
      };
    }

    // 3. No legal moves → stalemate (draw)
    if (!hasLegalMoves) {
      return { status: GameStatus.DRAW, winner: null };
    }

    // 4. Repetition draw
    if (RuleEngine.isPositionRepeated(state)) {
      return { status: GameStatus.DRAW, winner: null };
    }

    // 5. 50-move rule
    if (RuleEngine.isFiftyMoveRule(state)) {
      return { status: GameStatus.DRAW, winner: null };
    }

    return { status: GameStatus.IN_PROGRESS, winner: null };
  }
}

// ─── Anchor Overload ──────────────────────────────────────────────────────────

/**
 * Check and execute Anchor overload removal for `color`'s Anchors.
 *
 * An Anchor that starts 2 consecutive own turns inside the enemy control zone
 * is removed from the board (overloaded).
 *
 * If the Anchor moves or escapes the enemy zone, the counter resets to 0.
 *
 * **Called after the mover finishes their turn, before switching turns**,
 * on the **opponent's** Anchors (the ones that might be trapped).
 *
 * @param state  The current game state (after move execution, before turn switch).
 * @param moverColor  The color that just made a move.
 * @returns List of Pieces that were removed due to overload.
 */
export function checkAndExecuteOverload(
  state: GameState,
  moverColor: Color,
): Piece[] {
  // We check the opponent's anchors — they are the ones potentially
  // trapped in the mover's control zone.
  const targetColor = opponentColor(moverColor);
  const enemyZone = getControlZone(state.board, moverColor);
  const targetAnchors = getPieces(state.board, targetColor).filter(
    (p: Piece) => p.type === PieceType.ANCHOR,
  );

  const removed: Piece[] = [];

  // First pass: update counters
  for (const anchor of targetAnchors) {
    const key = overloadKey(anchor.pos.col, anchor.pos.row);
    const isInEnemyZone = enemyZone.has(posToString(anchor.pos));

    if (isInEnemyZone) {
      const currentCount = state.anchorOverloadTracker.get(key) ?? 0;
      state.anchorOverloadTracker.set(key, currentCount + 1);
    } else {
      // Reset if escaped
      state.anchorOverloadTracker.set(key, 0);
    }
  }

  // Second pass: remove Anchors with count >= 2
  for (const anchor of targetAnchors) {
    const key = overloadKey(anchor.pos.col, anchor.pos.row);
    const count = state.anchorOverloadTracker.get(key) ?? 0;
    if (count >= 2) {
      // Remove from board
      state.board[anchor.pos.row][anchor.pos.col] = null;
      // Clean up tracker entry
      state.anchorOverloadTracker.delete(key);
      removed.push({ ...anchor, pos: { ...anchor.pos } });
    }
  }

  return removed;
}

// ─── Position Key ─────────────────────────────────────────────────────────────

/**
 * Generate a compact string key for the current board position,
 * used for repetition detection. Format: board-array + turn.
 */
export function boardPositionKey(state: GameState): string {
  const arr = boardToArray(state.board);
  return arr.join(',') + '|' + (state.turn === Color.WHITE ? 'w' : 'b');
}
