import { WebSocket } from 'ws';
import { PlayerState } from './types.js';

// ─── Timing Constants ────────────────────────────────────────────────────────

/** Server sends ping every 10 seconds */
const PING_INTERVAL_MS = 10_000;

/** Client must respond with pong within 10 seconds */
const PONG_TIMEOUT_MS = 10_000;

/** Disconnected player has 30 seconds to reconnect before forfeit */
const RECONNECT_GRACE_PERIOD_MS = 30_000;

// ─── Heartbeat Manager ───────────────────────────────────────────────────────

export class HeartbeatManager {
  private timer: ReturnType<typeof setInterval> | null = null;

  /** All connected players, keyed by playerId */
  private players: Map<string, PlayerState> = new Map();

  /** Currently disconnected players (within grace period), keyed by playerId */
  private disconnected: Map<string, { player: PlayerState; since: number }> = new Map();

  /** Callback when a player's grace period expires */
  onForfeit?: (playerId: string) => void;

  /** Callback when a player is detected as disconnected */
  onDisconnect?: (playerId: string) => void;

  /** Callback when a player reconnects within the grace period */
  onReconnect?: (playerId: string) => void;

  // ── Lifecycle ───────────────────────────────────────────────────────────

  /** Start the heartbeat interval */
  start(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => this.tick(), PING_INTERVAL_MS);
  }

  /** Stop the heartbeat interval */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ── Player Management ───────────────────────────────────────────────────

  /** Register a newly connected player */
  register(player: PlayerState): void {
    player.lastPong = Date.now();
    player.isAlive = true;
    this.players.set(player.playerId, player);
    // Remove from disconnected if reconnecting
    this.disconnected.delete(player.playerId);
  }

  /** Unregister a player (on clean disconnect) */
  unregister(playerId: string): void {
    this.players.delete(playerId);
    this.disconnected.delete(playerId);
  }

  /** Mark a player as disconnected (unclean) — starts grace period */
  markDisconnected(playerId: string): void {
    const player = this.players.get(playerId);
    if (player === undefined) {
      return;
    }
    player.isAlive = false;
    this.disconnected.set(playerId, { player, since: Date.now() });
    this.onDisconnect?.(playerId);
  }

  /** Attempt to reconnect a player. Returns the PlayerState on success, null on failure. */
  tryReconnect(playerId: string, ws: WebSocket): PlayerState | null {
    const entry = this.disconnected.get(playerId);
    if (entry === undefined) {
      return null; // Not in grace period
    }
    const player = entry.player;
    player.ws = ws;
    player.isAlive = true;
    player.lastPong = Date.now();
    this.players.set(playerId, player);
    this.disconnected.delete(playerId);
    this.onReconnect?.(playerId);
    return player;
  }

  /** Handle a pong response from a client */
  handlePong(playerId: string): void {
    const player = this.players.get(playerId);
    if (player !== undefined) {
      player.lastPong = Date.now();
      player.isAlive = true;
    }
  }

  /** Get a player by ID */
  getPlayer(playerId: string): PlayerState | undefined {
    return this.players.get(playerId);
  }

  getPlayers(): PlayerState[] {
    return Array.from(this.players.values());
  }

  /** Check if a player is currently connected */
  isConnected(playerId: string): boolean {
    const player = this.players.get(playerId);
    return player !== undefined && player.isAlive;
  }

  // ── Internal tick ───────────────────────────────────────────────────────

  private tick(): void {
    const now = Date.now();

    // 1. Send ping to all connected players
    for (const [, player] of this.players) {
      if (!player.isAlive) {
        continue;
      }
      if (player.ws.readyState === WebSocket.OPEN) {
        this.sendPing(player);
      }
    }

    // 2. Check for pong timeouts — mark as disconnected
    for (const [, player] of this.players) {
      if (!player.isAlive) {
        continue;
      }
      if (now - player.lastPong > PING_INTERVAL_MS + PONG_TIMEOUT_MS) {
        player.isAlive = false;
        this.disconnected.set(player.playerId, { player, since: now });
        this.onDisconnect?.(player.playerId);
      }
    }

    // 3. Check grace period — forfeit if expired
    for (const [playerId, entry] of this.disconnected) {
      if (now - entry.since > RECONNECT_GRACE_PERIOD_MS) {
        this.disconnected.delete(playerId);
        this.players.delete(playerId);
        this.onForfeit?.(playerId);
      }
    }
  }

  private sendPing(player: PlayerState): void {
    try {
      player.ws.send(
        JSON.stringify({
          type: 'ping',
          payload: {},
          timestamp: Date.now(),
          seq: 0, // seq is managed by sendMessage; server pings don't increment player seq
        }),
      );
    } catch {
      // Socket may be closed between check and send
      player.isAlive = false;
    }
  }
}
