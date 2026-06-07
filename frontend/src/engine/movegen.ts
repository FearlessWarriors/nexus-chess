/**
 * movegen.ts — Gravity-Lock Move Generator
 *
 * Generates all legal moves for a side under the gravity-lock ruleset.
 * There is no capture — only movement and push moves.
 *
 * Key rules:
 *   - Locked pieces cannot move at all (except Flux, which is immune).
 *   - Core in cooldown (just pushed) cannot move for 1 turn.
 *   - Push moves: if conditions are met, the player can displace the
 *     enemy core to an adjacent empty square instead of moving a piece.
 */

import {
  BoardGrid,
  Piece,
  PieceType,
  Color,
  Position,
  Move,
  MoveFlag,
  GameState,
  BOARD_SIZE,
  CENTER,
  FLUX_RANGE,
  isValidPosition,
  posEquals,
  posToString,
  opponentColor,
} from './types';
import { getPiece, getPieces, getCore, setPiece, removePiece } from './board';
import { ALL_DIRECTIONS, ORTHOGONAL_DIRECTIONS, getControlZone, isLocked } from './gravity';

// ─── Move Generator ───────────────────────────────────────────────────────────

export class MoveGenerator {
  // ── Core (核心) ──────────────────────────────────────────────────────────

  /**
   * Generate all pseudo-legal moves for a Core piece.
   *
   * Movement: one step in any of 8 directions to an empty square.
   * No capture. No Nexus Link (removed in gravity rules).
   */
  static generateCoreMoves(state: GameState, core: Piece): Move[] {
    const moves: Move[] = [];
    const { board } = state;
    const { pos } = core;

    for (const dir of ALL_DIRECTIONS) {
      const to: Position = { col: pos.col + dir.col, row: pos.row + dir.row };
      if (!isValidPosition(to)) {
        continue;
      }
      const target = getPiece(board, to.col, to.row);
      if (target !== null) {
        continue; // cannot move onto any piece (no capture)
      }
      moves.push({
        from: pos,
        to,
        piece: core,
        pushed: null,
        pushedTo: null,
        flag: MoveFlag.NORMAL,
        notation: posToString(pos) + posToString(to),
      });
    }

    return moves;
  }

  // ── Anchor (锚点) ────────────────────────────────────────────────────────

  /**
   * Generate all pseudo-legal moves for an Anchor piece.
   *
   * Movement: slides any distance in 4 orthogonal directions (rook-style).
   * Stops before any piece (friendly or enemy). No capture.
   */
  static generateAnchorMoves(state: GameState, anchor: Piece): Move[] {
    const moves: Move[] = [];
    const { board } = state;
    const { pos } = anchor;

    for (const dir of ORTHOGONAL_DIRECTIONS) {
      let step = 1;
      while (true) {
        const to: Position = {
          col: pos.col + dir.col * step,
          row: pos.row + dir.row * step,
        };
        if (!isValidPosition(to)) {
          break;
        }
        const target = getPiece(board, to.col, to.row);
        if (target !== null) {
          break; // blocked by any piece (no capture)
        }
        moves.push({
          from: pos,
          to,
          piece: anchor,
          pushed: null,
          pushedTo: null,
          flag: MoveFlag.NORMAL,
          notation: posToString(pos) + posToString(to),
        });
        step++;
      }
    }

    return moves;
  }

  // ── Flux (流子) ──────────────────────────────────────────────────────────

  /**
   * Generate all pseudo-legal moves for a Flux piece.
   *
   * Movement: jumps exactly 2 squares in any of 8 directions.
   * Can jump over intervening pieces. Must land on empty square.
   * No capture. No Scout Convergence (removed in gravity rules).
   *
   * Flux is immune to locking — always generates moves.
   */
  static generateFluxMoves(state: GameState, flux: Piece): Move[] {
    const moves: Move[] = [];
    const { board } = state;
    const { pos } = flux;

    for (const dir of ALL_DIRECTIONS) {
      const to: Position = {
        col: pos.col + dir.col * FLUX_RANGE,
        row: pos.row + dir.row * FLUX_RANGE,
      };
      if (!isValidPosition(to)) {
        continue;
      }
      const target = getPiece(board, to.col, to.row);
      if (target !== null) {
        continue; // cannot land on any piece (no capture)
      }
      moves.push({
        from: pos,
        to,
        piece: flux,
        pushed: null,
        pushedTo: null,
        flag: MoveFlag.NORMAL,
        notation: posToString(pos) + posToString(to),
      });
    }

    return moves;
  }

