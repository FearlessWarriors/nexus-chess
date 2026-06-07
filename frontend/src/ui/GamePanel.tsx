import React from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
} from '@mui/material';
import {
  Flag as FlagIcon,
  Handshake as HandshakeIcon,
  Undo as UndoIcon,
} from '@mui/icons-material';
import { GameState, Color, GameStatus, posToString } from '../engine/types';
import type { Game } from '../engine/game';

// ─── Props ────────────────────────────────────────────────────────────────────

interface GamePanelProps {
  game: Game;
  /** 'local' for local play, 'online' for networked games */
  gameMode: 'local' | 'online';
  /** Player's color in online mode (for perspective) */
  playerColor?: Color;
  /** Called when resign button is clicked */
  onResign?: () => void;
  /** Called when draw offer button is clicked */
  onDraw?: () => void;
  /** Called when undo button is clicked (local only) */
  onUndo?: () => void;
}

// ─── Game Over Messages ───────────────────────────────────────────────────────

const GAME_OVER_REASONS: Record<number, string> = {
  [GameStatus.WHITE_WIN]: '白方胜利',
  [GameStatus.BLACK_WIN]: '黑方胜利',
  [GameStatus.DRAW]: '平局',
  [GameStatus.WHITE_RESIGN]: '白方认输 — 黑方胜',
  [GameStatus.BLACK_RESIGN]: '黑方认输 — 白方胜',
};

function getGameOverTitle(status: GameStatus): string {
  if (status === GameStatus.DRAW) return '平局！';
  if (status === GameStatus.WHITE_WIN || status === GameStatus.BLACK_RESIGN) return '白方获胜！';
  if (status === GameStatus.BLACK_WIN || status === GameStatus.WHITE_RESIGN) return '黑方获胜！';
  return '游戏结束';
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Game status panel showing turn indicator, move history, captured pieces,
 * and action buttons (resign, draw, undo).
 */
export default function GamePanel({
  game,
  gameMode,
  playerColor,
  onResign,
  onDraw,
  onUndo,
}: GamePanelProps): JSX.Element {
  const { state } = game;
  const isOver = state.status !== GameStatus.IN_PROGRESS;

  // Piece counts
  const whitePieceCount = countPieces(state, Color.WHITE);
  const blackPieceCount = countPieces(state, Color.BLACK);

  const turnLabel =
    state.turn === Color.WHITE ? '白方走棋' : '黑方走棋';
  const turnColor = state.turn === Color.WHITE ? '#FFF8DC' : '#1A1A1A';

  // Reverse move history for display (latest first)
  const displayMoves = [...state.moveHistory].reverse();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 220, maxWidth: 280 }}>
      {/* ── Turn Indicator ─────────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box
            sx={{
              width: 20,
              height: 20,
              borderRadius: '50%',
              backgroundColor: turnColor,
              border: '2px solid',
              borderColor: state.turn === Color.WHITE ? '#8B7355' : '#666',
              boxShadow: isOver ? 'none' : '0 0 8px rgba(255,215,0,0.6)',
              transition: 'all 0.3s',
            }}
          />
          <Typography variant="body2" fontWeight={600}>
            {isOver ? '游戏结束' : turnLabel}
          </Typography>
        </Stack>
      </Paper>

      {/* ── Move History ───────────────────────────────────────────────── */}
      <Paper
        variant="outlined"
        sx={{
          p: 1.5,
          maxHeight: 280,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Typography variant="caption" color="text.secondary" gutterBottom>
          走法记录
        </Typography>
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            fontSize: '0.8rem',
            fontFamily: 'monospace',
            lineHeight: 1.7,
            maxHeight: 240,
          }}
        >
          {displayMoves.length === 0 && (
            <Typography variant="caption" color="text.disabled">
              尚无走法
            </Typography>
          )}
          {displayMoves.map((move, idx) => {
            const moveNum = state.fullMoveNumber - Math.floor(idx / 2);
            const isWhite = move.piece.color === Color.WHITE;
            return (
              <Box
                key={idx}
                sx={{
                  display: 'flex',
                  gap: 1,
                  py: 0.25,
                  color: isWhite ? 'grey.300' : 'grey.400',
                }}
              >
                <Typography variant="caption" color="text.disabled" sx={{ minWidth: 28 }}>
                  {isWhite ? `${moveNum}.` : ''}
                </Typography>
                <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                  {move.notation}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Paper>

      {/* ── Piece Count Summary ─────────────────────────────────────────── */}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="caption" color="text.secondary" gutterBottom>
          棋子数量
        </Typography>
        <Stack direction="row" spacing={2}>
          <Box>
            <Typography variant="caption" color="text.disabled">
              白方: {whitePieceCount}/7
            </Typography>
          </Box>
          <Box>
            <Typography variant="caption" color="text.disabled">
              黑方: {blackPieceCount}/7
            </Typography>
          </Box>
        </Stack>
      </Paper>

      {/* ── Action Buttons ─────────────────────────────────────────────── */}
      <Stack direction="row" spacing={1}>
        <Button
          variant="outlined"
          size="small"
          color="error"
          startIcon={<FlagIcon />}
          onClick={onResign}
          disabled={isOver}
          fullWidth
        >
          认输
        </Button>
        {gameMode === 'online' && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<HandshakeIcon />}
            onClick={onDraw}
            disabled={isOver}
            fullWidth
          >
            提和
          </Button>
        )}
        {gameMode === 'local' && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<UndoIcon />}
            onClick={onUndo}
            disabled={isOver || state.moveHistory.length === 0}
            fullWidth
          >
            撤销
          </Button>
        )}
      </Stack>

      {/* ── Game Over Dialog ───────────────────────────────────────────── */}
      <Dialog open={isOver} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ textAlign: 'center' }}>
          {getGameOverTitle(state.status)}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            {GAME_OVER_REASONS[state.status]}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'center', pb: 2 }}>
          <Button variant="contained" onClick={() => game.reset()}>
            再来一局
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function countPieces(state: GameState, color: Color): number {
  let count = 0;
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      const p = state.board[row][col];
      if (p !== null && p.color === color) {
        count++;
      }
    }
  }
  return count;
}
