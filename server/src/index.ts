import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';
import cors from 'cors';
import { RoomManager } from './RoomManager.js';
import { Matchmaking } from './Matchmaking.js';
import { HeartbeatManager } from './Heartbeat.js';
import { openDatabase } from './db/schema.js';
import { bootstrapAdminUser, createAuthRouter, getUserAuthRow, verifyJwt } from './routes/auth.js';
import { createAdminRouter } from './routes/admin.js';
import {
  PlayerState,
  ConnectionStatus,
  MessageEnvelope,
  AuthPayload,
  MakeMovePayload,
  ChatPayload,
  ResignPayload,
  OfferDrawPayload,
  RespondDrawPayload,
  SpectateRoomPayload,
  JoinRoomPayload,
  JoinQueuePayload,
  GameEndedPayload,
} from './types.js';

// ─── Server Constants ────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const WS_PATH = '/ws';
const ROOM_CLEANUP_INTERVAL_MS = 300_000; // 5 minutes
const ROOM_MAX_AGE_MS = 3_600_000; // 1 hour

// ─── Database ────────────────────────────────────────────────────────────────

const db = openDatabase();
bootstrapAdminUser(db);

// ─── Core Services ───────────────────────────────────────────────────────────

const roomManager = new RoomManager();
const matchmaking = new Matchmaking();
const heartbeat = new HeartbeatManager();

// ─── Express App ─────────────────────────────────────────────────────────────

const app = express();

app.use(cors());
app.use(express.json());

const startedAt = Date.now();
const httpMetrics = {
  requestsTotal: 0,
  errorsTotal: 0,
  byRoute: new Map<string, { count: number; totalMs: number; errors: number }>(),
};

app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const end = process.hrtime.bigint();
    const ms = Number(end - start) / 1e6;
    httpMetrics.requestsTotal++;

    const key = `${req.method} ${req.path}`;
    const entry = httpMetrics.byRoute.get(key) ?? { count: 0, totalMs: 0, errors: 0 };
    entry.count++;
    entry.totalMs += ms;
    if (res.statusCode >= 500) {
      entry.errors++;
      httpMetrics.errorsTotal++;
    }
    httpMetrics.byRoute.set(key, entry);
  });
  next();
});

// Auth routes
const authRouter = createAuthRouter(db);
app.use(authRouter);

// Admin routes (mounted at /api/v1/admin)
const adminRouter = createAdminRouter(db);
app.use('/api/v1/admin', adminRouter);

// Health check
app.get('/api/v1/health', (_req, res) => {
  res.json({ status: 'ok', service: 'nexus-chess', version: '1.0.0' });
});

function requireAdminHttp(req: express.Request, res: express.Response): { id: number; name: string } | null {
  const authHeader = req.headers.authorization;
  if (authHeader === undefined || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: '未登录' });
    return null;
  }

  const payload = verifyJwt(authHeader.slice(7));
  if (payload === null) {
    res.status(401).json({ error: '登录已过期，请重新登录' });
    return null;
  }

  const user = getUserAuthRow(db, payload.userId);
  if (user === null) {
    res.status(404).json({ error: '用户不存在' });
    return null;
  }
  if (user.is_banned === 1) {
    res.status(403).json({ error: '账号已被封禁', bannedUntil: user.banned_until, reason: user.ban_reason });
    return null;
  }
  if (user.role !== 'admin' && user.is_admin !== 1) {
    res.status(403).json({ error: '无权限' });
    return null;
  }

  return { id: user.id, name: user.name };
}

app.get('/api/v1/metrics', (_req, res) => {
  const routes = Array.from(httpMetrics.byRoute.entries()).map(([route, v]) => ({
    route,
    count: v.count,
    avgMs: v.count > 0 ? v.totalMs / v.count : 0,
    errors: v.errors,
  }));
  routes.sort((a, b) => b.count - a.count);

  res.json({
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    http: {
      requestsTotal: httpMetrics.requestsTotal,
      errorsTotal: httpMetrics.errorsTotal,
      topRoutes: routes.slice(0, 30),
    },
    ws: {
      connectionsCurrent: wss.clients.size,
    },
    matchmaking: {
      queueLength: matchmaking.getQueueLength(),
    },
    rooms: {
      activeGames: roomManager.getActiveGames().length,
    },
    process: {
      memory: process.memoryUsage(),
    },
  });
});

