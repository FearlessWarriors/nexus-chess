/**
 * ai.ts — Cloud AI Move Endpoint
 *
 * POST /api/v1/ai/move
 *
 * Receives a FEN string and difficulty level, calls the Python gravity engine
 * via subprocess, and returns the best move.
 */
import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Router ──────────────────────────────────────────────────────────────────

const router = Router();

// ─── Python Path ─────────────────────────────────────────────────────────────

const PYTHON_EXE = process.env.PYTHON_PATH ?? 'python';
const AI_SCRIPT = path.resolve(__dirname, '..', '..', '..', 'ai', 'ai_move.py');

// ─── Types ───────────────────────────────────────────────────────────────────

interface AiMoveRequest {
  fen: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
}

interface AiMoveResponse {
  from: string;
  to: string;
  notation: string;
  score: number;
  fen?: string;
  error?: string;
}

// ─── POST /api/v1/ai/move ────────────────────────────────────────────────────

router.post('/move', (req: Request, res: Response) => {
  const body = req.body as AiMoveRequest;

  if (typeof body.fen !== 'string' || body.fen.trim().length === 0) {
    res.status(400).json({ error: 'Missing or invalid "fen" field' });
    return;
  }

  const fen = body.fen.trim();
  const difficulty = body.difficulty ?? 'intermediate';

  if (!['beginner', 'intermediate', 'advanced'].includes(difficulty)) {
    res.status(400).json({ error: `Invalid difficulty: ${difficulty}` });
    return;
  }

  // Spawn Python process to compute the best move.
  const proc = spawn(PYTHON_EXE, [AI_SCRIPT, fen, difficulty], {
    timeout: 30_000, // 30-second timeout for AI computation
  });

  let stdout = '';
  let stderr = '';

  proc.stdout.on('data', (data: Buffer) => {
    stdout += data.toString();
  });

  proc.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
  });

  proc.on('error', (err: NodeJS.ErrnoException) => {
    console.error('[ai] Failed to spawn Python process:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'AI engine unavailable (spawn failed)' });
    }
  });

  proc.on('close', (code: number | null) => {
    if (res.headersSent) {
      return;
    }

    if (code !== 0) {
      console.error(`[ai] Python exited with code ${code}:`, stderr);
      res.status(500).json({
        error: 'AI engine error',
        details: stderr.slice(0, 500),
      });
      return;
    }

    try {
      const result: AiMoveResponse = JSON.parse(stdout.trim());
      if (result.error !== undefined) {
        res.status(422).json({ error: result.error });
        return;
      }
      res.json(result);
    } catch (parseErr) {
      console.error('[ai] Failed to parse Python output:', parseErr);
      res.status(500).json({
        error: 'AI engine returned invalid response',
        raw: stdout.slice(0, 500),
      });
    }
  });
});

// ─── Health Check ────────────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', engine: 'alpha-beta', provider: 'gravity_rules.py' });
});

export default router;
