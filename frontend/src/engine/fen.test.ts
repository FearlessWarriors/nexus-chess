import { describe, it, expect } from 'vitest';
import { FEN, initialFEN } from './fen';
import { Color, GameStatus, GameState, PieceType } from './types';
import { createInitialBoard } from './board';

describe('FEN', () => {
  describe('initialFEN', () => {
    it('returns the standard initial position', () => {
      expect(initialFEN()).toBe('BFBABFBCBFBABF/7/7/7/7/7/WFWAWFWCWFWAWF w 0 1 -');
    });
  });

  describe('encode', () => {
    it('encodes initial position correctly', () => {
      const state = new GameState();
      state.board = createInitialBoard();
      state.turn = Color.WHITE;
      state.halfMoveClock = 0;
      state.fullMoveNumber = 1;

      const fen = FEN.encode(state);
      expect(fen).toBe(initialFEN());
    });

    it('encodes empty rows as "7"', () => {
      const state = new GameState();
      state.board = createInitialBoard();
      state.turn = Color.WHITE;

      const fen = FEN.encode(state);
      const parts = fen.split(' ');
      const rows = parts[0].split('/');
      // Rows 1-5 (index 1-5) should all be "7"
      for (let i = 1; i <= 5; i++) {
        expect(rows[i]).toBe('7');
      }
    });

    it('encodes mid-game position', () => {
      // After some moves
      const state = new GameState();
      state.board = createInitialBoard();
      // Modify board: move Black Flux a7->a5
      state.board[2][0] = { type: PieceType.FLUX, color: Color.BLACK, pos: { col: 0, row: 2 } };
      state.board[0][0] = null;
      // Move White Anchor b1->b3
      state.board[4][1] = { type: PieceType.ANCHOR, color: Color.WHITE, pos: { col: 1, row: 4 } };
      state.board[6][1] = null;
      
      state.turn = Color.BLACK;
      state.halfMoveClock = 2;
      state.fullMoveNumber = 2;

      const fen = FEN.encode(state);
      // Should be a valid FEN string with 5 fields
      expect(fen.split(' ').length).toBe(5);
      expect(fen).toContain('b');
    });

    it('encodes turn correctly', () => {
      const state = new GameState();
      state.board = createInitialBoard();
      state.turn = Color.WHITE;
      expect(FEN.encode(state)).toContain(' w ');

      state.turn = Color.BLACK;
      expect(FEN.encode(state)).toContain(' b ');
    });
  });

  describe('decode', () => {
    it('decodes initial FEN correctly', () => {
      const fen = initialFEN();
      const state = FEN.decode(fen);

      expect(state.turn).toBe(Color.WHITE);
      expect(state.halfMoveClock).toBe(0);
      expect(state.fullMoveNumber).toBe(1);
      expect(state.status).toBe(GameStatus.IN_PROGRESS);

      // Verify piece counts
      let whiteCount = 0;
      let blackCount = 0;
      for (const row of state.board) {
        for (const cell of row) {
          if (cell !== null) {
            if (cell.color === Color.WHITE) whiteCount++;
            if (cell.color === Color.BLACK) blackCount++;
          }
        }
      }
      expect(whiteCount).toBe(7);
      expect(blackCount).toBe(7);
    });

    it('roundtrip: encode then decode preserves state', () => {
      const state = new GameState();
      state.board = createInitialBoard();
      state.turn = Color.WHITE;
      state.halfMoveClock = 0;
      state.fullMoveNumber = 1;

      const fen = FEN.encode(state);
      const decoded = FEN.decode(fen);

      expect(decoded.turn).toBe(state.turn);
      expect(decoded.halfMoveClock).toBe(state.halfMoveClock);
      expect(decoded.fullMoveNumber).toBe(state.fullMoveNumber);

      // Verify board positions
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 7; col++) {
          const orig = state.board[row][col];
          const dec = decoded.board[row][col];
          if (orig === null) {
            expect(dec).toBeNull();
          } else {
            expect(dec).not.toBeNull();
            expect(dec!.type).toBe(orig.type);
            expect(dec!.color).toBe(orig.color);
            expect(dec!.pos).toEqual(orig.pos);
          }
        }
      }
    });

    it('roundtrip with black to move', () => {
      const state = new GameState();
      state.board = createInitialBoard();
      state.turn = Color.BLACK;
      state.halfMoveClock = 5;
      state.fullMoveNumber = 3;

      const fen = FEN.encode(state);
      const decoded = FEN.decode(fen);

      expect(decoded.turn).toBe(Color.BLACK);
      expect(decoded.halfMoveClock).toBe(5);
      expect(decoded.fullMoveNumber).toBe(3);
    });

    it('roundtrip with pieces moved from initial', () => {
      const state = new GameState();
      state.board = createInitialBoard();
      // Move a piece
      state.board[4][0] = state.board[6][0]; // White Flux a1 -> a3
      state.board[6][0] = null;
      state.board[4][0]!.pos = { col: 0, row: 4 };
      state.turn = Color.BLACK;

      const fen = FEN.encode(state);
      const decoded = FEN.decode(fen);

      // Mirror assertions
      for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 7; col++) {
          const orig = state.board[row][col];
          const dec = decoded.board[row][col];
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

    it('throws on invalid FEN', () => {
      expect(() => FEN.decode('invalid')).toThrow();
      expect(() => FEN.decode('')).toThrow();
    });

    it('throws on wrong number of rows', () => {
      expect(() => FEN.decode('7/7/7 w 0 1')).toThrow();
    });

    it('throws on bad numbers', () => {
      // 5 fields but invalid numbers
      const badFen = 'BFBABFBCBFBABF/7/7/7/7/7/WFWAWFWCWFWAWF w x y -';
      expect(() => FEN.decode(badFen)).toThrow();
    });

    it('throws on invalid characters', () => {
      const badFen = 'BFBABFBCBFBABF/7/7/7/7/7/XFWAWFWCWFWAWF w 0 1 -';
      expect(() => FEN.decode(badFen)).toThrow();
    });

    it('handles FEN with count collapsing of empty squares', () => {
      const fen = 'BFBABFBCBFBABF/7/7/7/7/7/WFWAWFWCWFWAWF b 12 5 -';
      const state = FEN.decode(fen);
      expect(state.turn).toBe(Color.BLACK);
      expect(state.halfMoveClock).toBe(12);
      expect(state.fullMoveNumber).toBe(5);
    });

    it('handles whitespace in FEN', () => {
      const fen = '  BFBABFBCBFBABF/7/7/7/7/7/WFWAWFWCWFWAWF   w   0   1   -  ';
      const state = FEN.decode(fen);
      expect(state.turn).toBe(Color.WHITE);
    });
  });

  describe('encode → decode roundtrip (various states)', () => {
    it('preserves all state fields', () => {
      const state = new GameState();
      state.board = createInitialBoard();
      state.turn = Color.BLACK;
      state.halfMoveClock = 42;
      state.fullMoveNumber = 15;

      const fen = FEN.encode(state);
      const decoded = FEN.decode(fen);

      expect(decoded.turn).toBe(Color.BLACK);
      expect(decoded.halfMoveClock).toBe(42);
      expect(decoded.fullMoveNumber).toBe(15);
    });
  });
});