app.get('/api/v1/admin/metrics', (req, res) => {
  const admin = requireAdminHttp(req, res);
  if (admin === null) {
    return;
  }

  const routes = Array.from(httpMetrics.byRoute.entries()).map(([route, v]) => ({
    route,
    count: v.count,
    avgMs: v.count > 0 ? v.totalMs / v.count : 0,
    errors: v.errors,
  }));
  routes.sort((a, b) => b.count - a.count);

  res.json({
    viewer: admin,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    http: {
      requestsTotal: httpMetrics.requestsTotal,
      errorsTotal: httpMetrics.errorsTotal,
      routes,
    },
    ws: {
      connectionsCurrent: wss.clients.size,
    },
    matchmaking: {
      queueLength: matchmaking.getQueueLength(),
    },
    rooms: {
      activeGames: roomManager.getActiveGames(),
    },
    process: {
      memory: process.memoryUsage(),
      pid: process.pid,
      node: process.version,
    },
  });
});

// ─── HTTP Server (Express + WebSocket upgrade) ───────────────────────────────

const httpServer = createServer(app);

// ─── WebSocket Server ────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

wss.on('connection', (ws: WebSocket) => {
  const playerId = uuidv4();

  const player: PlayerState = {
    playerId,
    ws,
    connectionStatus: 'idle',
    currentRoomId: null,
    elo: 1000,
    isBanned: false,
    lastPong: Date.now(),
    isAlive: true,
    seq: 0,
  };

  heartbeat.register(player);

  // Send connected message
  sendMessage(ws, player, 'connected', { playerId });

  ws.on('message', (data: Buffer) => {
    handleMessage(player, data);
  });

  ws.on('close', () => {
    handleDisconnect(player);
  });

  ws.on('error', () => {
    handleDisconnect(player);
  });
});

function finishRoomAndNotify(roomId: string, result: string, reason: string, winner: string | null): void {
  const room = roomManager.getRoom(roomId);
  if (room === undefined) {
    return;
  }

  roomManager.finishRoom(roomId);

  const gameOverData = { roomId, result, reason, winner };

  for (const pid of [room.playerWhite, room.playerBlack]) {
    if (pid === null) continue;
    const p = heartbeat.getPlayer(pid);
    if (p !== undefined) {
      sendMessage(p.ws, p, 'game_over', gameOverData);
      p.connectionStatus = 'idle';
      p.currentRoomId = null;
    }
  }

  for (const specId of room.spectators) {
    const spec = heartbeat.getPlayer(specId);
    if (spec !== undefined) {
      sendMessage(spec.ws, spec, 'game_over', gameOverData);
      spec.connectionStatus = 'idle';
      spec.currentRoomId = null;
    }
  }
}

app.get('/api/v1/admin/ws/clients', (req, res) => {
  const admin = requireAdminHttp(req, res);
  if (admin === null) {
    return;
  }

  const players = heartbeat.getPlayers().map((p) => ({
    playerId: p.playerId,
    connectionStatus: p.connectionStatus,
    currentRoomId: p.currentRoomId,
    elo: p.elo,
    lastPong: p.lastPong,
    isAlive: p.isAlive,
    userId: p.userId ?? null,
    userName: p.userName ?? null,
    role: p.role ?? null,
    isBanned: p.isBanned ?? false,
    bannedUntil: p.bannedUntil ?? null,
    banReason: p.banReason ?? null,
  }));

  res.json({ viewer: admin, clients: players, count: players.length });
});

app.post('/api/v1/admin/ws/kick', (req, res) => {
  const admin = requireAdminHttp(req, res);
  if (admin === null) {
    return;
  }

  const body = req.body as {
    userId?: number;
    name?: string;
    playerId?: string;
    reason?: string;
  };

  const reason = typeof body.reason === 'string' && body.reason.trim().length > 0
    ? body.reason.trim().slice(0, 200)
    : 'admin_kick';

  const players = heartbeat.getPlayers();
  const targets = players.filter((p) => {
    if (typeof body.playerId === 'string' && body.playerId.length > 0) {
      return p.playerId === body.playerId;
    }
    if (typeof body.userId === 'number' && Number.isFinite(body.userId)) {
      return p.userId === body.userId;
    }
    if (typeof body.name === 'string' && body.name.trim().length > 0) {
      return p.userName === body.name.trim();
    }
    return false;
  });

  if (targets.length === 0) {
    res.status(404).json({ error: '未找到在线目标' });
    return;
  }

  for (const t of targets) {
    try {
      t.ws.close(4001, reason);
    } catch {
      // ignore
    }
  }

  db.prepare(
    "INSERT INTO admin_audit (admin_id, action, target_user_id, reason, metadata) VALUES (?, 'kick_ws', ?, ?, ?)",
  ).run(admin.id, targets[0].userId ?? null, reason, JSON.stringify({ count: targets.length }));

  res.json({ success: true, count: targets.length });
});

