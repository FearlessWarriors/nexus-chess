import { WSClient } from './Client';
import { Game } from '../engine/game';
import { GameState, GameStatus, Color, Position, posToString } from '../engine/types';
import { FEN } from '../engine/fen';
import {
  MatchFoundPayload,
  GameStartPayload,
  MoveMadePayload,
  GameOverPayload,
  QueueStatusPayload,
  SpectateUpdatePayload,
  ActiveGamesPayload,
} from './types';

// ─── Room Client ─────────────────────────────────────────────────────────────

export class RoomClient {
  private client: WSClient;
  private game: Game;
  private roomId: string | null = null;
  private color: 'white' | 'black' | null = null;
  private opponentId: string | null = null;

  // ── Callbacks ──────────────────────────────────────────────────────────

  onMatchFound?: (payload: MatchFoundPayload) => void;
  onGameStart?: (payload: GameStartPayload) => void;
  onMoveMade?: (payload: MoveMadePayload) => void;
  onGameOver?: (payload: GameOverPayload) => void;
  onQueueStatus?: (payload: QueueStatusPayload) => void;
  onOpponentDisconnected?: () => void;
  onOpponentReconnected?: () => void;
  /** Called when a spectate update arrives (move broadcast to spectators) */
  onSpectateUpdate?: (payload: SpectateUpdatePayload) => void;
  /** Called when active games list is received */
  onActiveGames?: (payload: ActiveGamesPayload) => void;
  onError?: (code: string, message: string) => void;

  constructor(client: WSClient) {
    this.client = client;
    this.game = new Game();
    this.registerHandlers();
  }

  // ── Queue Operations ───────────────────────────────────────────────────

  /** Join the matchmaking queue */
  joinQueue(elo?: number): void {
    this.client.send('join_queue', elo !== undefined ? { elo } : {});
  }

  /** Leave the matchmaking queue */
  leaveQueue(): void {
    this.client.send('leave_queue', {});
  }

  // ── Room Operations ────────────────────────────────────────────────────

  /** Create a new room (for friend matches) */
  createRoom(): void {
    this.client.send('create_room', {});
  }

  /** Join an existing room by ID */
  joinRoom(roomId: string): void {
    this.client.send('join_room', { roomId });
  }

  /** Spectate a room — join as readonly observer */
  spectateRoom(roomId: string): void {
    this.client.send('spectate_room', { roomId });
  }

  /** Request list of all active games (for spectate lobby) */
  requestActiveGames(): void {
    this.client.send('get_active_games', {});
  }

  // ── Game Actions ───────────────────────────────────────────────────────

  /**
   * Make a move. The move is validated against the local Game engine
   * before being sent to the server.
   */
  makeMove(from: Position, to: Position): { success: boolean; error?: string } {
    if (this.roomId === null) {
      return { success: false, error: 'Not in a room' };
    }

    // Use the Game engine to validate and execute the move locally
    const result = this.game.makeMove(from, to);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Get the notation from the move history
    const lastMove = this.game.state.moveHistory[this.game.state.moveHistory.length - 1];
    const notation = lastMove.notation;

    // Compute FEN for the new state
    const fen = FEN.encode(this.game.state);

    // Send to server
    this.client.send('make_move', {
      roomId: this.roomId,
      from: posToString(from),
      to: posToString(to),
      notation,
      fen,
    });

    // Check if game ended naturally
    if (this.game.state.status !== GameStatus.IN_PROGRESS) {
      const result = this.game.getGameResult();
      this.client.send('game_ended', {
        roomId: this.roomId,
        result: String(result.status),
        winner: result.winner,
        reason: mapGameStatusReason(result.status),
        fen,
      });
    }

    return { success: true };
  }

  /** Resign the current game */
  resign(): void {
    if (this.roomId === null) {
      return;
    }
    this.client.send('resign', { roomId: this.roomId });
  }

  /** Offer a draw to the opponent */
  offerDraw(): void {
    if (this.roomId === null) {
      return;
    }
    this.client.send('offer_draw', { roomId: this.roomId });
  }

  /** Respond to a draw offer */
  respondDraw(accept: boolean): void {
    if (this.roomId === null) {
      return;
    }
    this.client.send('respond_draw', { roomId: this.roomId, accept });
  }

  /** Send a chat message */
  sendChat(message: string): void {
    if (this.roomId === null) {
      return;
    }
    this.client.send('chat', { roomId: this.roomId, message });
  }

