/**
 * routes/admin.ts — Admin Management Routes
 *
 * Provides:
 *   GET    /api/v1/admin/users              — List all users (search/pagination)
 *   POST   /api/v1/admin/users/:id/suspend  — Suspend a user
 *   POST   /api/v1/admin/users/:id/unsuspend — Unsuspend a user
 *   POST   /api/v1/admin/users/:id/promote  — Promote to admin
 *   POST   /api/v1/admin/users/:id/demote   — Demote from admin
 *   DELETE /api/v1/admin/games/:id          — Delete a game record
 *   POST   /api/v1/admin/users/:id/reset-password — Force reset password
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { verifyJwt, getUserAuthRow } from './auth.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdminUserRow {
  id: number;
  name: string;
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
  is_banned: 0 | 1;
  created_at: string;
  last_seen_at: string;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Middleware that verifies the user is authenticated AND is an admin.
 * Checks both `is_admin = 1` and `role = 'admin'` for compatibility.
 */
function requireAdmin(
  db: Database.Database,
  req: Request,
  res: Response,
): { id: number; name: string } | null {
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
    res.status(403).json({
      error: '账号已被封禁',
      bannedUntil: user.banned_until,
      reason: user.ban_reason,
    });
    return null;
  }

  if (user.is_admin !== 1 && user.role !== 'admin') {
    res.status(403).json({ error: '无管理员权限' });
    return null;
  }

  return { id: user.id, name: user.name };
}

/**
 * Generate a random alphanumeric password of given length.
 */