app.post('/api/v1/admin/rooms/:roomId/force_end', (req, res) => {
  const admin = requireAdminHttp(req, res);
  if (admin === null) {
    return;
  }

  const roomId = req.params.roomId;
  const room = roomManager.getRoom(roomId);
  if (room === undefined) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  const body = req.body as { winnerColor?: 'white' | 'black' | null; reason?: string };
  const forceReason = typeof body.reason === 'string' && body.reason.trim().length > 0
    ? body.reason.trim().slice(0, 200)
    : 'admin_force_end';

  const winnerColor = body.winnerColor ?? null;
  let winnerId: string | null = null;
  let result: string = 'draw';
  if (winnerColor === 'white') {
    winnerId = room.playerWhite;
    result = 'white_win';
  } else if (winnerColor === 'black') {
    winnerId = room.playerBlack;
    result = 'black_win';
  }

  finishRoomAndNotify(roomId, result, forceReason, winnerId);

  db.prepare(
    "INSERT INTO admin_audit (admin_id, action, target_user_id, reason, metadata) VALUES (?, 'force_end_room', NULL, ?, ?)",
  ).run(admin.id, forceReason, JSON.stringify({ roomId, result, winnerId }));

  res.json({ success: true });
});

// ─── Matchmaking Callbacks ───────────────────────────────────────────────────

// Periodically check for matches
setInterval(() => {
  const match = matchmaking.tryMatch();
  if (match !== null) {
    // Create room and seat players
    const roomId = roomManager.createRoom(match.whiteId);
    const seatResult = roomManager.seatPlayers(roomId, match.whiteId, match.blackId);
    if (!seatResult.success) {
      // Put players back in queue
      matchmaking.enqueue(match.whiteId);
      matchmaking.enqueue(match.blackId);
      return;
    }

    const room = roomManager.getRoom(roomId)!;

    // Update player states
    const whitePlayer = heartbeat.getPlayer(match.whiteId);
    const blackPlayer = heartbeat.getPlayer(match.blackId);

    if (whitePlayer !== undefined) {
      whitePlayer.connectionStatus = 'playing';
      whitePlayer.currentRoomId = roomId;
    }
    if (blackPlayer !== undefined) {
      blackPlayer.connectionStatus = 'playing';
      blackPlayer.currentRoomId = roomId;
    }

    // Notify both players
    if (whitePlayer !== undefined) {
      sendMessage(whitePlayer.ws, whitePlayer, 'match_found', {
        roomId,
        opponentId: match.blackId,
        color: 'white',
      });
      sendMessage(whitePlayer.ws, whitePlayer, 'game_start', {
        roomId,
        opponentId: match.blackId,
        color: 'white',
        fen: room.currentFen,
      });
    }
    if (blackPlayer !== undefined) {
      sendMessage(blackPlayer.ws, blackPlayer, 'match_found', {
        roomId,
        opponentId: match.whiteId,
        color: 'black',
      });
      sendMessage(blackPlayer.ws, blackPlayer, 'game_start', {
        roomId,
        opponentId: match.whiteId,
        color: 'black',
        fen: room.currentFen,
      });
    }
  }
}, 2000); // Check every 2 seconds

// ─── Periodic Room Cleanup ───────────────────────────────────────────────────

setInterval(() => {
  const removed = roomManager.cleanupStaleRooms(ROOM_MAX_AGE_MS);
  if (removed > 0) {
    console.log(`[cleanup] Removed ${removed} stale rooms`);
  }
}, ROOM_CLEANUP_INTERVAL_MS);

// ─── Message Handler ─────────────────────────────────────────────────────────

