import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Chip,
  Stack,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  LinearProgress,
} from '@mui/material';
import {
  Flag as FlagIcon,
  Handshake as HandshakeIcon,
  Undo as UndoIcon,
  Refresh as RefreshIcon,
  KeyboardArrowLeft as PrevIcon,
  KeyboardArrowRight as NextIcon,
  ChatBubbleOutline as ChatIcon,
  Send as SendIcon,
} from '@mui/icons-material';
import { Game } from '../engine/game';
import { GameState, Color, GameStatus, Position, Move, PieceType, posToString, opponentColor } from '../engine/types';
import { getControlZone, getLockedPieces } from '../engine/gravity';
import { getPieces, getCore } from '../engine/board';
import { WSClient } from '../network/Client';
import { RoomClient } from '../network/RoomClient';
import { search, AiDifficulty } from '../ai/search';
import { FEN } from '../engine/fen';
import { useAuth } from '../auth/AuthContext';
import BadgeChip, { type BadgeType } from './BadgeChip';
import { WS_URL, API_BASE } from '../config';
import Board from './Board';
import QueuePanel from './QueuePanel';
import RoomPanel from './RoomPanel';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GameMode = 'local' | 'ai' | 'online' | 'spectate';

interface GamePageProps {
  mode: GameMode;
  onBack: () => void;
  /** Pre-filled roomId for spectate */
  spectateRoomId?: string;
}

interface RoomInfo {
  roomId: string;
  opponentName: string;
  opponentElo: number;
  opponentConnected: boolean;
  spectators: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const AI_DIFFICULTY: AiDifficulty = 'intermediate';
const AI_THINK_MS = 300; // Simulate thinking delay

// ─── Color Labels ─────────────────────────────────────────────────────────────

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

// ─── GamePage Component ───────────────────────────────────────────────────────

export default function GamePage({ mode, onBack, spectateRoomId }: GamePageProps): JSX.Element {
  if (mode === 'online') {
    return <OnlineGamePage onBack={onBack} />;
  }
  if (mode === 'spectate') {
    return <SpectateGamePage onBack={onBack} roomId={spectateRoomId ?? ''} />;
  }
  if (mode === 'ai') {
    return <AIGamePage onBack={onBack} />;
  }
  // local
  return <LocalGamePage onBack={onBack} />;
}

// ─── Shared Lichess-style 3-Column Layout ─────────────────────────────────────

interface ThreeColumnLayoutProps {
  topSection: React.ReactNode;
  boardSection: React.ReactNode;
  bottomSection: React.ReactNode;
  rightSection: React.ReactNode;
  onBack: () => void;
}

function ThreeColumnLayout({
  topSection,
  boardSection,
  bottomSection,
  rightSection,
  onBack,
}: ThreeColumnLayoutProps): JSX.Element {
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 2,
        maxWidth: 1100,
        mx: 'auto',
        justifyContent: 'center',
      }}
    >
      {/* Back button */}
      <Box sx={{ width: '100%', mb: -1 }}>
        <Button
          size="small"
          onClick={onBack}
          sx={{ color: '#999', fontSize: '0.75rem', minWidth: 0 }}
        >
          ← 返回
        </Button>
      </Box>

      {/* Left: Control Panel */}
      <Box
        sx={{
          width: { xs: '100%', md: 180 },
          order: { xs: 2, md: 1 },
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        {rightSection}
      </Box>

      {/* Center: Board */}
      <Box
        sx={{
          width: { xs: '100%', md: 'auto' },
          order: { xs: 1, md: 2 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 1,
        }}
      >
        {topSection}
        {boardSection}
        {bottomSection}
      </Box>

      {/* Right: Game Info */}
      <Box
        sx={{
          width: { xs: '100%', md: 220 },
          order: { xs: 3, md: 3 },
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        {/* right panel content will be injected by each game mode */}
      </Box>
    </Box>
  );
}

// ─── Move History Panel (shared) ──────────────────────────────────────────────

function MoveHistoryPanel({
  moves,
  fullMoveNumber,
}: {
  moves: Move[];
  fullMoveNumber: number;
}): JSX.Element {
  const pairs: Array<{ num: number; white: Move | null; black: Move | null }> = [];
  const startNum = 1;
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({
      num: startNum + Math.floor(i / 2),
      white: moves[i]?.piece.color === Color.WHITE ? moves[i] : i + 1 < moves.length ? moves[i + 1] : null,
      black: null,
    });
  }

  // Rebuild properly
  const properPairs: Array<{ num: number; white: string; black: string }> = [];
  let moveNum = 1;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m.piece.color === Color.WHITE) {
      properPairs.push({ num: moveNum, white: m.notation, black: '' });
    } else {
      if (properPairs.length > 0 && properPairs[properPairs.length - 1].black === '') {
        properPairs[properPairs.length - 1].black = m.notation;
      } else {
        properPairs.push({ num: moveNum, white: '', black: m.notation });
      }
      moveNum++;
    }
  }

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        bgcolor: '#1e1e1e',
        borderColor: '#333',
        borderRadius: 1,
        maxHeight: 200,
        overflowY: 'auto',
      }}
    >
      <Typography variant="caption" color="#888" sx={{ mb: 0.5, display: 'block' }}>
        走法记录
      </Typography>
      {properPairs.length === 0 && (
        <Typography variant="caption" color="#555">
          尚无走法
        </Typography>
      )}
      <Box
        sx={{
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: '0.72rem',
          lineHeight: 1.8,
          color: '#aaa',
        }}
      >
        {properPairs.map((pair, idx) => (
          <Box
            key={idx}
            sx={{
              display: 'flex',
              '&:hover': { bgcolor: 'rgba(98,153,36,0.08)' },
            }}
          >
            <Typography
              variant="caption"
              sx={{
                fontFamily: 'monospace',
                minWidth: 28,
                color: '#666',
                fontSize: '0.7rem',
              }}
            >
              {pair.num}.
            </Typography>
            <Typography
              variant="caption"
              sx={{
                fontFamily: 'monospace',
                minWidth: 56,
                fontSize: '0.7rem',
                color: '#ccc',
              }}
            >
              {pair.white}
            </Typography>
            <Typography
              variant="caption"
              sx={{
                fontFamily: 'monospace',
                minWidth: 56,
                fontSize: '0.7rem',
                color: '#aaa',
              }}
            >
              {pair.black}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}

// ─── Control Zone Stats Panel ─────────────────────────────────────────────────

function ControlZoneStats({ game }: { game: Game }): JSX.Element {
  const whiteZone = useMemo(() => getControlZone(game.state.board, Color.WHITE).size, [game.state]);
  const blackZone = useMemo(() => getControlZone(game.state.board, Color.BLACK).size, [game.state]);
  const whitePieces = useMemo(() => getPieces(game.state.board, Color.WHITE).length, [game.state]);
  const blackPieces = useMemo(() => getPieces(game.state.board, Color.BLACK).length, [game.state]);
  const whiteLocked = useMemo(() => getLockedPieces(game.state.board, Color.WHITE).length, [game.state]);
  const blackLocked = useMemo(() => getLockedPieces(game.state.board, Color.BLACK).length, [game.state]);

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        bgcolor: '#1e1e1e',
        borderColor: '#333',
        borderRadius: 1,
      }}
    >
      <Typography variant="caption" color="#888" sx={{ mb: 1, display: 'block' }}>
        控制区统计
      </Typography>
      <Stack spacing={0.5}>
        <StatBar label="白方控制" value={whiteZone} color="#fff8dc" />
        <StatBar label="黑方控制" value={blackZone} color="#444" />
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
          <Typography variant="caption" color="#888">白方棋子: {whitePieces}</Typography>
          <Typography variant="caption" color="#888">黑方棋子: {blackPieces}</Typography>
        </Stack>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="caption" color={whiteLocked > 0 ? '#e53e3e' : '#666'}>
            白锁: {whiteLocked}
          </Typography>
          <Typography variant="caption" color={blackLocked > 0 ? '#e53e3e' : '#666'}>
            黑锁: {blackLocked}
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  );
}

function StatBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}): JSX.Element {
  const pct = Math.min(100, (value / 49) * 100);
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
        <Typography variant="caption" color="#999" fontSize="0.65rem">
          {label}
        </Typography>
        <Typography variant="caption" color="#ccc" fontSize="0.65rem">
          {value}/49
        </Typography>
      </Stack>
      <Box sx={{ height: 4, bgcolor: '#333', borderRadius: 1, overflow: 'hidden' }}>
        <Box
          sx={{
            height: '100%',
            width: `${pct}%`,
            bgcolor: color,
            borderRadius: 1,
            transition: 'width 0.3s',
          }}
        />
      </Box>
    </Box>
  );
}

// ─── Hotkeys Panel ────────────────────────────────────────────────────────────

function HotkeysPanel(): JSX.Element {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        bgcolor: '#1e1e1e',
        borderColor: '#333',
        borderRadius: 1,
      }}
    >
      <Typography variant="caption" color="#888" sx={{ mb: 0.5, display: 'block' }}>
        快捷键
      </Typography>
      <Stack spacing={0.3}>
        <HotkeyRow keys="← → ↑ ↓" desc="移动光标" />
        <HotkeyRow keys="Enter" desc="确认落子" />
        <HotkeyRow keys="Z" desc="撤销走法" />
        <HotkeyRow keys="N" desc="新对局" />
      </Stack>
    </Paper>
  );
}

