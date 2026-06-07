// ─── Message Protocol Types ──────────────────────────────────────────────────

// ─ Client → Server message types ───────────────────────────────────────────

export type ClientMessageType =
  | 'auth'
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

// ─ Server → Client message types ───────────────────────────────────────────

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

// ─ Envelope (every message on the wire) ────────────────────────────────────

export interface MessageEnvelope {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
  seq: number;
}

// ─ Client → Server payloads ────────────────────────────────────────────────

export interface AuthPayload {
  token: string;
}

export interface JoinQueuePayload {
  elo?: number;
}

export interface LeaveQueuePayload {
  // empty
}

export interface CreateRoomPayload {
  // empty — room is created and roomId is returned
}

export interface JoinRoomPayload {
  roomId: string;
}

export interface SpectateRoomPayload {
  roomId: string;
}

export interface MakeMovePayload {
  roomId: string;
  from: string;      // algebraic notation e.g. "d2"
  to: string;        // algebraic notation e.g. "d4"
  notation: string;  // full move notation e.g. "d2d4", "Nd2f4", "Sd2d5"
  fen: string;       // FEN string AFTER the move
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

export type ClientPayload =
  | AuthPayload
  | JoinQueuePayload
  | LeaveQueuePayload
  | CreateRoomPayload
  | JoinRoomPayload
  | SpectateRoomPayload
  | MakeMovePayload
  | ResignPayload
  | OfferDrawPayload
  | RespondDrawPayload
  | ChatPayload
  | GameEndedPayload
  | Record<string, never>; // ping (empty)

// ─ Server → Client payloads ────────────────────────────────────────────────

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
  opponentId: string;
  color: 'white' | 'black';
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

export type ServerPayload =
  | ConnectedPayload
  | QueueStatusPayload
  | MatchFoundPayload
  | GameStartPayload
  | MoveMadePayload
  | GameOverPayload
  | DrawOfferedPayload
  | DrawResponsePayload
  | OpponentDisconnectedPayload
  | OpponentReconnectedPayload
  | ChatMessagePayload
  | ErrorPayload
  | Record<string, never>; // pong (empty)

// ─ Room state ──────────────────────────────────────────────────────────────

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface Room {
  id: string;
  status: RoomStatus;
  playerWhite: string | null;   // playerId
  playerBlack: string | null;   // playerId
  spectators: Set<string>;
  currentFen: string;
  moveHistory: MoveRecord[];
  createdAt: number;
}

export interface MoveRecord {
  from: string;
  to: string;
  notation: string;
  fen: string;
  playerId: string;
  timestamp: number;
}

// ─ Player connection state ─────────────────────────────────────────────────

export type ConnectionStatus = 'idle' | 'queuing' | 'playing' | 'spectating';

export interface PlayerState {
  playerId: string;
  ws: import('ws').WebSocket;
  connectionStatus: ConnectionStatus;
  currentRoomId: string | null;
  elo: number;
  userId?: number;
  userName?: string;
  role?: string;
  bannedUntil?: string | null;
  banReason?: string | null;
  isBanned?: boolean;
  lastPong: number;
  isAlive: boolean;
  seq: number; // outgoing message sequence counter
}