function handleMessage(player: PlayerState, data: Buffer): void {
  let envelope: MessageEnvelope;
  try {
    envelope = JSON.parse(data.toString());
  } catch {
    sendError(player, 'PARSE_ERROR', 'Invalid JSON');
    return;
  }

  const { type, payload } = envelope;
  if (type === undefined) {
    sendError(player, 'MISSING_TYPE', 'Message type is required');
    return;
  }

  // Handle ping separately (pong immediately)
  if (type === 'ping') {
    heartbeat.handlePong(player.playerId);
    sendMessage(player.ws, player, 'pong', {});
    return;
  }

  // Route message
  switch (type) {
    case 'auth':
      handleAuth(player, payload as unknown as AuthPayload);
      break;
    case 'join_queue':
      handleJoinQueue(player, payload as unknown as JoinQueuePayload);
      break;
    case 'leave_queue':
      handleLeaveQueue(player);
      break;
    case 'create_room':
      handleCreateRoom(player);
      break;
    case 'join_room':
      handleJoinRoom(player, payload as unknown as JoinRoomPayload);
      break;
    case 'spectate_room':
      handleSpectateRoom(player, payload as unknown as SpectateRoomPayload);
      break;
    case 'make_move':
      handleMakeMove(player, payload as unknown as MakeMovePayload);
      break;
    case 'resign':
      handleResign(player, payload as unknown as ResignPayload);
      break;
    case 'offer_draw':
      handleOfferDraw(player, payload as unknown as OfferDrawPayload);
      break;
    case 'respond_draw':
      handleRespondDraw(player, payload as unknown as RespondDrawPayload);
      break;
    case 'chat':
      handleChat(player, payload as unknown as ChatPayload);
      break;
    case 'get_active_games':
      handleGetActiveGames(player);
      break;
    case 'game_ended':
      handleGameEnded(player, payload as unknown as GameEndedPayload);
      break;
    default:
      sendError(player, 'UNKNOWN_TYPE', `Unknown message type: ${type}`);
  }
}

// ─── Message Type Handlers ───────────────────────────────────────────────────

function refreshAuth(player: PlayerState): void {
  if (player.userId === undefined) {
    return;
  }

  const user = getUserAuthRow(db, player.userId);
  if (user === null) {
    player.userId = undefined;
    player.userName = undefined;
    player.role = undefined;
    player.isBanned = false;
    player.bannedUntil = null;
    player.banReason = null;
    return;
  }

  player.userName = user.name;
  player.role = user.role;
  player.elo = user.elo;
  player.bannedUntil = user.banned_until;
  player.banReason = user.ban_reason;
  player.isBanned = (user.is_banned === 1) || (user.suspended === 1);
}

function enforceNotBanned(player: PlayerState): boolean {
  refreshAuth(player);
  if (player.isBanned === true) {
    sendError(player, 'BANNED', '账号已被封禁');
    try {
      player.ws.close(4003, 'banned');
    } catch {
      // ignore
    }
    return false;
  }
  return true;
}

function handleAuth(player: PlayerState, payload: AuthPayload): void {
  if (typeof payload.token !== 'string' || payload.token.trim().length === 0) {
    sendError(player, 'AUTH_INVALID', 'Missing token');
    return;
  }

  const jwtPayload = verifyJwt(payload.token.trim());
  if (jwtPayload === null) {
    sendError(player, 'AUTH_INVALID', 'Invalid token');
    return;
  }

  const user = getUserAuthRow(db, jwtPayload.userId);
  if (user === null) {
    sendError(player, 'AUTH_INVALID', 'User not found');
    return;
  }

  player.userId = user.id;
  player.userName = user.name;
  player.role = user.role;
  player.elo = user.elo;
  player.bannedUntil = user.banned_until;
  player.banReason = user.ban_reason;
  player.isBanned = (user.is_banned === 1) || (user.suspended === 1);

  if (player.isBanned === true) {
    sendError(player, 'BANNED', '账号已被封禁');
    try {
      player.ws.close(4003, 'banned');
    } catch {
      // ignore
    }
  }
}

function handleJoinQueue(player: PlayerState, payload: JoinQueuePayload): void {
  if (player.connectionStatus !== 'idle') {
    sendError(player, 'INVALID_STATE', 'Player is already queuing or in a game');
    return;
  }

  if (!enforceNotBanned(player)) {
    return;
  }

  if (player.userId !== undefined) {
    refreshAuth(player);
  } else if (payload.elo !== undefined) {
    player.elo = payload.elo;
  }

  const position = matchmaking.enqueue(player.playerId, player.elo);
  player.connectionStatus = 'queuing';

  sendMessage(player.ws, player, 'queue_status', {
    position,
    estimatedWaitSeconds: matchmaking.estimateWaitSeconds(),
  });
}

