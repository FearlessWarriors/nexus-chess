// ─── Network Message Protocol ────────────────────────────────────────────────
// Shared between server and client. Keep in sync with server/src/types.ts.

// ─ Client → Server ──────────────────────────────────────────────────────────

export type ClientMessageType =
  | 'join_queue'
  | 'leave_queue'
  | 'create_room'
  | 'join_room'
  | 'spectate_room'
  | 'make_move'
  | 'resign'
  | 'offer_draw'
  | 'respond_draw'
  | 'chat'
  | 'get_active_games'
  | 'game_ended'
  | 'ping';

// ─ Server → Client ──────────────────────────────────────────────────────────

export type ServerMessageType =
  | 'connected'
  | 'queue_status'
  | 'match_found'
  | 'game_start'
  | 'move_made'
  | 'game_over'
  | 'draw_offered'
  | 'draw_response'
  | 'opponent_disconnected'
  | 'opponent_reconnected'
  | 'chat_message'
  | 'spectate_update'
  | 'active_games'
  | 'error'
  | 'pong';

// ─ Envelope ─────────────────────────────────────────────────────────────────

export interface MessageEnvelope {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  seq: number;
}

// ─ Connection state ─────────────────────────────────────────────────────────

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

// ─ Client → Server payloads ─────────────────────────────────────────────────

export interface AuthPayload {
  token: string;
}

export interface JoinQueuePayload {
  elo?: number;
}

export interface MakeMovePayload {
  roomId: string;
  from: string;
  to: string;
  notation: string;
  fen: string;
}

export interface JoinRoomPayload {
  roomId: string;
}

export interface SpectateRoomPayload {
  roomId: string;
}

export interface ResignPayload {
  roomId: string;
}

export interface OfferDrawPayload {
  roomId: string;
}

export interface RespondDrawPayload {
  roomId: string;
  accept: boolean;
}

export interface ChatPayload {
  roomId: string;
  message: string;
}

export interface GameEndedPayload {
  roomId: string;
  result: string;
  winner: string | null;
  reason: string;
  fen: string;
}

// ─ Server → Client payloads ─────────────────────────────────────────────────

export interface ConnectedPayload {
  playerId: string;
}

export interface QueueStatusPayload {
  position: number;
  estimatedWaitSeconds: number;
}

export interface MatchFoundPayload {
  roomId: string;
  opponentId: string;
  color: 'white' | 'black';
}

export interface GameStartPayload {
  roomId: string;
  opponentId: string | null;
  color: 'white' | 'black' | null;
  fen: string;
}

export interface MoveMadePayload {
  roomId: string;
  from: string;
  to: string;
  notation: string;
  fen: string;
  by: string;
}

export interface GameOverPayload {
  roomId: string;
  result: string;
  reason: string;
  winner: string | null;
}

export interface DrawOfferedPayload {
  roomId: string;
  by: string;
}

export interface DrawResponsePayload {
  roomId: string;
  accepted: boolean;
}

export interface OpponentDisconnectedPayload {
  roomId: string;
}

export interface OpponentReconnectedPayload {
  roomId: string;
}

export interface ChatMessagePayload {
  roomId: string;
  from: string;
  message: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

// ─ Spectate Payloads ───────────────────────────────────────────────────────

export interface SpectateUpdatePayload {
  roomId: string;
  from: string;
  to: string;
  notation: string;
  fen: string;
  by: string;
  spectatorCount: number;
}

export interface ActiveGameInfo {
  id: string;
  whiteName: string;
  whiteElo: number;
  blackName: string;
  blackElo: number;
  moveCount: number;
  spectatorCount: number;
  createdAt: number;
}

export interface ActiveGamesPayload {
  games: ActiveGameInfo[];
}

// ─ Event handler type ───────────────────────────────────────────────────────

export type MessageHandler = (payload: Record<string, unknown>, envelope: MessageEnvelope) => void;
