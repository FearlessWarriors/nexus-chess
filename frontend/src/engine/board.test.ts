import { describe, it, expect } from 'vitest';
import {
  createInitialBoard,
  getPiece,
  getPieces,
  getCore,
  setPiece,
  removePiece,
  cloneBoard,
  boardToArray,
  arrayToBoard,
} from './board';
import { Color, PieceType } from './types';

describe('createInitialBoard', () => {
  it('has 7 rows and 7 columns', () => {
    const board = createInitialBoard();
    expect(board.length).toBe(7);
    for (const row of board) {
      expect(row.length).toBe(7);
    }
  });

  it('has correct initial layout: Black back rank (row 0)', () => {
    const board = createInitialBoard();
    // Expected: BSc BS BSc BC BSc BS BSc
    const expectedBlack: PieceType[] = [
      PieceType.FLUX,
      PieceType.ANCHOR,
      PieceType.FLUX,
      PieceType.CORE,
      PieceType.FLUX,
      PieceType.ANCHOR,
      PieceType.FLUX,
    ];
    for (let col = 0; col < 7; col++) {
      const piece = board[0][col];
      expect(piece).not.toBeNull();
      expect(piece!.color).toBe(Color.BLACK);
      expect(piece!.type).toBe(expectedBlack[col]);
      expect(piece!.pos).toEqual({ col, row: 0 });
    }
  });

  it('has correct initial layout: White back rank (row 6)', () => {
    const board = createInitialBoard();
    const expectedWhite: PieceType[] = [
      PieceType.FLUX,
      PieceType.ANCHOR,
      PieceType.FLUX,
      PieceType.CORE,
      PieceType.FLUX,
      PieceType.ANCHOR,
      PieceType.FLUX,
    ];
    for (let col = 0; col < 7; col++) {
      const piece = board[6][col];
      expect(piece).not.toBeNull();
      expect(piece!.color).toBe(Color.WHITE);
      expect(piece!.type).toBe(expectedWhite[col]);
      expect(piece!.pos).toEqual({ col, row: 6 });
    }
  });

  it('has 14 pieces total (7 per side)', () => {
    const board = createInitialBoard();
    let count = 0;
    let whiteCount = 0;
    let blackCount = 0;
    for (const row of board) {
      for (const cell of row) {
        if (cell !== null) {
          count++;
          if (cell.color === Color.WHITE) whiteCount++;
          if (cell.color === Color.BLACK) blackCount++;
        }
      }
    }
    expect(count).toBe(14);
    expect(whiteCount).toBe(7);
    expect(blackCount).toBe(7);
  });

  it('middle rows (1-5) are empty', () => {
    const board = createInitialBoard();
    for (let row = 1; row <= 5; row++) {
      for (let col = 0; col < 7; col++) {
        expect(board[row][col]).toBeNull();
      }
    }
  });
});

describe('getPiece', () => {
  it('returns piece at valid position', () => {
    const board = createInitialBoard();
    const piece = getPiece(board, 3, 0); // Black Core at d7
    expect(piece).not.toBeNull();
    expect(piece!.type).toBe(PieceType.CORE);
    expect(piece!.color).toBe(Color.BLACK);
  });

  it('returns null for empty square', () => {
    const board = createInitialBoard();
    expect(getPiece(board, 3, 3)).toBeNull(); // d4 center
  });

  it('returns null for out-of-bounds', () => {
    const board = createInitialBoard();
    expect(getPiece(board, -1, 0)).toBeNull();
    expect(getPiece(board, 7, 0)).toBeNull();
  });
});

describe('setPiece and removePiece', () => {
  it('setPiece places and updates position', () => {
    const board = createInitialBoard();
    const piece = { type: PieceType.CORE, color: Color.WHITE, pos: { col: 0, row: 0 } };
    setPiece(board, 3, 3, piece);
    expect(board[3][3]).toEqual({
      type: PieceType.CORE,
      color: Color.WHITE,
      pos: { col: 3, row: 3 },
    });
  });

  it('removePiece returns removed piece and clears square', () => {
    const board = createInitialBoard();
    const removed = removePiece(board, 3, 0);
    expect(removed).not.toBeNull();
    expect(removed!.type).toBe(PieceType.CORE);
    expect(board[0][3]).toBeNull();
  });

  it('removePiece returns null for empty square', () => {
    const board = createInitialBoard();
    const removed = removePiece(board, 3, 3);
    expect(removed).toBeNull();
  });
});

