// ─── Shared Constants ────────────────────────────────────────────────────────

/** Board dimension: 7 columns × 7 rows */
export const BOARD_SIZE = 7;

/** Center square d4 */
export const CENTER: Position = { col: 3, row: 3 };

/** Pieces per side */
export const PIECES_PER_SIDE = 7;

/** Same position appearing this many times triggers a draw */
export const REPETITION_LIMIT = 3;

/** 50 full moves (100 half-moves) without capture triggers a draw */
export const FIFTY_MOVE_LIMIT = 50;

/** Flux jump range: exactly 2 squares */
export const FLUX_RANGE = 2;

/** Middle row index where Core evolution triggers */
export const CORE_EVOLVE_ROW = 3;

// ─── Enums ────────────────────────────────────────────────────────────────────

/** Player color */
export enum Color {
  WHITE = 'white',
  BLACK = 'black',
}

/** Piece types under the gravity-lock ruleset */
export enum PieceType {
  CORE = 'core',
  ANCHOR = 'anchor',
  FLUX = 'flux',
}

/** Game termination status */
export enum GameStatus {
  IN_PROGRESS = 0,
  WHITE_WIN = 1,
  BLACK_WIN = 2,
  DRAW = 3,
  WHITE_RESIGN = 4,
  BLACK_RESIGN = 5,
}

/** Move classification flags */
export enum MoveFlag {
  NORMAL = 0,
  /** Push move: displaces the enemy core by one square */
  PUSH = 1,
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

/** Board coordinate (0-indexed internally) */
export interface Position {
  col: number; // 0–6, maps to a–g
  row: number; // 0–6, maps to 1–7
}

/** A piece on the board */
export interface Piece {
  type: PieceType;
  color: Color;
  pos: Position;
}

/** A recorded move with metadata */
export interface Move {
  from: Position;
  to: Position;
  piece: Piece;
  /** Pushed piece (non-null only for PUSH moves — the target that was displaced) */
  pushed: Piece | null;
  /** Destination of the pushed piece (non-null only for PUSH moves) */
  pushedTo: Position | null;
  flag: MoveFlag;
  /** Human-readable notation e.g. "d2d4", "Pd4→d3" */
  notation: string;
}

/** 7×7 grid; null = empty square */
export type BoardGrid = (Piece | null)[][];

// ─── GameState ────────────────────────────────────────────────────────────────

/** Immutable-ish snapshot of the complete game state */
export class GameState {
  board: BoardGrid;
  turn: Color;
  status: GameStatus;
  moveHistory: Move[];
  halfMoveClock: number;
  fullMoveNumber: number;
  /** Tracks board-position → occurrence count for repetition detection */
  positionCount: Map<string, number>;
  winner: Color | null;
  /** Whether each color's core is in cooldown (true = cannot move this turn) */
  coreCooldown: Map<Color, boolean>;
  /** Which color's core occupied d4 at the START of the current turn (null = none) */
  sanctuaryOccupied: Color | null;
  /**
   * Anchor overload tracker.
   * Key format: "c{col}r{row}" (e.g. "c2r4").
   * Value: number of consecutive own turns this Anchor was locked in enemy zone.
   */
  anchorOverloadTracker: Map<string, number>;

  constructor() {
    this.board = [];
    this.turn = Color.WHITE;
    this.status = GameStatus.IN_PROGRESS;
    this.moveHistory = [];
    this.halfMoveClock = 0;
    this.fullMoveNumber = 1;
    this.positionCount = new Map();
    this.winner = null;
    this.coreCooldown = new Map([
      [Color.WHITE, false],
      [Color.BLACK, false],
    ]);
    this.sanctuaryOccupied = null;
    this.anchorOverloadTracker = new Map();
  }

  /** Deep-clone the entire game state */
  clone(): GameState {
    const state = new GameState();
    state.board = this.board.map((row) =>
      row.map((cell) =>
        cell !== null ? { ...cell, pos: { ...cell.pos } } : null,
      ),
    );
    state.turn = this.turn;
    state.status = this.status;
    state.moveHistory = this.moveHistory.map((m) => ({
      ...m,
      from: { ...m.from },
      to: { ...m.to },
      piece: { ...m.piece, pos: { ...m.piece.pos } },
      pushed: m.pushed !== null ? { ...m.pushed, pos: { ...m.pushed.pos } } : null,
      pushedTo: m.pushedTo !== null ? { ...m.pushedTo } : null,
    }));
    state.halfMoveClock = this.halfMoveClock;
    state.fullMoveNumber = this.fullMoveNumber;
    state.positionCount = new Map(this.positionCount);
    state.winner = this.winner;
    state.coreCooldown = new Map(this.coreCooldown);
    state.sanctuaryOccupied = this.sanctuaryOccupied;
    state.anchorOverloadTracker = new Map(this.anchorOverloadTracker);
    return state;
  }
}

// ─── Position Utilities ───────────────────────────────────────────────────────

/** "d4" → { col: 3, row: 3 } */
const COL_LOOKUP: Record<string, number> = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6 };
const COL_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

export function posFromString(s: string): Position {
  if (s.length < 2) {
    throw new Error(`Invalid position string: "${s}"`);
  }
  const colChar = s[0].toLowerCase();
  const rowStr = s.slice(1);
  const col = COL_LOOKUP[colChar];
  const row = parseInt(rowStr, 10) - 1;
  if (col === undefined || row < 0 || row >= BOARD_SIZE) {
    throw new Error(`Invalid position string: "${s}"`);
  }
  return { col, row };
}

/** { col: 3, row: 3 } → "d4" */
export function posToString(p: Position): string {
  return COL_LETTERS[p.col] + (p.row + 1).toString();
}

/** Structural equality for two positions */
export function posEquals(a: Position, b: Position): boolean {
  return a.col === b.col && a.row === b.row;
}

/** Is the position within the 7×7 board? */
export function isValidPosition(p: Position): boolean {
  return p.col >= 0 && p.col < BOARD_SIZE && p.row >= 0 && p.row < BOARD_SIZE;
}

/** Is the position the center square d4? */
export function isCenter(p: Position): boolean {
  return p.col === CENTER.col && p.row === CENTER.row;
}

/** Toggle color */
export function opponentColor(c: Color): Color {
  return c === Color.WHITE ? Color.BLACK : Color.WHITE;
}

/**
 * Generate the anchor overload tracker key for a given position.
 * Format: "c{col}r{row}"
 */
export function overloadKey(col: number, row: number): string {
  return `c${col}r${row}`;
}