function handleLeaveQueue(player: PlayerState): void {
  if (player.connectionStatus !== 'queuing') {
    sendError(player, 'INVALID_STATE', 'Player is not in queue');
    return;
  }

  matchmaking.dequeue(player.playerId);
  player.connectionStatus = 'idle';

  sendMessage(player.ws, player, 'queue_status', {
    position: 0,
    estimatedWaitSeconds: 0,
  });
}

function handleCreateRoom(player: PlayerState): void {
  if (player.connectionStatus !== 'idle') {
    sendError(player, 'INVALID_STATE', 'Player is already in a game or queue');
    return;
  }

  if (!enforceNotBanned(player)) {
    return;
  }

  const roomId = roomManager.createRoom(player.playerId);
  const joinResult = roomManager.joinRoom(roomId, player.playerId);

  if (!joinResult.success) {
    sendError(player, 'ROOM_ERROR', joinResult.error ?? 'Failed to join room');
    return;
  }

  player.connectionStatus = 'playing';
  player.currentRoomId = roomId;

  sendMessage(player.ws, player, 'game_start', {
    roomId,
    opponentId: null,
    color: joinResult.color,
    fen: roomManager.getRoom(roomId)!.currentFen,
  });
}

function handleJoinRoom(player: PlayerState, payload: JoinRoomPayload): void {
  if (player.connectionStatus !== 'idle') {
    sendError(player, 'INVALID_STATE', 'Player is already in a game or queue');
    return;
  }

  if (!enforceNotBanned(player)) {
    return;
  }

  const result = roomManager.joinRoom(payload.roomId, player.playerId);
  if (!result.success) {
    sendError(player, 'ROOM_ERROR', result.error ?? 'Failed to join room');
    return;
  }

  player.connectionStatus = 'playing';
  player.currentRoomId = payload.roomId;

  const room = roomManager.getRoom(payload.roomId)!;

  // Notify the opponent that the game is starting
  const opponentId = roomManager.getOpponent(room, player.playerId);
  if (opponentId !== null) {
    const opponent = heartbeat.getPlayer(opponentId);
    if (opponent !== undefined) {
      sendMessage(opponent.ws, opponent, 'game_start', {
        roomId: payload.roomId,
        opponentId: player.playerId,
        color: roomManager.getPlayerColor(room, opponentId),
        fen: room.currentFen,
      });
    }
  }

  sendMessage(player.ws, player, 'game_start', {
    roomId: payload.roomId,
    opponentId,
    color: result.color,
    fen: room.currentFen,
  });
}

function handleSpectateRoom(player: PlayerState, payload: SpectateRoomPayload): void {
  if (player.connectionStatus !== 'idle') {
    sendError(player, 'INVALID_STATE', 'Cannot spectate while in a game or queue');
    return;
  }

  if (!enforceNotBanned(player)) {
    return;
  }

  const result = roomManager.addSpectator(payload.roomId, player.playerId);
  if (!result.success) {
    sendError(player, 'ROOM_ERROR', result.error ?? 'Failed to spectate');
    return;
  }

  player.connectionStatus = 'spectating';
  player.currentRoomId = payload.roomId;

  const room = roomManager.getRoom(payload.roomId);
  if (room !== undefined) {
    sendMessage(player.ws, player, 'game_start', {
      roomId: payload.roomId,
      opponentId: null,
      color: null,
      fen: room.currentFen,
    });
  }
}

function handleMakeMove(player: PlayerState, payload: MakeMovePayload): void {
  if (!enforceNotBanned(player)) {
    return;
  }

  const room = roomManager.getRoom(payload.roomId);
  if (room === undefined) {
    sendError(player, 'ROOM_ERROR', 'Room not found');
    return;
  }
  if (room.status !== 'playing') {
    sendError(player, 'INVALID_STATE', 'Game is not in progress');
    return;
  }
  if (player.currentRoomId !== payload.roomId) {
    sendError(player, 'INVALID_STATE', 'Player is not in this room');
    return;
  }

  // Record the move
  roomManager.recordMove(payload.roomId, {
    from: payload.from,
    to: payload.to,
    notation: payload.notation,
    fen: payload.fen,
    playerId: player.playerId,
    timestamp: Date.now(),
  });

  // Broadcast move to opponent and spectators
  const opponentId = roomManager.getOpponent(room, player.playerId);
  const moveData = {
    roomId: payload.roomId,
    from: payload.from,
    to: payload.to,
    notation: payload.notation,
    fen: payload.fen,
    by: player.playerId,
  };

  if (opponentId !== null) {
    const opponent = heartbeat.getPlayer(opponentId);
    if (opponent !== undefined) {
      sendMessage(opponent.ws, opponent, 'move_made', moveData);
    }
  }

  // Broadcast to spectators
  for (const specId of room.spectators) {
    const spec = heartbeat.getPlayer(specId);
    if (spec !== undefined) {
      sendMessage(spec.ws, spec, 'spectate_update', {
        ...moveData,
        spectatorCount: room.spectators.size,
      });
    }
  }
}

