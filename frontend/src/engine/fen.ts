import {
  BoardGrid,
  Piece,
  PieceType,
  Color,
  GameState,
  GameStatus,
  BOARD_SIZE,
} from './types';
import { createInitialBoard, cloneBoard, setPiece } from './board';

// ─── FEN Piece Encoding (Gravity Rules) ──────────────────────────────────────

/**
 * Map a piece to its FEN character sequence.
 * White: WC, WA, WF (Core, Anchor, Flux)
 * Black: BC, BA, BF (Core, Anchor, Flux)
 */
function pieceToFen(piece: Piece): string {
  const colorChar = piece.color === Color.WHITE ? 'W' : 'B';
  switch (piece.type) {
    case PieceType.CORE:
      return colorChar + 'C';
    case PieceType.ANCHOR:
      return colorChar + 'A';
    case PieceType.FLUX:
      return colorChar + 'F';
  }
}

/**
 * Parse a FEN piece token starting at the given index.
 * Returns [piece, consumedLength] or [null, 0] if not a piece token.
 */
function parseFenPiece(s: string, index: number): [Piece | null, number] {
  if (index >= s.length) {
    return [null, 0];
  }

  const colorChar = s[index];
  if (colorChar !== 'W' && colorChar !== 'B') {
    return [null, 0];
  }

  const color: Color = colorChar === 'W' ? Color.WHITE : Color.BLACK;

  if (index + 1 >= s.length) {
    return [null, 0];
  }

  const nextChar = s[index + 1];

  if (nextChar === 'C') {
    // Core: "WC" or "BC" (2 chars)
    return [{ type: PieceType.CORE, color, pos: { col: 0, row: 0 } }, 2];
  }

  if (nextChar === 'A') {
    // Anchor: "WA" or "BA" (2 chars)
    return [{ type: PieceType.ANCHOR, color, pos: { col: 0, row: 0 } }, 2];
  }

  if (nextChar === 'F') {
    // Flux: "WF" or "BF" (2 chars)
    return [{ type: PieceType.FLUX, color, pos: { col: 0, row: 0 } }, 2];
  }

  return [null, 0];
}

// ─── FEN Class ────────────────────────────────────────────────────────────────

export class FEN {
  /**
   * Encode a GameState into a Nexus Gravity FEN string.
   *
   * Format: "board turn halfMove fullMove sanctuaryCool"
   *
   * Where:
   *   sanctuaryCool = "-" if sanctuaryOccupied is null,
   *                   "w" if WHITE occupied d4 at turn start,
   *                   "b" if BLACK occupied d4 at turn start.
   *
   * Example initial position:
   *   "BFBABFBCBFBABF/7/7/7/7/7/WFWAWFWCWFWAWF w 0 1 -"
   */
  static encode(state: GameState): string {
    const rows: string[] = [];

    for (let row = 0; row < BOARD_SIZE; row++) {
      let rowStr = '';
      let emptyCount = 0;

      for (let col = 0; col < BOARD_SIZE; col++) {
        const piece = state.board[row][col];
        if (piece === null) {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            rowStr += emptyCount.toString();
            emptyCount = 0;
          }
          rowStr += pieceToFen(piece);
        }
      }

      if (emptyCount > 0) {
        rowStr += emptyCount.toString();
      }

      rows.push(rowStr);
    }

    const turnChar = state.turn === Color.WHITE ? 'w' : 'b';
    const sanctuaryChar =
      state.sanctuaryOccupied === Color.WHITE
        ? 'w'
        : state.sanctuaryOccupied === Color.BLACK
          ? 'b'
          : '-';

    const fen = `${rows.join('/')} ${turnChar} ${state.halfMoveClock} ${state.fullMoveNumber} ${sanctuaryChar}`;
    return fen;
  }

  /**
   * Decode a Nexus Gravity FEN string into a GameState.
   *
   * Throws on malformed input.
   */
  static decode(fen: string): GameState {
    const parts = fen.trim().split(/\s+/);
    if (parts.length < 4) {
      throw new Error(`Invalid FEN: expected at least 4 fields, got ${parts.length}: "${fen}"`);
    }

    const [boardPart, turnPart, halfMovePart, fullMovePart] = parts;
    const sanctuaryPart = parts.length >= 5 ? parts[4] : '-';

    const rows = boardPart.split('/');
    if (rows.length !== BOARD_SIZE) {
      throw new Error(`Invalid FEN: expected ${BOARD_SIZE} board rows, got ${rows.length}`);
    }

    const board = createEmptyBoard();

    for (let row = 0; row < BOARD_SIZE; row++) {
      const rowStr = rows[row];
      let col = 0;
      let i = 0;

      while (i < rowStr.length && col < BOARD_SIZE) {
        const ch = rowStr[i];

        // Digit = empty squares
        if (ch >= '1' && ch <= '9') {
          const emptyCount = parseInt(ch, 10);
          col += emptyCount;
          i++;
          continue;
        }

        // Piece token (starts with W or B)
        const [piece, consumed] = parseFenPiece(rowStr, i);
        if (piece === null || consumed === 0) {
          throw new Error(
            `Invalid FEN: unexpected character '${ch}' at row ${row}, col ${i} in "${rowStr}"`,
          );
        }
        piece.pos = { col, row };
        setPiece(board, col, row, piece);
        col++;
        i += consumed;
      }

      if (col !== BOARD_SIZE) {
        throw new Error(
          `Invalid FEN: row ${row} has ${col} squares, expected ${BOARD_SIZE}: "${rowStr}"`,
        );
      }
    }

    const turn: Color = turnPart === 'w' ? Color.WHITE : Color.BLACK;
    const halfMoveClock = parseInt(halfMovePart, 10);
    const fullMoveNumber = parseInt(fullMovePart, 10);

    if (isNaN(halfMoveClock) || isNaN(fullMoveNumber)) {
      throw new Error(`Invalid FEN: bad halfMove/fullMove numbers: "${fen}"`);
    }

    const sanctuaryOccupied: Color | null =
      sanctuaryPart === 'w'
        ? Color.WHITE
        : sanctuaryPart === 'b'
          ? Color.BLACK
          : null;

    const state = new GameState();
    state.board = board;
    state.turn = turn;
    state.status = GameStatus.IN_PROGRESS;
    state.halfMoveClock = halfMoveClock;
    state.fullMoveNumber = fullMoveNumber;
    state.positionCount = new Map();
    state.winner = null;
    state.sanctuaryOccupied = sanctuaryOccupied;

    return state;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createEmptyBoard(): BoardGrid {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null),
  );
}

/**
 * Convenience: generate the standard initial FEN string.
 */
export function initialFEN(): string {
  return 'BFBABFBCBFBABF/7/7/7/7/7/WFWAWFWCWFWAWF w 0 1 -';
}