  // ── Push Move Generation ─────────────────────────────────────────────────

  /**
   * Generate push moves: if conditions are met, the current player can
   * displace the enemy core to an adjacent empty square instead of
   * moving their own piece.
   *
   * Conditions (canPushEnemyCore):
   *   - Enemy core is inside our control zone
   *   - At least 6 of the enemy core's 8 neighbours are in our control zone
   *   - Enemy core is NOT on d4
   *
   * Push destination: any empty adjacent square in the 8-neighbourhood
   * (preferring squares away from our side).
   */
  static generatePushMoves(state: GameState, color: Color): Move[] {
    const moves: Move[] = [];
    const enemyColor = opponentColor(color);
    let enemyCore: Piece;
    try {
      enemyCore = getCore(state.board, enemyColor);
    } catch {
      return []; // no enemy core (shouldn't happen)
    }

    const myZone = getControlZone(state.board, color);
    const coreKey = posToString(enemyCore.pos);

    // Condition 1: enemy core must be in our control zone
    if (!myZone.has(coreKey)) {
      return [];
    }

    // Condition 2: at least 6 of the 8 neighbours must be in our control zone
    let controlledNeighbours = 0;
    const emptyNeighbours: Position[] = [];
    for (const dir of ALL_DIRECTIONS) {
      const nb: Position = {
        col: enemyCore.pos.col + dir.col,
        row: enemyCore.pos.row + dir.row,
      };
      if (!isValidPosition(nb)) {
        continue;
      }
      const nbKey = posToString(nb);
      if (myZone.has(nbKey)) {
        controlledNeighbours++;
      }
      // Track empty squares for push destinations
      const piece = getPiece(state.board, nb.col, nb.row);
      if (piece === null) {
        emptyNeighbours.push(nb);
      }
    }

    if (controlledNeighbours < 6) {
      return [];
    }

    // Condition 3: enemy core not on d4
    if (posEquals(enemyCore.pos, CENTER)) {
      return [];
    }

    // Generate push moves — push the enemy core to each empty neighbour
    // Sort destinations: prefer squares further from our back rank
    const myBackRank = color === Color.WHITE ? 6 : 0;
    emptyNeighbours.sort((a, b) => {
      const distA = Math.abs(a.row - myBackRank);
      const distB = Math.abs(b.row - myBackRank);
      return distB - distA; // prefer further away from our side
    });

    for (const dest of emptyNeighbours) {
      moves.push({
        from: enemyCore.pos,
        to: dest,
        piece: enemyCore, // the piece being moved is the enemy core
        pushed: enemyCore, // record what was pushed
        pushedTo: dest,
        flag: MoveFlag.PUSH,
        notation: 'P' + posToString(enemyCore.pos) + '\u2192' + posToString(dest),
      });
    }

    return moves;
  }

  // ── Move Aggregation ─────────────────────────────────────────────────────

  /**
   * Generate all legal moves for the given color.
   *
   * Process:
   *   1. Compute control zones for both sides.
   *   2. Generate pseudo-legal moves for each friendly piece.
   *   3. Filter out moves from locked pieces.
   *   4. Filter out Core moves if Core is in cooldown.
   *   5. Generate push moves (always available if conditions met).
   */
  static generateMoves(state: GameState, color: Color): Move[] {
    const pieces = getPieces(state.board, color);
    const myZone = getControlZone(state.board, color);
    const enemyColor = opponentColor(color);
    const enemyZone = getControlZone(state.board, enemyColor);

    const moves: Move[] = [];

    // Check if this color's core is in cooldown
    const coreInCooldown = state.coreCooldown.get(color) === true;

    for (const piece of pieces) {
      // Skip locked pieces
      if (isLocked(piece, state.board, myZone, enemyZone)) {
        continue;
      }

      switch (piece.type) {
        case PieceType.CORE:
          // Core cannot move if in cooldown
          if (coreInCooldown) {
            continue;
          }
          moves.push(...MoveGenerator.generateCoreMoves(state, piece));
          break;
        case PieceType.ANCHOR:
          moves.push(...MoveGenerator.generateAnchorMoves(state, piece));
          break;
        case PieceType.FLUX:
          moves.push(...MoveGenerator.generateFluxMoves(state, piece));
          break;
      }
    }

    // Generate push moves (these are always legal because they don't
    // involve moving your own pieces — they displace the enemy core)
    moves.push(...MoveGenerator.generatePushMoves(state, color));

    return moves;
  }
}
