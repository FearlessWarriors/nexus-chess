// ─── History Module — Barrel Export ───────────────────────────────────────────
//
//  Usage:
//    import { GameRecorder, Storage, ReplayController } from '@/history';
//    import type { GameRecord, MoveRecord, PlayerStats, ReplayStatus } from '@/history';
//

// Types
export type {
  MoveRecord,
  GameRecord,
  PlayerStats,
  ListGamesFilter,
  PaginatedResult,
  ReplayStatus,
} from './types';

// Classes
export { GameRecorder } from './GameRecorder';
export type { GameMode } from './GameRecorder';
export { Storage } from './Storage';
export { ReplayController } from './ReplayController';
