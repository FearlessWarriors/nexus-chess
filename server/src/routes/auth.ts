/**
 * routes/auth.ts — Authentication Routes
 *
 * Provides:
 *   POST /api/v1/auth/register  — Create account
 *   POST /api/v1/auth/login     — Sign in
 *   GET  /api/v1/auth/me        — Get current user (JWT required)
 *   GET  /api/v1/leaderboard    — Top 500 leaderboard with badge info
 *   PUT  /api/v1/auth/badge     — Edit user badge text
 *   GET  /api/v1/users/:id      — Public user profile
 *
 * Also exports: verifyJwt, getUserAuthRow, bootstrapAdminUser
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type Database from 'better-sqlite3';

// ─── JWT Config ──────────────────────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET ?? 'nexus-chess-dev-secret-change-in-production';
const JWT_EXPIRES_IN = '7d';

// ─── Types ───────────────────────────────────────────────────────────────────

interface UserRow {
  id: number;
  name: string;
  password_hash: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  role: string;
  is_admin: number;
  badge_text: string;
  badge_type: string;
  suspended: number;
  suspended_reason: string;
  banned_until: string | null;
  ban_reason: string | null;
  banned_by: number | null;
  banned_at: string | null;
  ban_updated_at: string | null;
  created_at: string;
  last_seen_at: string;
}

export interface JwtPayload {
  userId: number;
  name: string;
}

export interface UserAuthRow {
  id: number;
  name: string;
  role: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  is_admin: 0 | 1;
  badge_text: string;
  badge_type: string;
  suspended: 0 | 1;
  suspended_reason: string;
  banned_until: string | null;
  ban_reason: string | null;
  is_banned: 0 | 1;
}

export function verifyJwt(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

export function getUserAuthRow(db: Database.Database, userId: number): UserAuthRow | null {
  const row = db
    .prepare(
      `SELECT
        id, name, role, elo, wins, losses, draws,
        is_admin, badge_text, badge_type,
        suspended, suspended_reason,
        banned_until, ban_reason,
        (banned_until IS NOT NULL AND banned_until > datetime('now')) as is_banned
      FROM users
      WHERE id = ?`,
    )
    .get(userId) as UserAuthRow | undefined;
  return row ?? null;
}

/**
 * Sanitize badge text: strip HTML/script tags, trim, max 10 characters.
 */
function sanitizeBadgeText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim()
    .slice(0, 10);
}

export function bootstrapAdminUser(db: Database.Database): void {
  const name = process.env.ADMIN_BOOTSTRAP_NAME;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (typeof name !== 'string' || name.trim().length === 0) {
    return;
  }
  if (typeof password !== 'string' || password.length < 6) {
    return;
  }

  const trimmedName = name.trim();
  const existing = db
    .prepare('SELECT id FROM users WHERE name = ?')
    .get(trimmedName) as { id: number } | undefined;

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);

  if (existing === undefined) {
    db.prepare(
      "INSERT INTO users (name, password_hash, elo, role, is_admin) VALUES (?, ?, ?, 'admin', 1)",
    ).run(trimmedName, passwordHash, 1200);
    return;
  }

  db.prepare(
    "UPDATE users SET role = 'admin', is_admin = 1, password_hash = ? WHERE id = ?",
  ).run(passwordHash, existing.id);
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Express middleware that verifies the JWT token from the Authorization header.
 * Attaches the decoded user to `req.user`.
 */