function generateRandomPassword(length: number = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * Sanitize badge text: strip HTML/script injection, trim, max 10 chars.
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

/**
 * Insert an admin audit log entry.
 */
function auditLog(
  db: Database.Database,
  adminId: number,
  action: string,
  targetUserId: number | null,
  reason: string | null,
  metadata: Record<string, unknown> = {},
): void {
  db.prepare(
    "INSERT INTO admin_audit (admin_id, action, target_user_id, reason, metadata) VALUES (?, ?, ?, ?, ?)",
  ).run(adminId, action, targetUserId, reason, JSON.stringify(metadata));
}

// ─── Router Factory ──────────────────────────────────────────────────────────

export function createAdminRouter(db: Database.Database): Router {
  const router = Router();

  // ── GET /api/v1/admin/users ──────────────────────────────────────────────

  router.get('/users', (req: Request, res: Response) => {
    const admin = requireAdmin(db, req, res);
    if (admin === null) {
      return;
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
    const offsetRaw = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    const rows = q.length > 0
      ? (db
        .prepare(
          `SELECT
            id, name, elo, wins, losses, draws, role,
            is_admin, badge_text, badge_type,
            suspended, suspended_reason,
            banned_until, ban_reason,
            (banned_until IS NOT NULL AND banned_until > datetime('now')) as is_banned,
            created_at, last_seen_at
          FROM users
          WHERE name LIKE ?
          ORDER BY id DESC
          LIMIT ? OFFSET ?`,
        )
        .all(`%${q}%`, limit, offset) as AdminUserRow[])
      : (db
        .prepare(
          `SELECT
            id, name, elo, wins, losses, draws, role,
            is_admin, badge_text, badge_type,
            suspended, suspended_reason,
            banned_until, ban_reason,
            (banned_until IS NOT NULL AND banned_until > datetime('now')) as is_banned,
            created_at, last_seen_at
          FROM users
          ORDER BY id DESC
          LIMIT ? OFFSET ?`,
        )
        .all(limit, offset) as AdminUserRow[]);

    // Count total for pagination
    const countRow = q.length > 0
      ? (db.prepare('SELECT COUNT(*) as total FROM users WHERE name LIKE ?').get(`%${q}%`) as { total: number })
      : (db.prepare('SELECT COUNT(*) as total FROM users').get() as { total: number });

    res.json({
      users: rows,
      total: countRow.total,
      limit,
      offset,
      viewer: { id: admin.id, name: admin.name },
    });
  });

  // ── POST /api/v1/admin/users/:id/suspend ────────────────────────────────

  router.post('/users/:id/suspend', (req: Request, res: Response) => {
    const admin = requireAdmin(db, req, res);
    if (admin === null) {
      return;
    }

    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: '无效的用户 ID' });
      return;
    }

    const body = req.body as { reason?: string };
    const reason = typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 200)
      : '管理员封禁';

    const target = getUserAuthRow(db, userId);
    if (target === null) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    if (target.is_admin === 1 || target.role === 'admin') {
      res.status(403).json({ error: '不能封禁管理员账号' });
      return;
    }

    db.prepare(
      'UPDATE users SET suspended = 1, suspended_reason = ? WHERE id = ?',
    ).run(reason, userId);

    auditLog(db, admin.id, 'suspend', userId, reason, {});

    res.json({ success: true, suspended: true, reason });
  });

  // ── POST /api/v1/admin/users/:id/unsuspend ──────────────────────────────

  router.post('/users/:id/unsuspend', (req: Request, res: Response) => {
    const admin = requireAdmin(db, req, res);
    if (admin === null) {
      return;
    }

    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: '无效的用户 ID' });
      return;
    }

    const target = getUserAuthRow(db, userId);
    if (target === null) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    db.prepare(
      'UPDATE users SET suspended = 0, suspended_reason = \'\' WHERE id = ?',
    ).run(userId);

    auditLog(db, admin.id, 'unsuspend', userId, null, {});

    res.json({ success: true, suspended: false });
  });

  // ── POST /api/v1/admin/users/:id/promote ────────────────────────────────

  router.post('/users/:id/promote', (req: Request, res: Response) => {
    const admin = requireAdmin(db, req, res);
    if (admin === null) {
      return;
    }

    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: '无效的用户 ID' });
      return;
    }

    const target = getUserAuthRow(db, userId);
    if (target === null) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    db.prepare(
      "UPDATE users SET is_admin = 1, role = 'admin' WHERE id = ?",
    ).run(userId);

    auditLog(db, admin.id, 'promote', userId, null, {});

    res.json({ success: true, userId, is_admin: true });
  });

  // ── POST /api/v1/admin/users/:id/demote ─────────────────────────────────

  router.post('/users/:id/demote', (req: Request, res: Response) => {
    const admin = requireAdmin(db, req, res);
    if (admin === null) {
      return;
    }

    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: '无效的用户 ID' });
      return;
    }

    if (userId === admin.id) {
      res.status(400).json({ error: '不能移除自己的管理员权限' });
      return;
    }

    const target = getUserAuthRow(db, userId);
    if (target === null) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    db.prepare(
      "UPDATE users SET is_admin = 0, role = 'user' WHERE id = ?",
    ).run(userId);

    auditLog(db, admin.id, 'demote', userId, null, {});

    res.json({ success: true, userId, is_admin: false });
  });

  // ── DELETE /api/v1/admin/games/:id ──────────────────────────────────────

  router.delete('/games/:id', (req: Request, res: Response) => {
    const admin = requireAdmin(db, req, res);
    if (admin === null) {
      return;
    }

    const gameId = parseInt(req.params.id, 10);
    if (!Number.isFinite(gameId)) {
      res.status(400).json({ error: '无效的对局 ID' });
      return;
    }

    const game = db.prepare('SELECT id FROM games WHERE id = ?').get(gameId) as
      | { id: number }
      | undefined;

    if (game === undefined) {
      res.status(404).json({ error: '对局不存在' });
      return;
    }

    db.prepare('DELETE FROM games WHERE id = ?').run(gameId);
    auditLog(db, admin.id, 'delete_game', null, `Deleted game #${gameId}`, { gameId });

    res.json({ success: true, deleted: gameId });
  });

  // ── POST /api/v1/admin/users/:id/reset-password ─────────────────────────

  router.post('/users/:id/reset-password', (req: Request, res: Response) => {
    const admin = requireAdmin(db, req, res);
    if (admin === null) {
      return;
    }

    const userId = parseInt(req.params.id, 10);
    if (!Number.isFinite(userId)) {
      res.status(400).json({ error: '无效的用户 ID' });
      return;
    }

    const target = getUserAuthRow(db, userId);
    if (target === null) {
      res.status(404).json({ error: '用户不存在' });
      return;
    }

    const newPassword = generateRandomPassword(8);
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(newPassword, salt);

    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
    auditLog(db, admin.id, 'reset_password', userId, 'Password reset', {});

    res.json({ success: true, userId, newPassword });
  });

  // ── GET /api/v1/admin/games ─────────────────────────────────────────────

  router.get('/games', (req: Request, res: Response) => {
    const admin = requireAdmin(db, req, res);
    if (admin === null) {
      return;
    }

    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 50;
    const offsetRaw = typeof req.query.offset === 'string' ? parseInt(req.query.offset, 10) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

    const games = db
      .prepare(
        `SELECT g.id, g.white_id, g.black_id, g.result, g.winner_id,
                g.created_at, g.finished_at,
                w.name as white_name, b.name as black_name
         FROM games g
         LEFT JOIN users w ON g.white_id = w.id
         LEFT JOIN users b ON g.black_id = b.id
         ORDER BY g.id DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as Array<{
        id: number;
        white_id: number | null;
        black_id: number | null;
        result: string;
        winner_id: number | null;
        created_at: string;
        finished_at: string | null;
        white_name: string | null;
        black_name: string | null;
      }>;

    const countRow = db.prepare('SELECT COUNT(*) as total FROM games').get() as { total: number };

    res.json({ games, total: countRow.total, limit, offset });
  });

  return router;
}
