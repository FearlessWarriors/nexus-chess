import { describe, it, expect, beforeEach } from 'vitest';
import { Game } from '../engine/game';
import { GameRecorder } from './GameRecorder';
import { ReplayController } from './ReplayController';
import { GameStatus, Color, posFromString } from '../engine/types';
import type { GameRecord } from './types';

describe('GameRecorder', () => {
  let game: Game;
  let recorder: GameRecorder;

  beforeEach(() => {
    game = new Game();
    recorder = new GameRecorder();
  });

  it('starts recording and captures initial FEN', () => {
    recorder.startRecording(game, 'local');
    expect(recorder.isRecording).toBe(true);
    expect(recorder.moveCount).toBe(0);
  });

  it('records moves as they are made', () => {
    recorder.startRecording(game, 'local');
    
    // White Flux a7→a5 (row 6→4)
    game.makeMove(posFromString('a7'), posFromString('a5'));
    expect(recorder.moveCount).toBe(1);

    // Black Flux a1→a3 (row 0→2)
    game.makeMove(posFromString('a1'), posFromString('a3'));
    expect(recorder.moveCount).toBe(2);
  });

  it('builds a complete GameRecord on stop', () => {
    recorder.startRecording(game, 'local');
    
    game.makeMove(posFromString('a7'), posFromString('a5'));
    game.makeMove(posFromString('a1'), posFromString('a3'));

    const record = recorder.stopRecording();
    expect(record.moves.length).toBe(2);
    expect(record.mode).toBe('local');
    expect(record.players.white).toBe('White');
    expect(record.players.black).toBe('Black');
    expect(record.moves[0].notation).toBe('a7a5');
    expect(record.moves[1].notation).toBe('a1a3');
    expect(record.initialFen).toBeDefined();
    expect(record.finalFen).toBeDefined();
    expect(record.id).toBeDefined();
    expect(record.date).toBeDefined();
    expect(record.duration).toBeGreaterThanOrEqual(0);
    expect(recorder.isRecording).toBe(false);
  });

  it('restores original game callbacks on stop', () => {
    const originalCallback = game.onStateChange;
    recorder.startRecording(game, 'local');
    expect(game.onStateChange).not.toBe(originalCallback);

    recorder.stopRecording();
    expect(game.onStateChange).toBeUndefined();
  });

  it('can pause and resume timer', () => {
    recorder.startRecording(game, 'local');
    recorder.pause();
    recorder.resume();
    expect(recorder.isRecording).toBe(true);
  });

  it('does not crash on stop without start', () => {
    const record = recorder.stopRecording();
    expect(record.moves.length).toBe(0);
    expect(record.initialFen).toBe('');
  });

  it('generates unique IDs', () => {
    recorder.startRecording(game, 'local');
    game.makeMove(posFromString('a7'), posFromString('a5'));
    const record1 = recorder.stopRecording();

    const game2 = new Game();
    const recorder2 = new GameRecorder();
    recorder2.startRecording(game2, 'local');
    game2.makeMove(posFromString('g7'), posFromString('g5'));
    const record2 = recorder2.stopRecording();

    expect(record1.id).not.toBe(record2.id);
  });

  it('records move timing data', () => {
    recorder.startRecording(game, 'local');
    game.makeMove(posFromString('a7'), posFromString('a5'));

    const record = recorder.stopRecording();
    expect(record.moves.length).toBe(1);
    expect(record.moves[0].timestamp).toBeGreaterThan(0);
    expect(record.moves[0].timeSpent).toBeGreaterThanOrEqual(0);
  });
});

describe('ReplayController', () => {
  let game: Game;
  let recorder: GameRecorder;
  let replay: ReplayController;
  let gameRecord: GameRecord;

  beforeEach(() => {
    game = new Game();
    recorder = new GameRecorder();
    replay = new ReplayController();

    // Create a recorded game with 3 moves
    recorder.startRecording(game, 'local');
    game.makeMove(posFromString('a7'), posFromString('a5')); // White Flux
    game.makeMove(posFromString('a1'), posFromString('a3')); // Black Flux
    game.makeMove(posFromString('b7'), posFromString('b5')); // White Anchor
    gameRecord = recorder.stopRecording();
  });

  it('loads a game record', () => {
    replay.load(gameRecord);
    expect(replay.isLoaded).toBe(true);
    expect(replay.totalMoves).toBe(3);
    expect(replay.currentMoveIndex).toBe(0);
    expect(replay.currentStatus).toBe('idle');
  });

  it('steps forward correctly', () => {
    replay.load(gameRecord);

    expect(replay.stepForward()).toBe(true);
    expect(replay.currentMoveIndex).toBe(1);

    expect(replay.stepForward()).toBe(true);
    expect(replay.currentMoveIndex).toBe(2);
  });

  it('steps backward correctly', () => {
    replay.load(gameRecord);
    replay.goToEnd();

    expect(replay.stepBackward()).toBe(true);
    expect(replay.currentMoveIndex).toBe(2);

    expect(replay.stepBackward()).toBe(true);
    expect(replay.currentMoveIndex).toBe(1);
  });

  it('returns false when stepping past end', () => {
    replay.load(gameRecord);
    replay.goToEnd();
    expect(replay.currentMoveIndex).toBe(3);
    expect(replay.stepForward()).toBe(false);
  });

  it('returns false when stepping before start', () => {
    replay.load(gameRecord);
    expect(replay.currentMoveIndex).toBe(0);
    expect(replay.stepBackward()).toBe(false);
  });

  it('goToStart resets to initial position', () => {
    replay.load(gameRecord);
    replay.goToEnd();
    replay.goToStart();
    expect(replay.currentMoveIndex).toBe(0);
    expect(replay.currentStatus).toBe('idle');
  });

  it('goToEnd jumps to final position', () => {
    replay.load(gameRecord);
    replay.goToEnd();
    expect(replay.currentMoveIndex).toBe(3);
    expect(replay.currentStatus).toBe('finished');
  });

  it('goToMove clamps to valid range', () => {
    replay.load(gameRecord);
    replay.goToMove(2);
    expect(replay.currentMoveIndex).toBe(2);

    replay.goToMove(-5);
    expect(replay.currentMoveIndex).toBe(0);

    replay.goToMove(999);
    expect(replay.currentMoveIndex).toBe(3);
  });

  it('currentState returns GameState', () => {
    replay.load(gameRecord);
    const state = replay.currentState;
    expect(state).not.toBeNull();
    expect(state!.turn).toBeDefined();

    // After stepping forward, state changes
    replay.stepForward();
    const stateAfter = replay.currentState;
    expect(stateAfter).not.toBeNull();
  });

  it('unload clears the game', () => {
    replay.load(gameRecord);
    replay.unload();
    expect(replay.isLoaded).toBe(false);
    expect(replay.totalMoves).toBe(0);
    expect(replay.currentMoveIndex).toBe(0);
    expect(replay.currentStatus).toBe('idle');
  });

  it('stepForward with no game loaded returns false', () => {
    expect(replay.stepForward()).toBe(false);
  });

  it('stepBackward with no game loaded returns false', () => {
    expect(replay.stepBackward()).toBe(false);
  });
});
