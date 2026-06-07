import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Stack,
  Tabs,
  Tab,
} from '@mui/material';
import {
  Visibility as WatchIcon,
  VisibilityOff as NoWatchIcon,
  Groups as GroupsIcon,
  FiberManualRecord as LiveIcon,
} from '@mui/icons-material';
import { WSClient } from '../network/Client';
import { RoomClient } from '../network/RoomClient';
import GamePage from './GamePage';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActiveGame {
  id: string;
  whiteName: string;
  whiteElo: number;
  blackName: string;
  blackElo: number;
  moveCount: number;
  spectatorCount: number;
  createdAt: number;
}

interface SpectatePanelProps {
  onBack: () => void;
}

// ─── Active games are fetched from the server via WebSocket ───────────────────

// ─── Component ────────────────────────────────────────────────────────────────

export default function SpectatePanel({ onBack }: SpectatePanelProps): JSX.Element {
  const [games, setGames] = useState<ActiveGame[]>([]);
  const [watchingId, setWatchingId] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  const handleWatch = useCallback((gameId: string) => {
    setWatchingId(gameId);
  }, []);

  const handleStopWatching = useCallback(() => {
    setWatchingId(null);
  }, []);

  // If watching a game, show the game page in spectate mode
  if (watchingId !== null) {
    return (
      <Box>
        <Button
          size="small"
          onClick={handleStopWatching}
          sx={{ color: '#999', mb: 1, fontSize: '0.75rem' }}
        >
          ← 离开观战
        </Button>
        <GamePage mode="spectate" onBack={handleStopWatching} spectateRoomId={watchingId} />
      </Box>
    );
  }

  const filteredGames = tab === 0
    ? games
    : games.filter((g) => g.spectatorCount > 0);

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', width: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5" fontWeight={600} sx={{ color: '#ccc' }}>
          观战
        </Typography>
        <Stack direction="row" alignItems="center" spacing={1}>
          <LiveIcon sx={{ color: '#e53e3e', fontSize: 12 }} />
          <Typography variant="caption" color="#888">
            {games.length} 场活跃对局
          </Typography>
        </Stack>
      </Stack>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_e, v) => setTab(v)}
        sx={{
          mb: 2,
          minHeight: 36,
          '& .MuiTab-root': {
            minHeight: 36,
            fontSize: '0.75rem',
            color: '#888',
            textTransform: 'none',
            py: 0.5,
          },
          '& .Mui-selected': { color: '#629924' },
          '& .MuiTabs-indicator': { bgcolor: '#629924' },
        }}
      >
        <Tab label={`全部 (${games.length})`} />
        <Tab label={`热门 (${games.filter((g) => g.spectatorCount > 0).length})`} />
      </Tabs>

      {filteredGames.length === 0 && (
        <Paper
          variant="outlined"
          sx={{ p: 4, textAlign: 'center', bgcolor: '#1e1e1e', borderColor: '#333', borderRadius: 1 }}
        >
          <Typography variant="body1" color="#666">
            暂无活跃对局，快去开始一局对战吧！
          </Typography>
        </Paper>
      )}

      {/* Games Table */}
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ bgcolor: '#1e1e1e', borderColor: '#333', borderRadius: 1 }}
      >
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { borderBottom: '1px solid #333', color: '#888', fontSize: '0.7rem' } }}>
              <TableCell>对局</TableCell>
              <TableCell align="right">评分</TableCell>
              <TableCell align="center">回合</TableCell>
              <TableCell align="center">观众</TableCell>
              <TableCell align="center">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredGames.map((game) => (
              <TableRow
                key={game.id}
                hover
                sx={{
                  '& td': { borderBottom: '1px solid #2a2a2a', color: '#aaa', fontSize: '0.75rem' },
                  '&:nth-of-type(even)': { bgcolor: 'rgba(255,255,255,0.015)' },
                  '&:hover': { bgcolor: 'rgba(98,153,36,0.06)' },
                }}
              >
                <TableCell>
                  <Stack direction="row" spacing={0.8} alignItems="center">
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: '#FFF8DC',
                        border: '1px solid #8B7355',
                      }}
                    />
                    <Typography variant="body2" color="#ccc" fontSize="0.8rem">
                      {game.whiteName}
                    </Typography>
                    <Typography variant="caption" color="#666">
                      vs
                    </Typography>
                    <Box
                      sx={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        bgcolor: '#1A1A1A',
                        border: '1px solid #444',
                      }}
                    />
                    <Typography variant="body2" color="#aaa" fontSize="0.8rem">
                      {game.blackName}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  <Typography variant="caption" color="#888" fontSize="0.7rem">
                    {game.whiteElo} / {game.blackElo}
                  </Typography>
                </TableCell>
                <TableCell align="center">
                  <Chip
                    label={`${game.moveCount}`}
                    size="small"
                    sx={{ fontSize: '0.6rem', height: 18, bgcolor: 'transparent', color: '#aaa' }}
                  />
                </TableCell>
                <TableCell align="center">
                  <Stack direction="row" spacing={0.3} alignItems="center" justifyContent="center">
                    <GroupsIcon sx={{ fontSize: 12, color: game.spectatorCount > 0 ? '#629924' : '#555' }} />
                    <Typography
                      variant="caption"
                      color={game.spectatorCount > 0 ? '#629924' : '#555'}
                      fontSize="0.7rem"
                    >
                      {game.spectatorCount}
                    </Typography>
                  </Stack>
                </TableCell>
                <TableCell align="center">
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<WatchIcon sx={{ fontSize: 14 }} />}
                    onClick={() => handleWatch(game.id)}
                    sx={{
                      fontSize: '0.65rem',
                      py: 0.2,
                      px: 1,
                      minWidth: 0,
                      borderColor: '#555',
                      color: '#aaa',
                      '&:hover': { borderColor: '#629924', color: '#629924' },
                    }}
                  >
                    观看
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Typography variant="caption" color="#444" textAlign="center" display="block" sx={{ mt: 2 }}>
        高分段和热门对局优先显示
      </Typography>
    </Box>
  );
}
