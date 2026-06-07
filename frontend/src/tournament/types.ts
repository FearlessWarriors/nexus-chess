// ─── Enums ───────────────────────────────────────────────────────────────────

export type TournamentFormat = 'swiss' | 'elimination';

export type TournamentStatus = 'waiting' | 'in_progress' | 'completed';

export type MatchResult = 'white_win' | 'black_win' | 'draw';

export type RoundStatus = 'pending' | 'in_progress' | 'completed';

export type LeaderboardSortBy = 'elo' | 'winRate' | 'totalGames';

// ─── Player ───────────────────────────────────────────────────────────────────

export interface PlayerEntry {
  id: string;
  name: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  totalGames: number;
  /** Optional ELO history (last 20 entries) for charting */
  eloHistory: number[];
  /** Timestamp of last played game */
  lastPlayedAt: number;
}

export interface TournamentPlayer extends PlayerEntry {
  /** Score in the current tournament (Swiss: points, Elimination: round reached) */
  score: number;
  /** Buchholz tiebreak (sum of opponents' scores) */
  buchholz: number;
  /** Whether this player has been eliminated */
  eliminated: boolean;
}

// ─── Match ────────────────────────────────────────────────────────────────────

export interface TournamentMatch {
  id: string;
  round: number;
  whiteId: string;
  blackId: string;
  result: MatchResult | null;
  /** Reference to a stored GameRecord ID */
  gameId: string | null;
  /** Whether this is a bye match */
  isBye: boolean;
}

// ─── Round ────────────────────────────────────────────────────────────────────

export interface TournamentRound {
  number: number;
  matches: TournamentMatch[];
  status: RoundStatus;
}

// ─── Tournament ───────────────────────────────────────────────────────────────

export interface TournamentConfig {
  name: string;
  format: TournamentFormat;
  /** Max players (0 = unlimited) */
  maxPlayers: number;
  /** Number of Swiss rounds (default 5) */
  rounds: number;
}

export interface Tournament {
  id: string;
  name: string;
  format: TournamentFormat;
  status: TournamentStatus;
  players: TournamentPlayer[];
  rounds: TournamentRound[];
  currentRound: number;
  config: TournamentConfig;
  createdAt: number;
  /** Winner ID(s) — empty array if not yet determined */
  winnerIds: string[];
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  totalGames: number;
  /** Badge type from server: 'top10' | 'top100' | 'top500' | '' */
  badge_type?: string;
  /** User-customized badge text */
  badge_text?: string;
}