// ─── Handle Game Ended (natural win/loss/draw) ────────────────────────────

function handleGameEnded(player: PlayerState, payload: GameEndedPayload): void {
  const room = roomManager.getRoom(payload.roomId);
  if (room === undefined) return;
  if (room.status !== 'playing') return;
  if (player.currentRoomId !== payload.roomId) return;

  const winnerColor = payload.winner === 'white' ? 'white' : payload.winner === 'black' ? 'black' : null;
  let winnerId: string | null = null;
  if (winnerColor === 'white') winnerId = room.playerWhite;
  else if (winnerColor === 'black') winnerId = room.playerBlack;

  const whiteUser = room.playerWhite !== null ? getUserAuthRow(db, parseInt(room.playerWhite)) : null;
  const blackUser = room.playerBlack !== null ? getUserAuthRow(db, parseInt(room.playerBlack)) : null;

  if (whiteUser !== null && blackUser !== null) {
    const K = 32;
    const expectedWhite = 1 / (1 + Math.pow(10, (blackUser.elo - whiteUser.elo) / 400));
    const expectedBlack = 1 - expectedWhite;

    let actualWhite: number; let actualBlack: number;
    if (winnerColor === 'white') { actualWhite = 1; actualBlack = 0; }
    else if (winnerColor === 'black') { actualWhite = 0; actualBlack = 1; }
    else { actualWhite = 0.5; actualBlack = 0.5; }

    const newWhiteElo = Math.round(whiteUser.elo + K * (actualWhite - expectedWhite));
    const newBlackElo = Math.round(blackUser.elo + K * (actualBlack - expectedBlack));

    db.prepare('UPDATE users SET elo = ? WHERE id = ?').run(newWhiteElo, whiteUser.id);
    db.prepare('UPDATE users SET elo = ? WHERE id = ?').run(newBlackElo, blackUser.id);

    if (winnerColor === 'white') {
      db.prepare('UPDATE users SET wins = wins + 1 WHERE id = ?').run(whiteUser.id);
      db.prepare('UPDATE users SET losses = losses + 1 WHERE id = ?').run(blackUser.id);
    } else if (winnerColor === 'black') {
      db.prepare('UPDATE users SET wins = wins + 1 WHERE id = ?').run(blackUser.id);
      db.prepare('UPDATE users SET losses = losses + 1 WHERE id = ?').run(whiteUser.id);
    } else {
      db.prepare('UPDATE users SET draws = draws + 1 WHERE id = ?').run(whiteUser.id);
      db.prepare('UPDATE users SET draws = draws + 1 WHERE id = ?').run(blackUser.id);
    }
  }

  // Build FEN history from recorded moves
  const fenHistory = roomManager.getRoom(payload.roomId)?.moveHistory?.map(m => m.fen) ?? [];

  db.prepare(
    "INSERT INTO games (white_id, black_id, result, winner_id, fen_history, finished_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ).run(
    room.playerWhite, room.playerBlack,
    winnerColor !== null ? `${winnerColor}_win` : 'draw',
    winnerId,
    JSON.stringify(fenHistory)
  );

  finishRoomAndNotify(
    payload.roomId,
    winnerColor !== null ? `${winnerColor}_win` : 'draw',
    payload.reason ?? 'normal',
    winnerColor,
  );
}

