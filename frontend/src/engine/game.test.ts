import { describe, it, expect, beforeEach } from 'vitest';
import { Game } from './game';
import { Color, GameStatus, PieceType, posFromString, posEquals } from './types';
import { FEN } from './fen';

describe('Game', () => {
  let game: Game;

  beforeEach(() => {
    game = new Game();
  });

  describe('initialization', () => {
    it('starts with White to move', () => {
      expect(game.state.turn).toBe(Color.WHITE);
    });

    it('starts with IN_PROGRESS status', () => {
      expect(game.state.status).toBe(GameStatus.IN_PROGRESS);
    });

    it('has no moves in history', () => {
      expect(game.state.moveHistory.length).toBe(0);
    });

    it('has fullMoveNumber = 1', () => {
      expect(game.state.fullMoveNumber).toBe(1);
    });

    it('has halfMoveClock = 0', () => {
      expect(game.state.halfMoveClock).toBe(0);
    });

    it('has coreCooldown false for both sides', () => {
      expect(game.state.coreCooldown.get(Color.WHITE)).toBe(false);
      expect(game.state.coreCooldown.get(Color.BLACK)).toBe(false);
    });

    it('has sanctuaryOccupied = null', () => {
      expect(game.state.sanctuaryOccupied).toBeNull();
    });
  });

  describe('makeMove', () => {
    it('White Flux a7→a5 is legal', () => {
      const result = game.makeMove(
        posFromString('a7'),
        posFromString('a5'),
      );
      expect(result.success).toBe(true);
    });

    it('Piece not found at source returns error', () => {
      const result = game.makeMove(
        posFromString('d4'),
        posFromString('d5'),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('No piece');
    });

    it('Wrong turn returns error', () => {
      const result = game.makeMove(
        posFromString('a1'),
        posFromString('a3'),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('turn');
    });

    it('After White move, turn switches to Black', () => {
      game.makeMove(posFromString('a7'), posFromString('a5'));
      expect(game.state.turn).toBe(Color.BLACK);
    });

    it('After White and Black move, turn switches to White', () => {
      game.makeMove(posFromString('a7'), posFromString('a5'));
      game.makeMove(posFromString('a1'), posFromString('a3'));
      expect(game.state.turn).toBe(Color.WHITE);
      expect(game.state.fullMoveNumber).toBe(2);
    });

    it('Records moves in history', () => {
      game.makeMove(posFromString('a7'), posFromString('a5'));
      expect(game.state.moveHistory.length).toBe(1);
    });

    it('Cannot move after game is over', () => {
      game.state.status = GameStatus.WHITE_WIN;
      const result = game.makeMove(
        posFromString('a7'),
        posFromString('a5'),
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('already over');
    });
  });

  describe('getLegalMoves', () => {
    it('returns positions for a piece that can move', () => {
      const moves = game.getLegalMoves(posFromString('a7'));
      expect(moves.length).toBeGreaterThan(0);
    });

    it('returns empty for enemy piece', () => {
      const moves = game.getLegalMoves(posFromString('a1'));
      expect(moves.length).toBe(0);
    });

    it('returns empty for empty square', () => {
      const moves = game.getLegalMoves(posFromString('d4'));
      expect(moves.length).toBe(0);
    });
  });

  describe('undoMove', () => {
    it('undo restores previous state', () => {
      const initialTurn = game.state.turn;
      game.makeMove(posFromString('a7'), posFromString('a5'));
      expect(game.state.turn).toBe(Color.BLACK);

      const result = game.undoMove();
      expect(result).toBe(true);
      expect(game.state.turn).toBe(initialTurn);
      expect(game.state.moveHistory.length).toBe(0);
    });

    it('undo returns false when no moves', () => {
      expect(game.undoMove()).toBe(false);
    });

    it('undo after two moves restores previous state', () => {
      game.makeMove(posFromString('a7'), posFromString('a5'));
      game.makeMove(posFromString('a1'), posFromString('a3'));
      expect(game.state.moveHistory.length).toBe(2);

      game.undoMove();
      expect(game.state.moveHistory.length).toBe(1);
      expect(game.state.turn).toBe(Color.BLACK);
    });
  });

  describe('reset', () => {
    it('resets to initial state', () => {
      game.makeMove(posFromString('a7'), posFromString('a5'));
      game.reset();
      expect(game.state.turn).toBe(Color.WHITE);
      expect(game.state.moveHistory.length).toBe(0);
      expect(game.state.fullMoveNumber).toBe(1);
    });
  });

  describe('onStateChange callback', () => {
    it('fires after successful move', () => {
      let fired = false;
      game.onStateChange = () => { fired = true; };
      game.makeMove(posFromString('a7'), posFromString('a5'));
      expect(fired).toBe(true);
    });

    it('fires after reset', () => {
      let fired = false;
      game.onStateChange = () => { fired = true; };
      game.reset();
      expect(fired).toBe(true);
    });
  });
});
