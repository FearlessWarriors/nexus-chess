import {
  MessageEnvelope,
  ConnectionState,
  MessageHandler,
} from './types';

// ─── Reconnect Constants ─────────────────────────────────────────────────────

/** Base delay for first reconnect attempt (1s) */
const RECONNECT_BASE_MS = 1000;

/** Maximum delay between reconnect attempts (30s) */
const RECONNECT_MAX_MS = 30_000;

/** Maximum number of reconnect attempts */
const RECONNECT_MAX_ATTEMPTS = 10;

// ─── WebSocket Client ────────────────────────────────────────────────────────

export class WSClient {
  private ws: WebSocket | null = null;
  private url: string = '';
  private seq: number = 0;
  private state: ConnectionState = 'disconnected';
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts: number = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private intentionalClose: boolean = false;
  private playerId: string | null = null;

  // ── Public callbacks ───────────────────────────────────────────────────

  /** Fired when connection state changes */
  onStateChange?: (state: ConnectionState) => void;

  /** Fired when an error occurs at the transport level */
  onError?: (error: Error) => void;

  // ── Connection Management ──────────────────────────────────────────────

  /**
   * Connect to the WebSocket server.
   * @param url  Full WebSocket URL, e.g. "ws://localhost:3001/ws"
   */
  connect(url: string): void {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.url = url;
    this.intentionalClose = false;
    this.setState('connecting');
    this.createSocket();
  }

  /**
   * Gracefully disconnect from the server.
   */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnect();
    this.stopPing();

    if (this.ws !== null) {
      // Only close if already connected/connecting; skip if still CONNECTING
      // (React StrictMode double-mount can trigger disconnect during connect)
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        try {
          this.ws.close(1000, 'Client disconnect');
        } catch {
          // ignore close errors during race conditions
        }
      }
      this.ws = null;
    }

    this.setState('disconnected');
    this.reconnectAttempts = 0;
    this.playerId = null;
  }

  /**
   * Send a message to the server.
   */
  send(type: string, payload: Record<string, unknown> = {}): void {
    if (this.ws === null || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WSClient] Cannot send — not connected');
      return;
    }

    this.seq++;
    const envelope: MessageEnvelope = {
      type,
      payload,
      timestamp: Date.now(),
      seq: this.seq,
    };

    this.ws.send(JSON.stringify(envelope));
  }

  authenticate(token: string): void {
    this.send('auth', { token });
  }

  // ── Event System ───────────────────────────────────────────────────────

  /**
   * Register a handler for a specific message type.
   * Multiple handlers can be registered for the same type.
   */
  on(type: string, handler: MessageHandler): void {
    let set = this.handlers.get(type);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
  }

  /**
   * Remove a handler for a specific message type.
   */
  off(type: string, handler?: MessageHandler): void {
    if (handler === undefined) {
      this.handlers.delete(type);
      return;
    }
    const set = this.handlers.get(type);
    if (set !== undefined) {
      set.delete(handler);
      if (set.size === 0) {
        this.handlers.delete(type);
      }
    }
  }

  // ── Getters ────────────────────────────────────────────────────────────

  getState(): ConnectionState {
    return this.state;
  }

  getPlayerId(): string | null {
    return this.playerId;
  }

  isConnected(): boolean {
    return this.state === 'connected' && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ── Private ────────────────────────────────────────────────────────────

  private createSocket(): void {
    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
      this.attemptReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.setState('connected');
      this.reconnectAttempts = 0;
      this.startPing();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleIncoming(event.data as string);
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.stopPing();
      // Don't reconnect on clean close initiated by client
      if (this.intentionalClose || event.code === 1000 || event.code === 4003) {
        this.setState('disconnected');
        if (event.code === 4003) {
          this.onError?.(new Error('Account banned'));
        }
        this.ws = null;
        return;
      }
      this.ws = null;
      this.attemptReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, so reconnect logic is in onclose
      this.onError?.(new Error('WebSocket connection error'));
    };
  }

  private handleIncoming(raw: string): void {
    let envelope: MessageEnvelope;
    try {
      envelope = JSON.parse(raw);
    } catch {
      console.warn('[WSClient] Failed to parse incoming message');
      return;
    }

    // Auto-respond to pings
    if (envelope.type === 'ping') {
      this.send('ping', {});
      return;
    }

    // Capture playerId from connected message
    if (envelope.type === 'connected' && envelope.payload.playerId !== undefined) {
      this.playerId = envelope.payload.playerId as string;
    }

    // Dispatch to registered handlers
    const handlers = this.handlers.get(envelope.type);
    if (handlers !== undefined) {
      for (const handler of handlers) {
        try {
          handler(envelope.payload, envelope);
        } catch (err) {
          console.error(`[WSClient] Handler error for type "${envelope.type}":`, err);
        }
      }
    }
  }

  private attemptReconnect(): void {
    if (this.intentionalClose) {
      return;
    }
    if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
      this.setState('disconnected');
      this.onError?.(new Error('Max reconnect attempts reached'));
      return;
    }

    this.setState('reconnecting');
    this.reconnectAttempts++;

    // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 30s
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_MS,
    );

    this.reconnectTimer = setTimeout(() => {
      this.createSocket();
    }, delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    this.stopPing();
    // Send a ping every 15 seconds (server pings every 10s; client proactively pings too)
    this.pingInterval = setInterval(() => {
      if (this.isConnected()) {
        this.send('ping', {});
      }
    }, 15_000);
  }

  private stopPing(): void {
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state !== state) {
      this.state = state;
      this.onStateChange?.(state);
    }
  }
}