  // ── Getters ────────────────────────────────────────────────────────────

  getRoomId(): string | null {
    return this.roomId;
  }

  getColor(): 'white' | 'black' | null {
    return this.color;
  }

  getOpponentId(): string | null {
    return this.opponentId;
  }

  getGame(): Game {
    return this.game;
  }

  getGameState(): GameState {
    return this.game.state;
  }

  /** Reset internal state (call when leaving a room) */
  reset(): void {
    this.roomId = null;
    this.color = null;
    this.opponentId = null;
    this.game.reset();
  }

  // ── Private Handlers ───────────────────────────────────────────────────

  private registerHandlers(): void {
    this.client.on('queue_status', (payload) => {
      this.onQueueStatus?.(payload as unknown as QueueStatusPayload);
    });

    this.client.on('match_found', (payload) => {
      const data = payload as unknown as MatchFoundPayload;
      this.roomId = data.roomId;
      this.color = data.color;
      this.opponentId = data.opponentId;
      this.onMatchFound?.(data);
    });

    this.client.on('game_start', (payload) => {
      const data = payload as unknown as GameStartPayload;
      this.roomId = data.roomId;
      this.color = data.color;
      this.opponentId = data.opponentId;

      // Initialize game from the server's FEN
      try {
        const state = FEN.decode(data.fen);
        this.game.reset();
        this.game.state = state;
      } catch {
        this.game.reset();
      }

      this.onGameStart?.(data);
    });

    this.client.on('move_made', (payload) => {
      const data = payload as unknown as MoveMadePayload;

      // Ignore moves received after game over to prevent state corruption.
      if (this.game.state.status !== GameStatus.IN_PROGRESS) {
        return;
      }

      // If the move was made by someone else, apply it to our local game.
      // We skip our own moves because they're already applied locally in makeMove().
      if (data.by !== this.client.getPlayerId()) {
        try {
          const state = FEN.decode(data.fen);
          // Preserve anchorOverloadTracker from the current state since FEN
          // doesn't encode it. The tracker will be rebuilt naturally as moves
          // are processed by the game engine.
          state.anchorOverloadTracker = this.game.state.anchorOverloadTracker;
          // Preserve coreCooldown (not encoded in FEN; reset to defaults is
          // acceptable since the next move clears cooldowns anyway).
          this.game.state = state;
        } catch {
          // Fallback: state remains as-is
        }
      }

      // If we are spectating, dispatch spectate update
      if (this.color === null && this.roomId !== null) {
        this.onSpectateUpdate?.({
          roomId: data.roomId,
          from: data.from,
          to: data.to,
          notation: data.notation,
          fen: data.fen,
          by: data.by,
          spectatorCount: 0,
        });
      }

      this.onMoveMade?.(data);
    });

    this.client.on('game_over', (payload) => {
      const data = payload as unknown as GameOverPayload;
      this.onGameOver?.(data);
    });

    this.client.on('spectate_update', (payload) => {
      const data = payload as unknown as SpectateUpdatePayload;
      // For spectate-only clients, decode the FEN to update board state
      if (this.color === null && this.roomId !== null) {
        try {
          const state = FEN.decode(data.fen);
          this.game.state = state;
        } catch {
          // Ignore decode errors in spectate
        }
      }
      this.onSpectateUpdate?.(data);
    });

    this.client.on('active_games', (payload) => {
      const data = payload as unknown as ActiveGamesPayload;
      this.onActiveGames?.(data);
    });

    this.client.on('draw_offered', () => {
      // Caller handles UI
    });

    this.client.on('draw_response', () => {
      // Caller handles UI
    });

    this.client.on('opponent_disconnected', () => {
      this.onOpponentDisconnected?.();
    });

    this.client.on('opponent_reconnected', () => {
      this.onOpponentReconnected?.();
    });

    this.client.on('chat_message', () => {
      // Caller handles UI
    });

    this.client.on('error', (payload) => {
      const data = payload as { code: string; message: string };
      this.onError?.(data.code, data.message);
    });
  }
}

function mapGameStatusReason(status: GameStatus): string {
  switch (status) {
    case GameStatus.WHITE_WIN:
    case GameStatus.BLACK_WIN:
      return 'sanctuary';
    case GameStatus.DRAW:
      return 'stalemate';
    default:
      return 'unknown';
  }
}