describe('getPieces', () => {
  it('returns all white pieces', () => {
    const board = createInitialBoard();
    const whitePieces = getPieces(board, Color.WHITE);
    expect(whitePieces.length).toBe(7);
    expect(whitePieces.every((p) => p.color === Color.WHITE)).toBe(true);
  });

  it('returns all black pieces', () => {
    const board = createInitialBoard();
    const blackPieces = getPieces(board, Color.BLACK);
    expect(blackPieces.length).toBe(7);
    expect(blackPieces.every((p) => p.color === Color.BLACK)).toBe(true);
  });

  it('returns empty for color with no pieces', () => {
    const board = createInitialBoard();
    // Remove all black pieces
    for (let col = 0; col < 7; col++) {
      board[0][col] = null;
    }
    expect(getPieces(board, Color.BLACK).length).toBe(0);
  });
});

describe('getCore', () => {
  it('finds white core at d1 (col 3, row 6)', () => {
    const board = createInitialBoard();
    const core = getCore(board, Color.WHITE);
    expect(core.type).toBe(PieceType.CORE);
    expect(core.color).toBe(Color.WHITE);
    expect(core.pos).toEqual({ col: 3, row: 6 });
  });

  it('finds black core at d7 (col 3, row 0)', () => {
    const board = createInitialBoard();
    const core = getCore(board, Color.BLACK);
    expect(core.type).toBe(PieceType.CORE);
    expect(core.color).toBe(Color.BLACK);
    expect(core.pos).toEqual({ col: 3, row: 0 });
  });

  it('throws if core not found', () => {
    const board = createInitialBoard();
    board[6][3] = null; // Remove white core
    expect(() => getCore(board, Color.WHITE)).toThrow('Core not found');
  });
});

describe('cloneBoard', () => {
  it('creates independent copy', () => {
    const board = createInitialBoard();
    const cloned = cloneBoard(board);
    expect(cloned).not.toBe(board);
    expect(cloned[0]).not.toBe(board[0]);

    // Verify equality
    expect(cloned[0][3]!.type).toBe(PieceType.CORE);
    expect(cloned[6][3]!.type).toBe(PieceType.CORE);

    // Modify clone — original should be unaffected
    cloned[0][3] = null;
    expect(board[0][3]).not.toBeNull();
  });
});

describe('boardToArray / arrayToBoard roundtrip', () => {
  it('roundtrip preserves initial board', () => {
    const board = createInitialBoard();
    const arr = boardToArray(board);
    expect(arr.length).toBe(49);

    const decoded = arrayToBoard(arr);
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 7; col++) {
        const orig = board[row][col];
        const dec = decoded[row][col];
        if (orig === null) {
          expect(dec).toBeNull();
        } else {
          expect(dec).not.toBeNull();
          expect(dec!.type).toBe(orig.type);
          expect(dec!.color).toBe(orig.color);
        }
      }
    }
  });

  it('empty board roundtrip', () => {
    const emptyBoard = Array.from({ length: 7 }, () =>
      Array.from({ length: 7 }, () => null),
    ) as (import('./types').Piece | null)[][];
    const arr = boardToArray(emptyBoard);
    expect(arr.every((v) => v === 0)).toBe(true);
    const decoded = arrayToBoard(arr);
    for (const row of decoded) {
      for (const cell of row) {
        expect(cell).toBeNull();
      }
    }
  });

  it('encoding: White Core = 1, White Anchor = 2, White Flux = 3', () => {
    const board = createInitialBoard();
    const arr = boardToArray(board);
    // WC at d1 = board[6][3] = index 6*7+3 = 45
    expect(arr[45]).toBe(1); // White Core
    // WA at b1 = board[6][1] = index 43
    expect(arr[43]).toBe(2); // White Anchor
    // WF at a1 = board[6][0] = index 42
    expect(arr[42]).toBe(3); // White Flux
  });

  it('encoding: Black Core = 5, Black Anchor = 6, Black Flux = 7', () => {
    const board = createInitialBoard();
    const arr = boardToArray(board);
    // BC at d7 = board[0][3] = index 3
    expect(arr[3]).toBe(5); // Black Core
    // BA at b7 = board[0][1] = index 1
    expect(arr[1]).toBe(6); // Black Anchor
    // BF at a7 = board[0][0] = index 0
    expect(arr[0]).toBe(7); // Black Flux
  });

  it('empty square encoded as 0', () => {
    const board = createInitialBoard();
    const arr = boardToArray(board);
    // d4 = board[3][3] = index 3*7+3 = 24
    expect(arr[24]).toBe(0);
  });
});