function handleResign(player: PlayerState, payload: ResignPayload): void {
  if (!enforceNotBanned(player)) {
    return;
  }

  const room = roomManager.getRoom(payload.roomId);
  if (room === undefined) {
    sendError(player, 'ROOM_ERROR', 'Room not found');
    return;
  }

  const playerColor = roomManager.getPlayerColor(room, player.playerId);
  const winnerColor = playerColor === 'white' ? 'black' : 'white';
  const winnerId = playerColor === 'white' ? room.playerBlack : room.playerWhite;

  roomManager.finishRoom(payload.roomId);

  const gameOverData = {
    roomId: payload.roomId,
    result: `${winnerColor}_win`,
    reason: 'resignation',
    winner: winnerId,
  };

  // Notify both players
  for (const pid of [room.playerWhite, room.playerBlack]) {
    if (pid === null) continue;
    const p = heartbeat.getPlayer(pid);
    if (p !== undefined) {
      sendMessage(p.ws, p, 'game_over', gameOverData);
      p.connectionStatus = 'idle';
      p.currentRoomId = null;
    }
  }

  // Notify spectators
  for (const specId of room.spectators) {
    const spec = heartbeat.getPlayer(specId);
    if (spec !== undefined) {
      sendMessage(spec.ws, spec, 'game_over', gameOverData);
      spec.connectionStatus = 'idle';
      spec.currentRoomId = null;
    }
  }
}

function handleOfferDraw(player: PlayerState, payload: OfferDrawPayload): void {
  if (!enforceNotBanned(player)) {
    return;
  }

  const room = roomManager.getRoom(payload.roomId);
  if (room === undefined) {
    sendError(player, 'ROOM_ERROR', 'Room not found');
    return;
  }

  const opponentId = roomManager.getOpponent(room, player.playerId);
  if (opponentId === null) {
    sendError(player, 'ROOM_ERROR', 'No opponent');
    return;
  }

  const opponent = heartbeat.getPlayer(opponentId);
  if (opponent !== undefined) {
    sendMessage(opponent.ws, opponent, 'draw_offered', {
      roomId: payload.roomId,
      by: player.playerId,
    });
  }
}

function handleRespondDraw(player: PlayerState, payload: RespondDrawPayload): void {
  if (!enforceNotBanned(player)) {
    return;
  }

  const room = roomManager.getRoom(payload.roomId);
  if (room === undefined) {
    sendError(player, 'ROOM_ERROR', 'Room not found');
    return;
  }

  const opponentId = roomManager.getOpponent(room, player.playerId);
  if (opponentId === null) {
    sendError(player, 'ROOM_ERROR', 'No opponent');
    return;
  }

  const opponent = heartbeat.getPlayer(opponentId);
  if (opponent !== undefined) {
    sendMessage(opponent.ws, opponent, 'draw_response', {
      roomId: payload.roomId,
      accepted: payload.accept,
    });
  }

  if (payload.accept) {
    roomManager.finishRoom(payload.roomId);
    const drawData = {
      roomId: payload.roomId,
      result: 'draw',
      reason: 'agreement',
      winner: null,
    };

    for (const pid of [room.playerWhite, room.playerBlack]) {
      if (pid === null) continue;
      const p = heartbeat.getPlayer(pid);
      if (p !== undefined) {
        sendMessage(p.ws, p, 'game_over', drawData);
        p.connectionStatus = 'idle';
        p.currentRoomId = null;
      }
    }
  }
}

function handleChat(player: PlayerState, payload: ChatPayload): void {
  if (!enforceNotBanned(player)) {
    return;
  }

  const room = roomManager.getRoom(payload.roomId);
  if (room === undefined) {
    sendError(player, 'ROOM_ERROR', 'Room not found');
    return;
  }

  const chatData = {
    roomId: payload.roomId,
    from: player.playerId,
    message: payload.message,
  };

  // Send to opponent
  const opponentId = roomManager.getOpponent(room, player.playerId);
  if (opponentId !== null) {
    const opponent = heartbeat.getPlayer(opponentId);
    if (opponent !== undefined) {
      sendMessage(opponent.ws, opponent, 'chat_message', chatData);
    }
  }

  // Send to spectators
  for (const specId of room.spectators) {
    if (specId === player.playerId) continue;
    const spec = heartbeat.getPlayer(specId);
    if (spec !== undefined) {
      sendMessage(spec.ws, spec, 'chat_message', chatData);
    }
  }
}

function handleGetActiveGames(player: PlayerState): void {
  const games = roomManager.getActiveGames();
  sendMessage(player.ws, player, 'active_games', { games });
}

// ─── Disconnect Handler ──────────────────────────────────────────────────────