function HotkeyRow({ keys, desc }: { keys: string; desc: string }): JSX.Element {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography variant="caption" color="#999" fontSize="0.65rem">
        {desc}
      </Typography>
      <Box
        sx={{
          fontFamily: 'monospace',
          fontSize: '0.6rem',
          color: '#629924',
          bgcolor: 'rgba(98,153,36,0.1)',
          px: 0.6,
          py: 0.2,
          borderRadius: 0.5,
        }}
      >
        {keys}
      </Box>
    </Stack>
  );
}

// ─── Local Game Page ──────────────────────────────────────────────────────────

function LocalGamePage({ onBack }: { onBack: () => void }): JSX.Element {
  const gameRef = useRef<Game>(new Game());
  const [gameRefTrigger, setGameRefTrigger] = useState(0);
  const game = gameRef.current;

  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [legalMoves, setLegalMoves] = useState<Position[]>([]);
  const [lastMove, setLastMove] = useState<Move | null>(null);

  const forceUpdate = useCallback(() => {
    setGameRefTrigger((n) => n + 1);
  }, []);

  const handleSquareClick = useCallback(
    (col: number, row: number) => {
      const piece = game.state.board[row][col];
      if (selectedPos !== null) {
        if (selectedPos.col === col && selectedPos.row === row) {
          setSelectedPos(null);
          setLegalMoves([]);
          return;
        }
        if (piece !== null && piece.color === game.state.turn) {
          setSelectedPos({ col, row });
          setLegalMoves(game.getLegalMoves({ col, row }));
          return;
        }
        const result = game.makeMove(selectedPos, { col, row });
        if (result.success) {
          const hist = game.state.moveHistory;
          setLastMove(hist.length > 0 ? hist[hist.length - 1] : null);
          setSelectedPos(null);
          setLegalMoves([]);
          forceUpdate();
        } else {
          setSelectedPos(null);
          setLegalMoves([]);
        }
        return;
      }
      if (piece !== null && piece.color === game.state.turn) {
        setSelectedPos({ col, row });
        setLegalMoves(game.getLegalMoves({ col, row }));
      }
    },
    [game, selectedPos, forceUpdate],
  );

  const handleResign = useCallback(() => {
    const currentColor = game.state.turn;
    game.state.status = currentColor === Color.WHITE ? GameStatus.WHITE_RESIGN : GameStatus.BLACK_RESIGN;
    game.state.winner = currentColor === Color.WHITE ? Color.BLACK : Color.WHITE;
    forceUpdate();
  }, [game, forceUpdate]);

  const handleUndo = useCallback(() => {
    const success = game.undoMove();
    if (success) {
      setSelectedPos(null);
      setLegalMoves([]);
      const hist = game.state.moveHistory;
      setLastMove(hist.length > 0 ? hist[hist.length - 1] : null);
      forceUpdate();
    }
  }, [game, forceUpdate]);

  const handleNewGame = useCallback(() => {
    game.reset();
    setSelectedPos(null);
    setLegalMoves([]);
    setLastMove(null);
    forceUpdate();
  }, [game, forceUpdate]);

  const lockedPositions = useMemo(() => {
    const locked = getLockedPieces(game.state.board, game.state.turn);
    return new Set(locked.map((p) => posToString(p.pos)));
  }, [game.state.board, game.state.turn, gameRefTrigger]);

  const isOver = game.state.status !== GameStatus.IN_PROGRESS;

  const turnLabel = game.state.turn === Color.WHITE ? '白方走棋' : '黑方走棋';
  const turnColor = game.state.turn === Color.WHITE ? '#FFF8DC' : '#1A1A1A';

  return (
    <ThreeColumnLayout
      onBack={onBack}
      topSection={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', maxWidth: 460 }}>
          <Box
            sx={{
              color: '#ccc',
              fontWeight: 600,
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: 0.8,
            }}
          >
            <Box
              sx={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                bgcolor: turnColor,
                border: '1.5px solid',
                borderColor: game.state.turn === Color.WHITE ? '#8B7355' : '#666',
                boxShadow: isOver ? 'none' : '0 0 8px rgba(255,215,0,0.5)',
              }}
            />
            {isOver ? '游戏结束' : turnLabel}
          </Box>
        </Box>
      }
      boardSection={
        <Board
          board={game.state.board}
          selectedPos={selectedPos}
          legalMoves={legalMoves}
          lastMove={lastMove}
          onSquareClick={handleSquareClick}
          currentTurn={game.state.turn}
          lockedPositions={lockedPositions}
          coreCooldown={game.state.coreCooldown}
        />
      }
      bottomSection={
        <Box sx={{ width: '100%', maxWidth: 460 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <Button
              variant="outlined"
              size="small"
              color="error"
              startIcon={<FlagIcon />}
              onClick={handleResign}
              disabled={isOver}
              sx={{
                borderColor: '#555',
                color: '#e53e3e',
                fontSize: '0.7rem',
                '&:hover': { borderColor: '#e53e3e' },
              }}
            >
              认输
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<UndoIcon />}
              onClick={handleUndo}
              disabled={isOver || game.state.moveHistory.length === 0}
              sx={{
                borderColor: '#555',
                color: '#aaa',
                fontSize: '0.7rem',
                '&:hover': { borderColor: '#888' },
              }}
            >
              撤销
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            {isOver && (
              <Button
                variant="contained"
                size="small"
                startIcon={<RefreshIcon />}
                onClick={handleNewGame}
                sx={{
                  bgcolor: '#629924',
                  fontSize: '0.7rem',
                  '&:hover': { bgcolor: '#7ab528' },
                }}
              >
                再来一局
              </Button>
            )}
          </Stack>
          <MoveHistoryPanel moves={game.state.moveHistory} fullMoveNumber={game.state.fullMoveNumber} />
        </Box>
      }
      rightSection={
        <>
          <ControlZoneStats game={game} />
          <HotkeysPanel />
        </>
      }
    />
  );
}

