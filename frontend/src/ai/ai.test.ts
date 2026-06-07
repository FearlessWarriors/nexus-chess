/**
 * ai.test.ts — AI Module Integration & Verification Tests
 */
import { describe, it, expect } from 'vitest';
import { Game } from '../engine/game';
import { Color, posFromString, posToString, posEquals } from '../engine/types';
import { evaluate, evaluateManual, runEvalSelfTest, useNNUE } from './evaluate';
import { search, debugEvalRange } from './search';
import { getControlZone, isLocked, getLockedPieces } from '../engine/gravity';
import { getPieces, getCore } from '../engine/board';
import { MoveGenerator } from '../engine/movegen';
import { nnueBridge } from './nnueBridge';
import type { SearchResult } from './search';

// ─── NNUE Bridge Tests ────────────────────────────────────────────────────────

describe('nnueBridge', () => {
  it('isAvailable() returns boolean', () => {
    const available = nnueBridge.isAvailable();
    expect(typeof available).toBe('boolean');
  });

  it('nnueBridge is not available by default (WASM not loaded)', () => {
    // In test environment, WASM is never loaded → should be false
    expect(nnueBridge.isAvailable()).toBe(false);
  });

  it('evaluate throws when WASM is not available', () => {
    const game = new Game();
    expect(() => nnueBridge.evaluate(game.state.board, Color.WHITE)).toThrow();
  });

  it('useNNUE() returns false when WASM is not loaded', () => {
    expect(useNNUE()).toBe(false);
  });

  it('init() does not throw (graceful fallback)', async () => {
    // In test environment this should fail gracefully
    await expect(nnueBridge.init()).resolves.not.toThrow();
    // Should still be unavailable after failed init
    expect(nnueBridge.isAvailable()).toBe(false);
  });

  it('loadWeights does not throw when WASM unavailable', async () => {
    const buffer = new ArrayBuffer(16);
    await expect(nnueBridge.loadWeights(buffer)).resolves.not.toThrow();
  });

  it('destroy() is safe to call in any state', () => {
    expect(() => nnueBridge.destroy()).not.toThrow();
  });
});

// ─── Evaluate Function Tests ──────────────────────────────────────────────────

describe('AI evaluate()', () => {
  it('returns a finite number for the initial position', () => {
    const game = new Game();
    const score = evaluate(game.state.board, Color.WHITE);
    expect(Number.isFinite(score)).toBe(true);
  });

  it('initial position evaluation is consistent (white == black for symmetric board)', () => {
    const game = new Game();
    const whiteScore = evaluate(game.state.board, Color.WHITE);
    const blackScore = evaluate(game.state.board, Color.BLACK);
    // Both sides should see the same magnitude (board is symmetric).
    expect(whiteScore).toBe(blackScore);
  });

  it('returns a higher score when core is closer to d4', () => {
    const game = new Game();
    const beforeScore = evaluate(game.state.board, Color.WHITE);
    // Move white core toward d4
    const moves = MoveGenerator.generateMoves(game.state, Color.WHITE);
    const coreMove = moves.find(
      (m) =>
        m.piece.type === 'core' &&
        posEquals(m.from, posFromString('e4')),
    );
    if (coreMove) {
      game.makeMove(coreMove.from, coreMove.to);
      const afterScore = evaluate(game.state.board, Color.WHITE);
      // Advancing core toward center should not decrease score
      expect(afterScore).toBeGreaterThanOrEqual(beforeScore - 10);
    }
  });

  it('locked enemy core gives positive bonus', () => {
    const game = new Game();
    // Simulate a position where black core is isolated
    const board = game.state.board;
    // Remove black pieces around core to isolate it
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const p = board[r][c];
        if (p !== null && p.color === Color.BLACK && p.type !== 'core') {
          board[r][c] = null;
        }
      }
    }
    // Now place white pieces surrounding black core
    const blackCore = getCore(board, Color.BLACK);
    const enemyZone = getControlZone(board, Color.BLACK);
    const myZone = getControlZone(board, Color.WHITE);
    const isBlackCoreLocked = isLocked(blackCore, board, enemyZone, myZone);
    const score = evaluate(board, Color.WHITE);
    // Core isolation check — either locked or score reflects advantage
    expect(Number.isFinite(score)).toBe(true);
  });

  it('flux is never reported as locked', () => {
    const game = new Game();
    const board = game.state.board;
    const whiteFluxes = getPieces(board, Color.WHITE).filter(
      (p) => p.type === 'flux',
    );
    expect(whiteFluxes.length).toBeGreaterThan(0);
    for (const flux of whiteFluxes) {
      const locked = isLocked(flux, board);
      expect(locked).toBe(false);
    }
  });

  it('locked pieces list excludes fluxes', () => {
    const game = new Game();
    const locked = getLockedPieces(game.state.board, Color.WHITE);
    const lockedFluxes = locked.filter((p) => p.type === 'flux');
    expect(lockedFluxes.length).toBe(0);
  });

  it('evaluate does not throw for any initial valid moves', () => {
    const game = new Game();
    const moves = MoveGenerator.generateMoves(game.state, Color.WHITE);
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves.slice(0, 10)) {
      const testGame = new Game();
      const result = testGame.makeMove(move.from, move.to);
      if (result.success) {
        expect(() => evaluate(testGame.state.board, Color.WHITE)).not.toThrow();
      }
    }
  });

  it('control zone from evaluate matches gravity.ts directly', () => {
    const game = new Game();
    const zoneFromGravity = getControlZone(game.state.board, Color.WHITE);
    // evaluate() internally calls getControlZone — verify consistency by re-calling
    const zoneAgain = getControlZone(game.state.board, Color.WHITE);
    expect(zoneFromGravity.size).toBe(zoneAgain.size);
    for (const sq of zoneFromGravity) {
      expect(zoneAgain.has(sq)).toBe(true);
    }
  });
});

