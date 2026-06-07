import { describe, it, expect } from 'vitest';
import {
  posFromString,
  posToString,
  posEquals,
  isValidPosition,
  isCenter,
  opponentColor,
  Color,
  PieceType,
  CENTER,
  BOARD_SIZE,
  GameState,
} from './types';

describe('Position Utilities', () => {
  describe('posFromString', () => {
    it('converts "a1" to { col: 0, row: 0 }', () => {
      expect(posFromString('a1')).toEqual({ col: 0, row: 0 });
    });

    it('converts "d4" to { col: 3, row: 3 }', () => {
      expect(posFromString('d4')).toEqual({ col: 3, row: 3 });
    });

    it('converts "g7" to { col: 6, row: 6 }', () => {
      expect(posFromString('g7')).toEqual({ col: 6, row: 6 });
    });

    it('converts "a7" to { col: 0, row: 6 }', () => {
      expect(posFromString('a7')).toEqual({ col: 0, row: 6 });
    });

    it('throws on invalid column "h1"', () => {
      expect(() => posFromString('h1')).toThrow();
    });

    it('throws on invalid row "a0"', () => {
      expect(() => posFromString('a0')).toThrow();
    });

    it('throws on invalid row "a8"', () => {
      expect(() => posFromString('a8')).toThrow();
    });

    it('throws on empty string', () => {
      expect(() => posFromString('')).toThrow();
    });

    it('is case-insensitive for column letter', () => {
      expect(posFromString('D4')).toEqual({ col: 3, row: 3 });
      expect(posFromString('A1')).toEqual({ col: 0, row: 0 });
    });
  });

  describe('posToString', () => {
    it('converts { col: 0, row: 0 } to "a1"', () => {
      expect(posToString({ col: 0, row: 0 })).toBe('a1');
    });

    it('converts { col: 3, row: 3 } to "d4"', () => {
      expect(posToString({ col: 3, row: 3 })).toBe('d4');
    });

    it('converts { col: 6, row: 6 } to "g7"', () => {
      expect(posToString({ col: 6, row: 6 })).toBe('g7');
    });

    it('roundtrips with posFromString', () => {
      const positions = ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'];
      for (const s of positions) {
        expect(posToString(posFromString(s))).toBe(s);
      }
    });
  });

  describe('posEquals', () => {
    it('returns true for same positions', () => {
      expect(posEquals({ col: 3, row: 3 }, { col: 3, row: 3 })).toBe(true);
    });

    it('returns false for different positions', () => {
      expect(posEquals({ col: 0, row: 0 }, { col: 1, row: 0 })).toBe(false);
      expect(posEquals({ col: 0, row: 0 }, { col: 0, row: 1 })).toBe(false);
    });
  });

  describe('isValidPosition', () => {
    it('returns true for all valid squares', () => {
      for (let col = 0; col < BOARD_SIZE; col++) {
        for (let row = 0; row < BOARD_SIZE; row++) {
          expect(isValidPosition({ col, row })).toBe(true);
        }
      }
    });

    it('returns false for out-of-bounds', () => {
      expect(isValidPosition({ col: -1, row: 0 })).toBe(false);
      expect(isValidPosition({ col: 0, row: -1 })).toBe(false);
      expect(isValidPosition({ col: 7, row: 0 })).toBe(false);
      expect(isValidPosition({ col: 0, row: 7 })).toBe(false);
    });
  });

  describe('isCenter', () => {
    it('returns true for d4', () => {
      expect(isCenter({ col: 3, row: 3 })).toBe(true);
    });

    it('returns false for other squares', () => {
      expect(isCenter({ col: 0, row: 0 })).toBe(false);
      expect(isCenter({ col: 3, row: 2 })).toBe(false);
    });
  });

  describe('opponentColor', () => {
    it('WHITE -> BLACK', () => {
      expect(opponentColor(Color.WHITE)).toBe(Color.BLACK);
    });

    it('BLACK -> WHITE', () => {
      expect(opponentColor(Color.BLACK)).toBe(Color.WHITE);
    });
  });
});

describe('GameState', () => {
  it('initializes with correct defaults', () => {
    const state = new GameState();
    expect(state.board).toEqual([]);
    expect(state.turn).toBe(Color.WHITE);
    expect(state.status).toBe(0); // IN_PROGRESS
    expect(state.moveHistory).toEqual([]);
    expect(state.halfMoveClock).toBe(0);
    expect(state.fullMoveNumber).toBe(1);
    expect(state.winner).toBeNull();
  });

  it('clone creates an independent copy', () => {
    const state = new GameState();
    // Set up some board state manually
    state.board = [
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
      [null, null, null, null, null, null, null],
      [
        { type: PieceType.FLUX, color: Color.WHITE, pos: { col: 0, row: 6 } },
        null, null, null, null, null, null,
      ],
    ];

    const clone = state.clone();
    expect(clone.turn).toBe(state.turn);
    expect(clone.halfMoveClock).toBe(state.halfMoveClock);

    // Modify clone — should not affect original
    clone.board[6][0] = null;
    expect(state.board[6][0]).not.toBeNull();
  });
});
