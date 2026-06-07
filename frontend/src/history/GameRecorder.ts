import { Game } from '../engine/game';
import { FEN } from '../engine/fen';
import { GameStatus } from '../engine/types';
import type { GameState, Color } from '../engine/types';
import type { GameRecord, MoveRecord } from './types';

/** Game mode type */
export type GameMode = 'local' | 'online';

/**
 * GameRecorder wraps a Game instance and records every move with timing
 * information. It listens to the Game's onStateChange and onGameOver
 * callbacks, preserving any previously-registered handlers via chaining.
 *
 * Usage:
 *   const recorder = new GameRecorder();
 *   recorder.startRecording(game, 'local');
 *   // ... game proceeds ...
 *   const record = recorder.stopRecording();
 */
export class GameRecorder {
  private game: Game | null = null;
  private mode: GameMode = 'local';
  private moves: MoveRecord[] = [];
  private startTime: number = 0;
  private lastMoveTime: number = 0;
  private pauseStart: number | null = null;
  private totalPausedTime: number = 0;
  private initialFen: string = '';
  private gameResult: { status: GameStatus; winner: Color | null } = {
    status: GameStatus.IN_PROGRESS,
    winner: null,
  };
  private recording: boolean = false;

  // Saved previous callbacks for chaining
  private prevOnStateChange?: (state: GameState) => void;
  private prevOnGameOver?: (result: { status: GameStatus; winner: Color | null }) => void;
  private prevUndoMove?: () => boolean;

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Begin recording a game. Registers callbacks on the Game instance.
   * @param game The Game controller to record
   * @param mode Game mode ('local' or 'online')
   */
  startRecording(game: Game, mode: GameMode): void {
    if (this.recording) {
      this.stopRecording();
    }

    this.game = game;
    this.mode = mode;
    this.moves = [];
    this.startTime = Date.now();
    this.lastMoveTime = this.startTime;
    this.totalPausedTime = 0;
    this.pauseStart = null;
    this.initialFen = FEN.encode(game.state);
    this.gameResult = { status: GameStatus.IN_PROGRESS, winner: null };
    this.recording = true;

    // Save and chain existing callbacks
    this.prevOnStateChange = game.onStateChange;
    this.prevOnGameOver = game.onGameOver;

    game.onStateChange = (state: GameState) => {
      this.handleStateChange(state);
      this.prevOnStateChange?.(state);
    };

    game.onGameOver = (result: { status: GameStatus; winner: Color | null }) => {
      this.handleGameOver(result);
      this.prevOnGameOver?.(result);
    };

    // Also intercept undo — when undo happens, we need to pop our recorded move
    this.prevUndoMove = game.undoMove.bind(game);
    const self = this;
    game.undoMove = function (this: Game): boolean {
      const result = self.prevUndoMove!();
      if (result && self.moves.length > 0) {
        self.moves.pop();
        self.lastMoveTime = Date.now();
      }
      return result;
    };
  }

  /**
   * Stop recording and return the completed GameRecord.
   * Restores the original Game callbacks.
   */
  stopRecording(): GameRecord {
    this.recording = false;

    if (this.game) {
      this.game.onStateChange = this.prevOnStateChange;
      this.game.onGameOver = this.prevOnGameOver;
      if (this.prevUndoMove) {
        this.game.undoMove = this.prevUndoMove;
      }
      this.prevOnStateChange = undefined;
      this.prevOnGameOver = undefined;
      this.prevUndoMove = undefined;
      this.game = null;
    }

    return this.buildRecord();
  }

  /** Pause the move timer. Subsequent moves will not accrue time. */
  pause(): void {
    if (!this.recording || this.pauseStart !== null) {
      return;
    }
    this.pauseStart = Date.now();
  }

  /** Resume the move timer after a pause. */
  resume(): void {
    if (!this.recording || this.pauseStart === null) {
      return;
    }
    this.totalPausedTime += Date.now() - this.pauseStart;
    this.pauseStart = null;
  }

  /** Whether recording is currently active */
  get isRecording(): boolean {
    return this.recording;
  }

  /** Number of moves recorded so far */
  get moveCount(): number {
    return this.moves.length;
  }

  // ── Internal Handlers ───────────────────────────────────────────────────

  /**
   * Called after every state change (i.e., after every successful move).
   * Records the last move from the move history with timing and FEN.
   */
  private handleStateChange(state: GameState): void {
    if (!this.recording) {
      return;
    }

    // If no moves have been made yet, nothing to record
    if (state.moveHistory.length === 0) {
      return;
    }

    const now = Date.now();

    // Check if we already recorded this move (guard against double-fires)
    const recordedCount = this.moves.length;
    if (recordedCount >= state.moveHistory.length) {
      return;
    }

    // Record any new moves that haven't been recorded yet
    for (let i = recordedCount; i < state.moveHistory.length; i++) {
      const move = state.moveHistory[i];
      const timeSpent = i === 0
        ? now - this.startTime - this.totalPausedTime
        : now - this.lastMoveTime;
      this.lastMoveTime = now;

      const fenAfter = FEN.encode(state);

      this.moves.push({
        moveNumber: state.fullMoveNumber,
        from: { col: move.from.col, row: move.from.row },
        to: { col: move.to.col, row: move.to.row },
        notation: move.notation,
        fenAfter,
        timestamp: now,
        timeSpent: Math.max(0, timeSpent),
      });
    }
  }

  /**
   * Called when the game ends. Stores the result.
   */
  private handleGameOver(result: { status: GameStatus; winner: Color | null }): void {
    if (!this.recording) {
      return;
    }
    this.gameResult = { status: result.status, winner: result.winner };
  }

  // ── Record Building ─────────────────────────────────────────────────────

  /** Build the final GameRecord from accumulated data */
  private buildRecord(): GameRecord {
    const endTime = Date.now();
    const activeDuration = endTime - this.startTime - this.totalPausedTime;

    const lastMove = this.moves.length > 0
      ? this.moves[this.moves.length - 1]
      : null;
    const finalFen = lastMove !== null ? lastMove.fenAfter : this.initialFen;

    return {
      id: GameRecorder.generateId(),
      date: new Date(this.startTime).toISOString(),
      players: {
        white: 'White',
        black: 'Black',
      },
      result: {
        status: this.gameResult.status,
        winner: this.gameResult.winner,
      },
      moves: this.moves,
      initialFen: this.initialFen,
      finalFen,
      duration: Math.max(0, activeDuration),
      mode: this.mode,
    };
  }

  /** Generate a unique game ID */
  private static generateId(): string {
    return `game_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  }
}
