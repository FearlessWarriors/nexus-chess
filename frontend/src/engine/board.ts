import {
  BoardGrid,
  Piece,
  PieceType,
  Color,
  Position,
  BOARD_SIZE,
  isValidPosition,
  posEquals,
} from './types';

// ─── Board Creation ───────────────────────────────────────────────────────────

/** Create the standard Nexus Gravity Chess starting position */
export function createInitialBoard(): BoardGrid {
  const board: BoardGrid = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null),
  );

  // Black back rank (row 0): BF BA BF BC BF BA BF
  const blackPieces: PieceType[] = [
    PieceType.FLUX,
    PieceType.ANCHOR,
    PieceType.FLUX,
    PieceType.CORE,
    PieceType.FLUX,
    PieceType.ANCHOR,
    PieceType.FLUX,
  ];
  for (let col = 0; col < BOARD_SIZE; col++) {
    board[0][col] = {
      type: blackPieces[col],
      color: Color.BLACK,
      pos: { col, row: 0 },
    };
  }

  // White back rank (row 6): WF WA WF WC WF WA WF
  const whitePieces: PieceType[] = [
    PieceType.FLUX,
    PieceType.ANCHOR,
    PieceType.FLUX,
    PieceType.CORE,
    PieceType.FLUX,
    PieceType.ANCHOR,
    PieceType.FLUX,
  ];
  for (let col = 0; col < BOARD_SIZE; col++) {
    board[6][col] = {
      type: whitePieces[col],
      color: Color.WHITE,
      pos: { col, row: 6 },
    };
  }

  return board;
}

// ─── Board Accessors ──────────────────────────────────────────────────────────

/** Get the piece at the given coordinate (or null if empty) */
export function getPiece(board: BoardGrid, col: number, row: number): Piece | null {
  if (!isValidPosition({ col, row })) {
    return null;
  }
  return board[row][col];
}

/** Place a piece on the board (mutates the piece's pos field) */
export function setPiece(board: BoardGrid, col: number, row: number, piece: Piece): void {
  piece.pos = { col, row };
  board[row][col] = piece;
}

/** Remove and return the piece at the given coordinate */
export function removePiece(board: BoardGrid, col: number, row: number): Piece | null {
  const piece = board[row][col];
  board[row][col] = null;
  return piece;
}

/** Get all pieces of a given color */
export function getPieces(board: BoardGrid, color: Color): Piece[] {
  const pieces: Piece[] = [];
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = board[row][col];
      if (piece !== null && piece.color === color) {
        pieces.push(piece);
      }
    }
  }
  return pieces;
}

/** Find the core piece of the given color. Throws if not found (should never happen). */
export function getCore(board: BoardGrid, color: Color): Piece {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = board[row][col];
      if (piece !== null && piece.type === PieceType.CORE && piece.color === color) {
        return piece;
      }
    }
  }
  throw new Error(`Core not found for color: ${color}`);
}

/** Deep-clone the board grid */
export function cloneBoard(board: BoardGrid): BoardGrid {
  return board.map((row) =>
    row.map((cell) =>
      cell !== null ? { ...cell, pos: { ...cell.pos } } : null,
    ),
  );
}

/** Is the center square (d4) occupied by a piece of the given color? */
export function isCenterOccupiedBy(board: BoardGrid, color: Color): boolean {
  const piece = board[CENTER_ROW][CENTER_COL];
  return piece !== null && piece.color === color;
}

// Re-export center constants for convenience
const CENTER_COL = 3;
const CENTER_ROW = 3;

// ─── Board Serialization (byte array) ────────────────────────────────────────

/**
 * Encode the board into a 49-element number array.
 * Encoding: 0=empty, 1=WC, 2=WA, 3=WF, 5=BC, 6=BA, 7=BF
 */
export function boardToArray(board: BoardGrid): number[] {
  const arr: number[] = new Array(BOARD_SIZE * BOARD_SIZE);
  let i = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const piece = board[row][col];
      if (piece === null) {
        arr[i] = 0;
      } else {
        const base = piece.color === Color.WHITE ? 0 : 4;
        let typeCode: number;
        switch (piece.type) {
          case PieceType.CORE:
            typeCode = 1;
            break;
          case PieceType.ANCHOR:
            typeCode = 2;
            break;
          case PieceType.FLUX:
            typeCode = 3;
            break;
        }
        arr[i] = base + typeCode;
      }
      i++;
    }
  }
  return arr;
}

/**
 * Decode a 49-element number array back into a BoardGrid.
 * Inverse of boardToArray.
 */
export function arrayToBoard(arr: number[]): BoardGrid {
  const board: BoardGrid = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null),
  );
  let i = 0;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const code = arr[i];
      if (code !== 0) {
        const color: Color = code <= 3 ? Color.WHITE : Color.BLACK;
        let type: PieceType;
        const typeCode = code <= 3 ? code : code - 4;
        switch (typeCode) {
          case 1:
            type = PieceType.CORE;
            break;
          case 2:
            type = PieceType.ANCHOR;
            break;
          case 3:
            type = PieceType.FLUX;
            break;
          default:
            throw new Error(`Invalid piece code: ${code}`);
        }
        board[row][col] = { type, color, pos: { col, row } };
      }
      i++;
    }
  }
  return board;
}
