import type { Position, Color, GameStatus } from '../engine/types';

// ─── Move Record ──────────────────────────────────────────────────────────────

/** A recorded move with metadata for history / replay */
export interface MoveRecord {
  /** Chess move number (1-indexed, follows standard notation: increments after Black's move) */
  moveNumber: number;
  /** Source square */
  from: Position;
  /** Destination square */
  to: Position;
  /** Human-readable notation e.g. "d2d4", "Nd2f4" */
  notation: string;
  /** FEN string of the board position AFTER this move */
  fenAfter: string;
  /** Wall-clock timestamp (ms since epoch) when the move was made */
  timestamp: number;
  /** Time the player spent on this move (milliseconds) */
  timeSpent: number;
}

// ─── Game Record ──────────────────────────────────────────────────────────────

/** Complete record of a finished game */
export interface GameRecord {
  /** Unique identifier */
  id: string;
  /** ISO 8601 date string of when the game started */
  date: string;
  /** Player names (or anonymous identifiers) */
  players: {
    white: string;
    black: string;
  };
  /** Final game result */
  result: {
    status: GameStatus;
    winner: Color | null;
  };
  /** Ordered list of recorded moves */
  moves: MoveRecord[];
  /** FEN string of the starting position */
  initialFen: string;
  /** FEN string of the final board position */
  finalFen: string;
  /** Total game duration in milliseconds (active play time only) */
  duration: number;
  /** Game mode */
  mode: 'local' | 'online';
}

// ─── Player Statistics ────────────────────────────────────────────────────────

/** Aggregated statistics across all recorded games */
export interface PlayerStats {
  /** Total number of recorded games */
  totalGames: number;
  /** Number of wins */
  wins: number;
  /** Number of losses */
  losses: number;
  /** Number of draws */
  draws: number;
  /** Win rate as a fraction (0–1) */
  winRate: number;
  /** Average moves per game */
  avgMovesPerGame: number;
  /** Most common opening (notation of the most frequent first move) */
  favoriteOpening: string;
  /** Elo rating estimate (optional) */
  elo?: number;
}

// ─── Filtering & Pagination ───────────────────────────────────────────────────

/** Filter criteria for listing games */
export interface ListGamesFilter {
  /** Filter by game mode */
  mode?: 'local' | 'online';
  /** Filter by date range (both bounds inclusive) */
  dateRange?: {
    from: string;
    to: string;
  };
  /** Filter by game result from the perspective of the first-listed player */
  result?: 'win' | 'loss' | 'draw';
}

/** Paginated result wrapper */
export interface PaginatedResult<T> {
  /** Items for the current page */
  items: T[];
  /** Current page number (0-indexed) */
  page: number;
  /** Number of items per page */
  pageSize: number;
  /** Total number of items matching the filter */
  total: number;
  /** Whether there are more pages after this one */
  hasMore: boolean;
}

// ─── Replay Status ────────────────────────────────────────────────────────────

/** Possible states of the replay controller */
export type ReplayStatus = 'idle' | 'playing' | 'paused' | 'finished';