function handleDisconnect(player: PlayerState): void {
  // Remove from matchmaking queue if present
  if (player.connectionStatus === 'queuing') {
    matchmaking.dequeue(player.playerId);
  }

  // Handle room state
  if (player.currentRoomId !== null) {
    const room = roomManager.getRoom(player.currentRoomId);
    if (room !== undefined) {
      // Notify opponent of disconnection
      const opponentId = roomManager.getOpponent(room, player.playerId);
      if (opponentId !== null) {
        const opponent = heartbeat.getPlayer(opponentId);
        if (opponent !== undefined) {
          sendMessage(opponent.ws, opponent, 'opponent_disconnected', {
            roomId: player.currentRoomId,
          });
        }
      }
    }
  }

  // Mark as disconnected in heartbeat (starts grace period)
  heartbeat.markDisconnected(player.playerId);
}

// ─── Heartbeat Callbacks ─────────────────────────────────────────────────────

heartbeat.onDisconnect = (playerId: string) => {
  console.log(`[ws] Player ${playerId.slice(0, 8)} disconnected`);
};

heartbeat.onReconnect = (playerId: string) => {
  console.log(`[ws] Player ${playerId.slice(0, 8)} reconnected`);
  const player = heartbeat.getPlayer(playerId);
  if (player !== undefined && player.currentRoomId !== null) {
    const room = roomManager.getRoom(player.currentRoomId);
    if (room !== undefined) {
      const opponentId = roomManager.getOpponent(room, playerId);
      if (opponentId !== null) {
        const opponent = heartbeat.getPlayer(opponentId);
        if (opponent !== undefined) {
          sendMessage(opponent.ws, opponent, 'opponent_reconnected', {
            roomId: player.currentRoomId,
          });
        }
      }
      // Send game state to reconnected player
      sendMessage(player.ws, player, 'game_start', {
        roomId: room.id,
        opponentId,
        color: roomManager.getPlayerColor(room, playerId),
        fen: room.currentFen,
      });
    }
  }
};

heartbeat.onForfeit = (playerId: string) => {
  console.log(`[ws] Player ${playerId.slice(0, 8)} forfeited (timeout)`);
  const room = roomManager.getPlayerRoom(playerId);
  if (room !== undefined && room.status === 'playing') {
    const playerColor = roomManager.getPlayerColor(room, playerId);
    const winnerColor = playerColor === 'white' ? 'black' : 'white';
    const winnerId = playerColor === 'white' ? room.playerBlack : room.playerWhite;

    roomManager.finishRoom(room.id);

    const gameOverData = {
      roomId: room.id,
      result: `${winnerColor}_win`,
      reason: 'timeout',
      winner: winnerId,
    };

    for (const pid of [room.playerWhite, room.playerBlack]) {
      if (pid === null) continue;
      const p = heartbeat.getPlayer(pid);
      if (p !== undefined) {
        sendMessage(p.ws, p, 'game_over', gameOverData);
        p.connectionStatus = 'idle';
        p.currentRoomId = null;
      }
    }

    for (const specId of room.spectators) {
      const spec = heartbeat.getPlayer(specId);
      if (spec !== undefined) {
        sendMessage(spec.ws, spec, 'game_over', gameOverData);
      }
    }
  }
  heartbeat.unregister(playerId);
};

// ─── Utility ─────────────────────────────────────────────────────────────────

function sendMessage(
  ws: WebSocket,
  player: PlayerState,
  type: string,
  payload: Record<string, unknown>,
): void {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  player.seq++;
  const envelope: MessageEnvelope = {
    type,
    payload,
    timestamp: Date.now(),
    seq: player.seq,
  };
  try {
    ws.send(JSON.stringify(envelope));
  } catch {
    // Socket may have closed between check and send
  }
}

function sendError(player: PlayerState, code: string, message: string): void {
  sendMessage(player.ws, player, 'error', { code, message });
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

function shutdown(): void {
  console.log('[server] Shutting down gracefully...');
  heartbeat.stop();

  // Close database
  db.close();

  // Close all WebSocket connections
  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });

  wss.close(() => {
    httpServer.close(() => {
      console.log('[server] Shutdown complete');
      process.exit(0);
    });
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('[server] Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// ─── Start ───────────────────────────────────────────────────────────────────

heartbeat.start();

// ── Handle port-in-use errors gracefully ──────────────────────────────────

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[server] ✗ Port ${PORT} is already in use.`,
    );
    console.error(
      `[server]   Stop the existing process or set PORT env variable.`,
    );
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, () => {
  console.log(`[server] Nexus Chess server on http://localhost:${PORT}`);
  console.log(`[server] WebSocket: ws://localhost:${PORT}${WS_PATH}`);
  console.log(`[server] API: http://localhost:${PORT}/api/v1/`);
});