export function authMiddleware(
  req: Request & { user?: JwtPayload },
  res: Response,
  next: () => void,
): void {
  const authHeader = req.headers.authorization;
  if (authHeader === undefined || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader === undefined || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice(7);
}

function requireUser(
  db: Database.Database,
  req: Request,
  res: Response,
): UserAuthRow | null {
  const token = getBearerToken(req);
  if (token === null) {
    res.status(401).json({ error: '未登录' });
    return null;
  }

  const payload = verifyJwt(token);
  if (payload === null) {
    res.status(401).json({ error: '登录已过期，请重新登录' });
    return null;
  }

  const user = getUserAuthRow(db, payload.userId);
  if (user === null) {
    res.status(404).json({ error: '用户不存在' });
    return null;
  }

  // Check time-based ban
  if (user.is_banned === 1) {
    res.status(403).json({
      error: '账号已被封禁',
      bannedUntil: user.banned_until,
      reason: user.ban_reason,
    });
    return null;
  }

  // Check suspension (admin-issued permanent suspension)
  if (user.suspended === 1) {
    res.status(403).json({
      error: '账号已被管理员封禁',
      reason: user.suspended_reason || '违反社区规则',
    });
    return null;
  }

  return user;
}

// ─── Badge Type Calculation ──────────────────────────────────────────────────

/**
 * Determine badge_type based on leaderboard rank.
 * @returns 'top10' | 'top100' | 'top500' | '' (empty string for unranked)
 */
function getBadgeTypeByRank(rank: number): 'top10' | 'top100' | 'top500' | '' {
  if (rank <= 10) return 'top10';
  if (rank <= 100) return 'top100';
  if (rank <= 500) return 'top500';
  return '';
}

/**
 * Default badge text for a given badge type.
 */
function getDefaultBadgeText(badgeType: string): string {
  switch (badgeType) {
    case 'top10': return 'Top 10';
    case 'top100': return 'Top 100';
    case 'top500': return 'Top 500';
    default: return '';
  }
}

// ─── Route Factory ───────────────────────────────────────────────────────────

export function createAuthRouter(db: Database.Database): Router {
  const router = Router();

  // ── POST /api/v1/auth/register ──────────────────────────────────────────

  router.post('/api/v1/auth/register', (req: Request, res: Response) => {
    const { name, password } = req.body as { name?: string; password?: string };

    // Validate input
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 20) {
      res.status(400).json({ error: '昵称需要 2-20 个字符' });
      return;
    }
    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: '密码至少需要 6 位' });
      return;
    }

    const trimmedName = name.trim();

    // Check uniqueness
    const existing = db.prepare('SELECT id FROM users WHERE name = ?').get(trimmedName) as
      | { id: number }
      | undefined;
    if (existing !== undefined) {
      res.status(409).json({ error: '该昵称已被使用' });
      return;
    }

    // Hash password
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);

    // Insert user
    const result = db
      .prepare(
        'INSERT INTO users (name, password_hash, elo) VALUES (?, ?, ?)',
      )
      .run(trimmedName, passwordHash, 1200);

    const userId = result.lastInsertRowid as number;

    // Generate token
    const token = jwt.sign({ userId, name: trimmedName } satisfies JwtPayload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });

    res.status(201).json({
      token,
      user: {
        id: userId,
        name: trimmedName,
        elo: 1200,
        wins: 0,
        losses: 0,
        draws: 0,
        is_admin: false,
        badge_text: '',
        badge_type: '',
        suspended: false,
      },
    });
  });

  // ── POST /api/v1/auth/login ─────────────────────────────────────────────

  router.post('/api/v1/auth/login', (req: Request, res: Response) => {
    const { name, password } = req.body as { name?: string; password?: string };

    if (typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: '请输入昵称' });
      return;
    }
    if (typeof password !== 'string' || password.length === 0) {
      res.status(400).json({ error: '请输入密码' });
      return;
    }

    const trimmedName = name.trim();

    // Find user with all fields
    const user = db
      .prepare(
        `SELECT
          *,
          (banned_until IS NOT NULL AND banned_until > datetime('now')) as is_banned
        FROM users
        WHERE name = ?`,
      )
      .get(trimmedName) as (UserRow & { is_banned: 0 | 1 }) | undefined;

    if (user === undefined) {
      res.status(401).json({ error: '昵称或密码错误' });
      return;
    }

    // Verify password
    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: '昵称或密码错误' });
      return;
    }

    // Check time-based ban
    if (user.is_banned === 1) {
      res.status(403).json({
        error: '账号已被封禁',
        bannedUntil: user.banned_until,
        reason: user.ban_reason,
      });
      return;
    }

    // Check suspension
    if (user.suspended === 1) {
      res.status(403).json({
        error: '账号已被管理员封禁',
        reason: user.suspended_reason || '违反社区规则',
      });
      return;
    }

    // Update last_seen
    db.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?").run(
      user.id,
    );

    // Generate token
    const token = jwt.sign(
      { userId: user.id, name: user.name } satisfies JwtPayload,
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN },
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        elo: user.elo,
        wins: user.wins,
        losses: user.losses,
        draws: user.draws,
        is_admin: user.is_admin === 1,
        badge_text: user.badge_text,
        badge_type: user.badge_type,
        suspended: user.suspended === 1,
      },
    });
  });

  // ── GET /api/v1/auth/me ─────────────────────────────────────────────────

  router.get('/api/v1/auth/me', (req: Request, res: Response) => {
    const user = requireUser(db, req, res);
    if (user === null) {
      return;
    }

    db.prepare("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?").run(
      user.id,
    );

    const full = db
      .prepare(
        `SELECT id, name, elo, wins, losses, draws,
                is_admin, badge_text, badge_type,
                suspended, suspended_reason,
                created_at, last_seen_at
         FROM users WHERE id = ?`,
      )
      .get(user.id) as {
        id: number;
        name: string;
        elo: number;
        wins: number;
        losses: number;
        draws: number;
        is_admin: number;
        badge_text: string;
        badge_type: string;
        suspended: number;
        suspended_reason: string;
        created_at: string;
        last_seen_at: string;
      } | undefined;

    if (full === undefined) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    // Determine rank
    const rankRow = db
      .prepare('SELECT COUNT(*) as cnt FROM users WHERE elo > ?')
      .get(full.elo) as { cnt: number };
    const rank = rankRow.cnt + 1;

    res.json({
      user: {
        id: full.id,
        name: full.name,
        elo: full.elo,
        wins: full.wins,
        losses: full.losses,
        draws: full.draws,
        is_admin: full.is_admin === 1,
        badge_text: full.badge_text,
        badge_type: full.badge_type,
        suspended: full.suspended === 1,
        suspended_reason: full.suspended_reason,
        rank,
        created_at: full.created_at,
        last_seen_at: full.last_seen_at,
      },
    });
  });

  // ── PUT /api/v1/auth/badge ──────────────────────────────────────────────

  router.put('/api/v1/auth/badge', (req: Request, res: Response) => {
    const user = requireUser(db, req, res);
    if (user === null) {
      return;
    }

    const body = req.body as { badge_text?: string };
    const rawText = typeof body.badge_text === 'string' ? body.badge_text : '';
    const sanitized = sanitizeBadgeText(rawText);

    db.prepare('UPDATE users SET badge_text = ? WHERE id = ?').run(sanitized, user.id);

    res.json({
      success: true,
      badge_text: sanitized,
    });
  });

  // ── GET /api/v1/leaderboard ─────────────────────────────────────────────

  router.get('/api/v1/leaderboard', (_req: Request, res: Response) => {
    // Limit to top 500
    const limitRaw = typeof _req.query.limit === 'string' ? parseInt(_req.query.limit, 10) : 500;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 500;

    const players = db
      .prepare(
        `SELECT id, name, elo, wins, losses, draws,
                badge_text, badge_type
         FROM users
         ORDER BY elo DESC LIMIT ?`,
      )
      .all(limit) as Array<{
        id: number;
        name: string;
        elo: number;
        wins: number;
        losses: number;
        draws: number;
        badge_text: string;
        badge_type: string;
      }>;

    // Auto-assign badge_type based on rank and update DB if needed
    const updateStmt = db.prepare('UPDATE users SET badge_type = ? WHERE id = ?');

    const entries = players.map((p, idx) => {
      const rank = idx + 1;
      const autoBadgeType = getBadgeTypeByRank(rank);

      // Update DB if badge_type differs from auto-calculated
      if (autoBadgeType !== p.badge_type) {
        updateStmt.run(autoBadgeType, p.id);
        p.badge_type = autoBadgeType;
      }

      return {
        rank,
        id: String(p.id),
        name: p.name,
        elo: p.elo,
        wins: p.wins,
        losses: p.losses,
        draws: p.draws,
        totalGames: p.wins + p.losses + p.draws,
        winRate: p.wins + p.losses + p.draws > 0
          ? p.wins / (p.wins + p.losses + p.draws)
          : 0,
        badge_text: p.badge_text || getDefaultBadgeText(p.badge_type),
        badge_type: p.badge_type,
      };
    });

    res.json({ entries });
  });

  // ── GET /api/v1/users/:id ───────────────────────────────────────────────

  router.get('/api/v1/users/:id', (req: Request, res: Response) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      res.status(400).json({ error: 'Invalid user ID' });
      return;
    }

    const user = db
      .prepare(
        `SELECT id, name, elo, wins, losses, draws,
                badge_text, badge_type,
                created_at, last_seen_at
         FROM users WHERE id = ?`,
      )
      .get(userId) as {
        id: number;
        name: string;
        elo: number;
        wins: number;
        losses: number;
        draws: number;
        badge_text: string;
        badge_type: string;
        created_at: string;
        last_seen_at: string;
      } | undefined;

    if (user === undefined) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    // Determine rank
    const rankRow = db
      .prepare('SELECT COUNT(*) as cnt FROM users WHERE elo > ?')
      .get(user.elo) as { cnt: number };
    const rank = rankRow.cnt + 1;

    // Auto badge type
    const autoBadgeType = getBadgeTypeByRank(rank);
    const displayBadgeText = user.badge_text || getDefaultBadgeText(autoBadgeType || user.badge_type);

    res.json({
      user: {
        ...user,
        rank,
        badge_text: displayBadgeText,
        badge_type: autoBadgeType || user.badge_type,
      },
    });
  });

  return router;
}
