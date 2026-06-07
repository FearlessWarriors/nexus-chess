import { FEN } from '../engine/fen';
import { GameState, GameStatus } from '../engine/types';
import type { GameRecord } from './types';
import type { ReplayStatus } from './types';

/**
 * ReplayController enables step-by-step replay of a recorded game.
 * It operates independently from the live Game controller — it reconstructs
 * GameState instances from stored FEN strings for each move.
 *
 * Usage:
 *   const replay = new ReplayController();
 *   replay.load(gameRecord);
 *   replay.stepForward();   // advance one move
 *   replay.stepBackward();  // go back one move
 *   const state = replay.currentState; // current board position
 */
export class ReplayController {
  private gameRecord: GameRecord | null = null;
  private moveIndex: number = 0;
  private status: ReplayStatus = 'idle';
  private autoPlayTimer: ReturnType<typeof setInterval> | null = null;
  private autoPlayInterval: number = 1000;

  // ── Loading ─────────────────────────────────────────────────────────────

  /**
   * Load a game record for replay. Resets all state to the initial position.
   */
  load(gameRecord: GameRecord): void {
    this.stopAutoPlay();
    this.gameRecord = gameRecord;
    this.moveIndex = 0;
    this.status = 'idle';
  }

  /** Unload the current game and reset to idle */
  unload(): void {
    this.stopAutoPlay();
    this.gameRecord = null;
    this.moveIndex = 0;
    this.status = 'idle';
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  /** Advance to the next move. Returns false if already at the end. */
  stepForward(): boolean {
    if (this.gameRecord === null) {
      return false;
    }
    if (this.moveIndex >= this.gameRecord.moves.length) {
      // Already at end — mark as finished
      if (this.status === 'playing') {
        this.status = 'finished';
        this.stopAutoPlay();
      }
      return false;
    }
    this.moveIndex++;
    this._updateStatusAfterManualStep();
    return true;
  }

  /** Go back to the previous move. Returns false if already at the start. */
  stepBackward(): boolean {
    if (this.gameRecord === null) {
      return false;
    }
    if (this.moveIndex <= 0) {
      return false;
    }
    this.moveIndex--;
    this._updateStatusAfterManualStep();
    return true;
  }

  /** Jump directly to the initial position (before any moves). */
  goToStart(): void {
    if (this.gameRecord === null) {
      return;
    }
    this.stopAutoPlay();
    this.moveIndex = 0;
    this.status = 'idle';
  }

  /** Jump to the final position (after all moves). */
  goToEnd(): void {
    if (this.gameRecord === null) {
      return;
    }
    this.stopAutoPlay();
    this.moveIndex = this.gameRecord.moves.length;
    this._updateStatusAfterManualStep();
  }

  /**
   * Jump to a specific move index.
   * @param n Move index (0 = initial, 1 = after first move, etc.)
   *          Clamped to valid range [0, totalMoves].
   */
  goToMove(n: number): void {
    if (this.gameRecord === null) {
      return;
    }
    this.stopAutoPlay();
    this.moveIndex = Math.max(0, Math.min(n, this.gameRecord.moves.length));
    this._updateStatusAfterManualStep();
  }

  // ── Auto-play ───────────────────────────────────────────────────────────

  /**
   * Start auto-playing the game at the specified interval.
   * @param intervalMs Milliseconds between moves (default 1000).
   *                   A value of 0 is treated as 100ms minimum.
   */
  autoPlay(intervalMs: number = 1000): void {
    if (this.gameRecord === null) {
      return;
    }

    // Stop any existing auto-play
    this.stopAutoPlay();

    this.autoPlayInterval = Math.max(100, intervalMs);
    this.status = 'playing';

    // If at the end, reset to start
    if (this.moveIndex >= this.gameRecord.moves.length) {
      this.moveIndex = 0;
    }

    this.autoPlayTimer = setInterval(() => {
      if (this.gameRecord === null) {
        this.stopAutoPlay();
        this.status = 'idle';
        return;
      }

      if (this.moveIndex >= this.gameRecord.moves.length) {
        this.status = 'finished';
        this.stopAutoPlay();
        return;
      }

      this.moveIndex++;
      if (this.moveIndex >= this.gameRecord.moves.length) {
        this.status = 'finished';
        this.stopAutoPlay();
      }
    }, this.autoPlayInterval);
  }

  /** Pause auto-play at the current position. */
  pause(): void {
    if (this.status !== 'playing') {
      return;
    }
    this.stopAutoPlay();
    this.status = 'paused';
  }

  /** Resume auto-play from the current position. */
  resume(): void {
    if (this.status !== 'paused' || this.gameRecord === null) {
      return;
    }
    this.autoPlay(this.autoPlayInterval);
  }

  // ── Getters ─────────────────────────────────────────────────────────────

  /** The current board state as a GameState instance */
  get currentState(): GameState | null {
    if (this.gameRecord === null) {
      return null;
    }

    // Determine which FEN to decode
    let fen: string;
    if (this.moveIndex === 0) {
      fen = this.gameRecord.initialFen;
    } else {
      fen = this.gameRecord.moves[this.moveIndex - 1].fenAfter;
    }

    const state = FEN.decode(fen);

    // If we're at the final position and the game ended, set result status
    if (
      this.moveIndex === this.totalMoves &&
      this.totalMoves > 0 &&
      this.gameRecord.result.status !== GameStatus.IN_PROGRESS
    ) {
      state.status = this.gameRecord.result.status;
      state.winner = this.gameRecord.result.winner;
    }

    return state;
  }

  /** Current move index (0 = initial position, N = after N moves) */
  get currentMoveIndex(): number {
    return this.moveIndex;
  }

  /** Total number of moves in the loaded game */
  get totalMoves(): number {
    return this.gameRecord !== null ? this.gameRecord.moves.length : 0;
  }

  /** Current replay status */
  get currentStatus(): ReplayStatus {
    return this.status;
  }

  /** Check if the replay has a game loaded */
  get isLoaded(): boolean {
    return this.gameRecord !== null;
  }

  /** Get the loaded game record (or null) */
  get loadedGame(): GameRecord | null {
    return this.gameRecord;
  }

  // ── Internal Helpers ────────────────────────────────────────────────────

  /** Update status after a manual navigation step */
  private _updateStatusAfterManualStep(): void {
    if (this.gameRecord === null) {
      this.status = 'idle';
      return;
    }

    if (this.moveIndex === 0) {
      this.status = 'idle';
    } else if (this.moveIndex >= this.gameRecord.moves.length) {
      this.status = 'finished';
    } else {
      this.status = 'paused';
    }
  }

  /** Stop and clean up the auto-play interval timer */
  private stopAutoPlay(): void {
    if (this.autoPlayTimer !== null) {
      clearInterval(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
  }
}