// ─── AI Game Page ─────────────────────────────────────────────────────────────

function AIGamePage({ onBack }: { onBack: () => void }): JSX.Element {
  const gameRef = useRef<Game>(new Game());
  const [gameRefTrigger, setGameRefTrigger] = useState(0);
  const game = gameRef.current;
  const [playerColor] = useState<Color>(Color.WHITE);
  const [aiThinking, setAiThinking] = useState(false);

  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [legalMoves, setLegalMoves] = useState<Position[]>([]);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [evalScore, setEvalScore] = useState<number | null>(null);

  const forceUpdate = useCallback(() => {
    setGameRefTrigger((n) => n + 1);
  }, []);

  const aiThink = useCallback(() => {
    const aiColor = opponentColor(playerColor);
    if (game.state.turn !== aiColor || game.state.status !== GameStatus.IN_PROGRESS) return;

    setAiThinking(true);

    // Use cloud AI when deployed (non-localhost API), fallback to in-browser search.
    const useCloudAI = !API_BASE.includes('localhost');

    if (useCloudAI) {
      const fen = FEN.encode(game.state);
      const controller = new AbortController();
      const fetchTimeoutId = setTimeout(() => controller.abort(), 15_000);

      fetch(`${API_BASE}/api/v1/ai/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fen, difficulty: AI_DIFFICULTY }),
        signal: controller.signal,
      })
        .then((res) => res.json())
        .then((data: { from: string; to: string; notation: string; score: number; error?: string }) => {
          clearTimeout(fetchTimeoutId);
          if (data.error !== undefined) {
            console.warn('[AI Cloud] Server error:', data.error);
            setAiThinking(false);
            return;
          }
          // Parse position keys like 'c0r6' into Position objects.
          const fromMatch = data.from.match(/c(\d+)r(\d+)/);
          const toMatch = data.to.match(/c(\d+)r(\d+)/);
          if (fromMatch === null || toMatch === null) {
            console.warn('[AI Cloud] Invalid position format:', data.from, data.to);
            setAiThinking(false);
            return;
          }
          const from: Position = { col: parseInt(fromMatch[1], 10), row: parseInt(fromMatch[2], 10) };
          const to: Position = { col: parseInt(toMatch[1], 10), row: parseInt(toMatch[2], 10) };

          const moveResult = game.makeMove(from, to);
          if (moveResult.success) {
            const hist = game.state.moveHistory;
            setLastMove(hist.length > 0 ? hist[hist.length - 1] : null);
            setEvalScore(data.score);
            forceUpdate();
          }
          setAiThinking(false);
        })
        .catch((err: unknown) => {
          clearTimeout(fetchTimeoutId);
          console.warn('[AI Cloud] Fetch failed, falling back to local search:', err);
          // Fallback to in-browser alpha-beta search.
          const result = search(game, aiColor, AI_DIFFICULTY);
          if (result.bestMove !== null) {
            const moveResult = game.makeMove(result.bestMove.from, result.bestMove.to);
            if (moveResult.success) {
              const hist = game.state.moveHistory;
              setLastMove(hist.length > 0 ? hist[hist.length - 1] : null);
              setEvalScore(result.score);
              forceUpdate();
            }
          }
          setAiThinking(false);
        });

      return () => {
        controller.abort();
        clearTimeout(fetchTimeoutId);
      };
    }

    // Local in-browser alpha-beta search.
    const timer = setTimeout(() => {
      const result = search(game, aiColor, AI_DIFFICULTY);
      if (result.bestMove !== null) {
        const moveResult = game.makeMove(result.bestMove.from, result.bestMove.to);
        if (moveResult.success) {
          const hist = game.state.moveHistory;
          setLastMove(hist.length > 0 ? hist[hist.length - 1] : null);
          setEvalScore(result.score);
          forceUpdate();
        }
      }
      setAiThinking(false);
    }, AI_THINK_MS);

    return () => clearTimeout(timer);
  }, [game, playerColor, forceUpdate]);

  // Trigger AI move when it's AI's turn
  useEffect(() => {
    if (game.state.turn !== playerColor && game.state.status === GameStatus.IN_PROGRESS) {
      const cleanup = aiThink();
      return cleanup;
    }
    return undefined;
  }, [game.state.turn, game.state.status, playerColor, aiThink]);

  const handleSquareClick = useCallback(
    (col: number, row: number) => {
      if (game.state.turn !== playerColor || game.state.status !== GameStatus.IN_PROGRESS) return;
      if (aiThinking) return;

      const piece = game.state.board[row][col];
      if (selectedPos !== null) {
        if (selectedPos.col === col && selectedPos.row === row) {
          setSelectedPos(null);
          setLegalMoves([]);
          return;
        }
        if (piece !== null && piece.color === playerColor) {
          setSelectedPos({ col, row });
          setLegalMoves(game.getLegalMoves({ col, row }));
          return;
        }
        const result = game.makeMove(selectedPos, { col, row });
        if (result.success) {
          const hist = game.state.moveHistory;
          setLastMove(hist.length > 0 ? hist[hist.length - 1] : null);
          setSelectedPos(null);
          setLegalMoves([]);
          const score = evalScore;
          setEvalScore(score);
          forceUpdate();
        } else {
          setSelectedPos(null);
          setLegalMoves([]);
        }
        return;
      }
      if (piece !== null && piece.color === playerColor) {
        setSelectedPos({ col, row });
        setLegalMoves(game.getLegalMoves({ col, row }));
      }
    },
    [game, playerColor, selectedPos, aiThinking, evalScore, forceUpdate],
  );

  const handleNewGame = useCallback(() => {
    game.reset();
    setSelectedPos(null);
    setLegalMoves([]);
    setLastMove(null);
    setEvalScore(null);
    forceUpdate();
  }, [game, forceUpdate]);

  const lockedPositions = useMemo(() => {
    const locked = getLockedPieces(game.state.board, game.state.turn);
    return new Set(locked.map((p) => posToString(p.pos)));
  }, [game.state.board, game.state.turn, gameRefTrigger]);

  const isOver = game.state.status !== GameStatus.IN_PROGRESS;
  const turnLabel = game.state.turn === Color.WHITE ? '你的回合' : 'AI 思考中...';
  const turnColor = game.state.turn === Color.WHITE ? '#FFF8DC' : '#1A1A1A';

  return (
    <ThreeColumnLayout
      onBack={onBack}
      topSection={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', maxWidth: 460 }}>
          <Box
            sx={{
              color: '#ccc',
              fontWeight: 600,
              fontSize: '0.875rem',
              lineHeight: 1.43,
              display: 'flex',
              alignItems: 'center',
              gap: 0.8,
            }}
          >
            <Box
              sx={{
                width: 14,
                height: 14,
                borderRadius: '50%',
                bgcolor: turnColor,
                border: '1.5px solid',
                borderColor: game.state.turn === Color.WHITE ? '#8B7355' : '#666',
                boxShadow: isOver ? 'none' : '0 0 8px rgba(255,215,0,0.5)',
              }}
            />
            {isOver ? '游戏结束' : turnLabel}
          </Box>
          {aiThinking && <LinearProgress sx={{ flex: 1, height: 3, borderRadius: 1, bgcolor: '#333' }} />}
          {evalScore !== null && !isOver && (
            <Chip
              label={`${evalScore > 0 ? '+' : ''}${evalScore}`}
              size="small"
              sx={{
                fontSize: '0.65rem',
                height: 20,
                bgcolor: evalScore > 0 ? 'rgba(229,62,62,0.2)' : 'rgba(76,175,80,0.2)',
                color: evalScore > 0 ? '#e53e3e' : '#4caf50',
              }}
            />
          )}
        </Box>
      }
      boardSection={
        <Board
          board={game.state.board}
          selectedPos={selectedPos}
          legalMoves={legalMoves}
          lastMove={lastMove}
          onSquareClick={handleSquareClick}
          flipped={playerColor === Color.BLACK}
          currentTurn={game.state.turn}
          lockedPositions={lockedPositions}
          coreCooldown={game.state.coreCooldown}
        />
      }
      bottomSection={
        <Box sx={{ width: '100%', maxWidth: 460 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            {isOver && (
              <Button
                variant="contained"
                size="small"
                startIcon={<RefreshIcon />}
                onClick={handleNewGame}
                sx={{ bgcolor: '#629924', fontSize: '0.7rem', '&:hover': { bgcolor: '#7ab528' } }}
              >
                再来一局
              </Button>
            )}
          </Stack>
          <MoveHistoryPanel moves={game.state.moveHistory} fullMoveNumber={game.state.fullMoveNumber} />
        </Box>
      }
      rightSection={
        <>
          <ControlZoneStats game={game} />
          <Paper
            variant="outlined"
            sx={{ p: 1.5, bgcolor: '#1e1e1e', borderColor: '#333', borderRadius: 1 }}
          >
            <Typography variant="caption" color="#888" sx={{ mb: 0.5, display: 'block' }}>
              AI 信息
            </Typography>
            <Typography variant="caption" color="#aaa" fontSize="0.65rem">
              难度: {AI_DIFFICULTY === 'beginner' ? '初级' : AI_DIFFICULTY === 'intermediate' ? '中级' : '高级'}
            </Typography>
            <br />
            <Typography variant="caption" color="#aaa" fontSize="0.65rem">
              搜索深度: {AI_DIFFICULTY === 'beginner' ? '2' : AI_DIFFICULTY === 'intermediate' ? '3' : '4'}
            </Typography>
            <br />
            <Typography variant="caption" color="#aaa" fontSize="0.65rem">
              引擎: Alpha-Beta
            </Typography>
          </Paper>
          <HotkeysPanel />
        </>
      }
    />
  );
}

// ─── Online Game Page ─────────────────────────────────────────────────────────

function OnlineGamePage({ onBack }: { onBack: () => void }): JSX.Element {
  const wsClientRef = useRef<WSClient | null>(null);
  const roomClientRef = useRef<RoomClient | null>(null);
  const gameRef = useRef<Game>(new Game());
  const { token, user } = useAuth();

  const [gameStarted, setGameStarted] = useState(false);
  const [playerColor, setPlayerColor] = useState<Color | null>(null);
  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [legalMoves, setLegalMoves] = useState<Position[]>([]);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [isInQueue, setIsInQueue] = useState(false);
  const [queueTime, setQueueTime] = useState(0);
  const [roomState, setRoomState] = useState<RoomInfo | null>(null);
  const [showRoomPanel, setShowRoomPanel] = useState(true);
  const [chatMessages, setChatMessages] = useState<Array<{ from: string; text: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [, setTick] = useState(0);
  const queueTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const forceUpdate = useCallback(() => setTick((n) => n + 1), []);

  // Connect on mount
  useEffect(() => {
    const ws = new WSClient();
    const rc = new RoomClient(ws);
    wsClientRef.current = ws;
    roomClientRef.current = rc;

    ws.onStateChange = (state) => {
      if (state !== 'connected') setIsInQueue(false);
      if (state === 'connected' && token !== null) {
        ws.authenticate(token);
      }
    };

    rc.onMatchFound = () => {
      setIsInQueue(false);
      if (queueTimerRef.current !== null) {
        clearInterval(queueTimerRef.current);
        queueTimerRef.current = null;
      }
    };

    rc.onGameStart = (payload) => {
      // Sync our gameRef with RoomClient's game (which was set from FEN)
      gameRef.current = rc.getGame();
      setGameStarted(true);
      setShowRoomPanel(false);
      setPlayerColor(payload.color === 'white' ? Color.WHITE : Color.BLACK);
      forceUpdate();
    };

    rc.onMoveMade = () => {
      // Sync gameRef with RoomClient's game (which received FEN update)
      gameRef.current = rc.getGame();
      const hist = gameRef.current.state.moveHistory;
      setLastMove(hist.length > 0 ? hist[hist.length - 1] : null);
      forceUpdate();
    };

    rc.onGameOver = () => {
      forceUpdate();
    };

    rc.onError = (code, message) => {
      console.error(`[Online] ${code}: ${message}`);
    };

    ws.connect(WS_URL);

    return () => {
      if (queueTimerRef.current !== null) clearInterval(queueTimerRef.current);
      ws.disconnect();
    };
  }, []);

  useEffect(() => {
    const ws = wsClientRef.current;
    if (ws !== null && ws.isConnected() && token !== null) {
      ws.authenticate(token);
    }
  }, [token]);

  const handleJoinQueue = useCallback(() => {
    roomClientRef.current?.joinQueue(user?.elo);
    setIsInQueue(true);
    setQueueTime(0);
    queueTimerRef.current = setInterval(() => setQueueTime((t) => t + 1), 1000);
  }, [user?.elo]);

  const handleLeaveQueue = useCallback(() => {
    roomClientRef.current?.leaveQueue();
    setIsInQueue(false);
    if (queueTimerRef.current !== null) {
      clearInterval(queueTimerRef.current);
      queueTimerRef.current = null;
    }
  }, []);

  const handleCreateRoom = useCallback(() => {
    roomClientRef.current?.createRoom();
    setRoomState({
      roomId: '等待中...',
      opponentName: '等待对手加入',
      opponentElo: 0,
      opponentConnected: false,
      spectators: [],
    });
  }, []);

  const handleJoinRoom = useCallback((roomId: string) => {
    roomClientRef.current?.joinRoom(roomId);
    setRoomState({
      roomId,
      opponentName: '连接中...',
      opponentElo: 0,
      opponentConnected: false,
      spectators: [],
    });
  }, []);

  const handleLeaveRoom = useCallback(() => {
    setRoomState(null);
    setGameStarted(false);
    setShowRoomPanel(true);
    gameRef.current.reset();
  }, []);

  const handleSquareClick = useCallback(
    (col: number, row: number) => {
      if (!gameStarted) return;
      const game = gameRef.current;
      const isMyTurn =
        (playerColor === Color.WHITE && game.state.turn === Color.WHITE) ||
        (playerColor === Color.BLACK && game.state.turn === Color.BLACK);
      if (!isMyTurn) return;

      const piece = game.state.board[row][col];
      if (selectedPos !== null) {
        if (selectedPos.col === col && selectedPos.row === row) {
          setSelectedPos(null);
          setLegalMoves([]);
          return;
        }
        if (piece !== null && piece.color === game.state.turn) {
          setSelectedPos({ col, row });
          setLegalMoves(game.getLegalMoves({ col, row }));
          return;
        }
        const result = roomClientRef.current?.makeMove(selectedPos, { col, row });
        if (result?.success) {
          // Sync gameRef with RoomClient's updated game and set lastMove immediately
          const rc = roomClientRef.current;
          if (rc !== null) {
            gameRef.current = rc.getGame();
            const hist = gameRef.current.state.moveHistory;
            setLastMove(hist.length > 0 ? hist[hist.length - 1] : null);
          }
          setSelectedPos(null);
          setLegalMoves([]);
          forceUpdate();
        } else {
          setSelectedPos(null);
          setLegalMoves([]);
        }
        return;
      }
      if (piece !== null && piece.color === game.state.turn) {
        setSelectedPos({ col, row });
        setLegalMoves(game.getLegalMoves({ col, row }));
      }
    },
    [gameStarted, playerColor, selectedPos, forceUpdate],
  );

  const handleResign = useCallback(() => {
    roomClientRef.current?.resign();
  }, []);

  const handleDraw = useCallback(() => {
    roomClientRef.current?.offerDraw();
  }, []);

  const handleSendChat = useCallback(() => {
    if (chatInput.trim().length === 0) return;
    roomClientRef.current?.sendChat(chatInput.trim());
    setChatMessages((prev) => [...prev, { from: '我', text: chatInput.trim() }]);
    setChatInput('');
  }, [chatInput]);

  if (!gameStarted && showRoomPanel) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 500, mx: 'auto', mt: 2 }}>
        <Button size="small" onClick={onBack} sx={{ color: '#999', alignSelf: 'flex-start' }}>
          ← 返回
        </Button>
        <QueuePanel
          roomClient={roomClientRef.current}
          isInQueue={isInQueue}
          queueTime={queueTime}
          onJoinQueue={handleJoinQueue}
          onLeaveQueue={handleLeaveQueue}
        />
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="caption" color="#555">— 或 —</Typography>
        </Box>
        <RoomPanel
          roomClient={roomClientRef.current}
          roomState={roomState}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          onLeaveRoom={handleLeaveRoom}
        />
      </Box>
    );
  }

  const isOver = gameRef.current.state.status !== GameStatus.IN_PROGRESS;
  const userBadgeType: BadgeType = user?.is_admin
    ? 'admin'
    : (user?.badge_type as BadgeType) || '';

  return (
    <ThreeColumnLayout
      onBack={onBack}
      topSection={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', maxWidth: 460 }}>
          <Chip
            label={playerColor === Color.WHITE ? '白方 (你)' : '黑方 (你)'}
            size="small"
            sx={{ fontSize: '0.65rem', height: 20, bgcolor: 'rgba(98,153,36,0.15)', color: '#629924' }}
          />
          {userBadgeType !== '' && (
            <BadgeChip badgeType={userBadgeType} badgeText={user?.badge_text} size="small" />
          )}
          <Typography variant="caption" color="#888">
            vs 对手
          </Typography>
        </Box>
      }
      boardSection={
        <Board
          board={gameRef.current.state.board}
          selectedPos={selectedPos}
          legalMoves={legalMoves}
          lastMove={lastMove}
          onSquareClick={handleSquareClick}
          flipped={playerColor === Color.BLACK}
          currentTurn={gameRef.current.state.turn}
          coreCooldown={gameRef.current.state.coreCooldown}
        />
      }
      bottomSection={
        <Box sx={{ width: '100%', maxWidth: 460 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
            <Button
              variant="outlined" size="small" color="error"
              startIcon={<FlagIcon />} onClick={handleResign} disabled={isOver}
              sx={{ borderColor: '#555', color: '#e53e3e', fontSize: '0.7rem' }}
            >
              认输
            </Button>
            <Button
              variant="outlined" size="small"
              startIcon={<HandshakeIcon />} onClick={handleDraw} disabled={isOver}
              sx={{ borderColor: '#555', color: '#aaa', fontSize: '0.7rem' }}
            >
              提和
            </Button>
          </Stack>
          <MoveHistoryPanel moves={gameRef.current.state.moveHistory} fullMoveNumber={gameRef.current.state.fullMoveNumber} />
        </Box>
      }
      rightSection={
        <>
          <ControlZoneStats game={gameRef.current} />
          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: '#1e1e1e', borderColor: '#333', borderRadius: 1 }}>
            <Typography variant="caption" color="#888" sx={{ mb: 0.5, display: 'block' }}>
              聊天
            </Typography>
            <Box sx={{ maxHeight: 120, overflowY: 'auto', mb: 1 }}>
              {chatMessages.map((msg, i) => (
                <Typography key={i} variant="caption" color="#aaa" fontSize="0.65rem" display="block">
                  <b>{msg.from}:</b> {msg.text}
                </Typography>
              ))}
            </Box>
            <Stack direction="row" spacing={0.5}>
              <TextField
                size="small"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSendChat(); }}
                placeholder="输入消息..."
                sx={{
                  '& .MuiInputBase-root': { fontSize: '0.7rem', color: '#ccc', bgcolor: '#2a2a2a' },
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#444' },
                }}
              />
              <IconButton size="small" onClick={handleSendChat} sx={{ color: '#629924' }}>
                <SendIcon fontSize="small" />
              </IconButton>
            </Stack>
          </Paper>
          <HotkeysPanel />
        </>
      }
    />
  );
}

// ─── Spectate Game Page ───────────────────────────────────────────────────────

function SpectateGamePage({ onBack, roomId }: { onBack: () => void; roomId: string }): JSX.Element {
  const wsClientRef = useRef<WSClient | null>(null);
  const roomClientRef = useRef<RoomClient | null>(null);
  const gameRef = useRef<Game>(new Game());
  const [spectatorCount, setSpectatorCount] = useState(1);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [, setTick] = useState(0);

  const forceUpdate = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const ws = new WSClient();
    const rc = new RoomClient(ws);
    wsClientRef.current = ws;
    roomClientRef.current = rc;

    rc.onGameStart = () => {
      gameRef.current = rc.getGame();
      forceUpdate();
    };

    // Spectators receive 'spectate_update' events, not 'move_made'.
    rc.onSpectateUpdate = () => {
      // RoomClient's spectate_update handler already updated this.game.state
      // via FEN.decode. Sync our ref and trigger re-render.
      gameRef.current = rc.getGame();
      const hist = gameRef.current.state.moveHistory;
      setLastMove(hist.length > 0 ? hist[hist.length - 1] : null);
      forceUpdate();
    };

    rc.onGameOver = () => {
      forceUpdate();
    };

    rc.onError = (code, message) => {
      console.error(`[Spectate] ${code}: ${message}`);
    };

    ws.connect(WS_URL);

    // Wait for connection then spectate
    const checkInterval = setInterval(() => {
      if (ws.isConnected()) {
        clearInterval(checkInterval);
        if (roomId) {
          rc.spectateRoom(roomId);
        }
      }
    }, 500);

    return () => {
      clearInterval(checkInterval);
      ws.disconnect();
    };
  }, [roomId, forceUpdate]);

  const isOver = gameRef.current.state.status !== GameStatus.IN_PROGRESS;

  return (
    <ThreeColumnLayout
      onBack={onBack}
      topSection={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, width: '100%', maxWidth: 460 }}>
          <Typography variant="body2" color="#ccc" fontWeight={600}>
            📡 观战中 · 房间 {roomId || '...'}
          </Typography>
          <Chip
            label={`👁 ${spectatorCount}`}
            size="small"
            sx={{ fontSize: '0.65rem', height: 20, bgcolor: 'rgba(98,153,36,0.15)', color: '#629924' }}
          />
        </Box>
      }
      boardSection={
        <Board
          board={gameRef.current.state.board}
          selectedPos={null}
          legalMoves={[]}
          lastMove={lastMove}
          onSquareClick={() => {}}
          currentTurn={gameRef.current.state.turn}
          coreCooldown={gameRef.current.state.coreCooldown}
        />
      }
      bottomSection={
        <Box sx={{ width: '100%', maxWidth: 460 }}>
          <MoveHistoryPanel moves={gameRef.current.state.moveHistory} fullMoveNumber={gameRef.current.state.fullMoveNumber} />
        </Box>
      }
      rightSection={
        <>
          <ControlZoneStats game={gameRef.current} />
          <Paper variant="outlined" sx={{ p: 1.5, bgcolor: '#1e1e1e', borderColor: '#333', borderRadius: 1 }}>
            <Typography variant="caption" color="#888" sx={{ mb: 0.5, display: 'block' }}>
              观战信息
            </Typography>
            <Typography variant="caption" color="#aaa" fontSize="0.65rem">
              只读模式 — 观战中
            </Typography>
            <br />
            <Typography variant="caption" color="#aaa" fontSize="0.65rem">
              观众数: {spectatorCount}
            </Typography>
          </Paper>
        </>
      }
    />
  );
}