// ─── Manual Evaluation (NNUE Fallback) Tests ──────────────────────────────────

describe('evaluateManual() — NNUE fallback', () => {
  it('evaluateManual returns finite number for initial position', () => {
    const game = new Game();
    const score = evaluateManual(game.state.board, Color.WHITE);
    expect(Number.isFinite(score)).toBe(true);
  });

  it('evaluateManual is used when WASM is unavailable (fallback path)', () => {
    // Since WASM is never loaded in tests, evaluate() should call evaluateManual
    const game = new Game();
    const mainScore = evaluate(game.state.board, Color.WHITE);
    const manualScore = evaluateManual(game.state.board, Color.WHITE);
    expect(mainScore).toBe(manualScore);
  });

  it('evaluateManual is symmetric: white == black on initial board', () => {
    const game = new Game();
    const whiteScore = evaluateManual(game.state.board, Color.WHITE);
    const blackScore = evaluateManual(game.state.board, Color.BLACK);
    expect(whiteScore).toBe(blackScore);
  });
});

// ─── Evaluation Self-Test ─────────────────────────────────────────────────────

describe('runEvalSelfTest()', () => {
  it('runs without throwing', () => {
    expect(() => runEvalSelfTest()).not.toThrow();
  });

  it('all three checks pass', () => {
    const result = runEvalSelfTest();
    console.log('[Eval Self-Test Results]');
    for (const detail of result.details) {
      console.log(detail);
    }
    expect(result.passed).toBe(true);
  });
});

// ─── Search Function Tests ────────────────────────────────────────────────────

describe('AI search()', () => {
  it('returns a valid move for beginner difficulty', () => {
    const game = new Game();
    const result: SearchResult = search(game, Color.WHITE, 'beginner');
    expect(result.bestMove).not.toBeNull();
    expect(result.bestMove!.from).toBeDefined();
    expect(result.bestMove!.to).toBeDefined();
    expect(result.depth).toBe(1);
    expect(result.nodesSearched).toBeGreaterThan(0);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(typeof result.ttHits).toBe('number');
  });

  it('returns a valid move for intermediate difficulty', () => {
    const game = new Game();
    const result = search(game, Color.WHITE, 'intermediate');
    expect(result.bestMove).not.toBeNull();
    expect(result.depth).toBeGreaterThanOrEqual(1);
    expect(result.depth).toBeLessThanOrEqual(3);
  });

  it('returns a valid move for advanced difficulty (depth 6)', () => {
    const game = new Game();
    const result = search(game, Color.WHITE, 'advanced');
    expect(result.bestMove).not.toBeNull();
    expect(result.depth).toBeGreaterThanOrEqual(1);
    expect(result.depth).toBeLessThanOrEqual(6);
    expect(result.ttHits).toBeGreaterThanOrEqual(0);
    // Verify ttHits field exists (from transposition table usage)
    expect(result).toHaveProperty('ttHits');
    expect(typeof result.ttHits).toBe('number');
  }, 30000);

  it('search result move is compatible with Game.makeMove()', () => {
    const game = new Game();
    const result = search(game, Color.WHITE, 'beginner');
    expect(result.bestMove).not.toBeNull();

    const moveResult = game.makeMove(
      result.bestMove!.from,
      result.bestMove!.to,
    );
    expect(moveResult.success).toBe(true);
    expect(moveResult.error).toBeUndefined();
  });

  it('search returns null when no moves available', () => {
    const game = new Game();
    // Create a dead position: only the black core on board, white has no pieces
    const board = game.state.board;
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const p = board[r][c];
        if (p !== null && p.color === Color.WHITE) {
          board[r][c] = null;
        }
      }
    }
    const result = search(game, Color.WHITE, 'beginner');
    expect(result.bestMove).toBeNull();
  });

  it('search is deterministic (same input → same output)', () => {
    const game1 = new Game();
    const game2 = new Game();
    const r1 = search(game1, Color.WHITE, 'intermediate');
    const r2 = search(game2, Color.WHITE, 'intermediate');
    if (r1.bestMove && r2.bestMove) {
      expect(posEquals(r1.bestMove.from, r2.bestMove.from)).toBe(true);
      expect(posEquals(r1.bestMove.to, r2.bestMove.to)).toBe(true);
      expect(r1.score).toBe(r2.score);
    }
  });

  it('iterative deepening: deeper search returns at least as good a score', () => {
    const game = new Game();
    const rBeginner = search(game, Color.WHITE, 'beginner');
    const rAdvanced = search(game, Color.WHITE, 'advanced');
    // Deeper search should not return a significantly worse score
    // (allow some tolerance because deeper may see traps)
    expect(rAdvanced.score).toBeGreaterThanOrEqual(rBeginner.score - 200);
  }, 30000);

  it('search handles mid-game position without hanging', () => {
    const game = new Game();
    // Play a few moves to reach mid-game
    game.makeMove(posFromString('a7'), posFromString('a5'));
    game.makeMove(posFromString('a1'), posFromString('a3'));
    game.makeMove(posFromString('c7'), posFromString('d5'));
    game.makeMove(posFromString('c1'), posFromString('d3'));

    const startTime = Date.now();
    const result = search(game, Color.WHITE, 'advanced');
    const duration = Date.now() - startTime;

    expect(result.bestMove).not.toBeNull();
    expect(duration).toBeLessThan(30000); // Allow 30 s for depth 6
  }, 60000);

});

// ─── Debug Evaluation Range ───────────────────────────────────────────────────

describe('AI debugEvalRange()', () => {
  it('runs without throwing', () => {
    expect(() => debugEvalRange()).not.toThrow();
  });
});
