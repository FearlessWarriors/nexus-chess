import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Chip,
  TextField,
  Stack,
  Collapse,
  IconButton,
  InputAdornment,
} from '@mui/material';
import {
  EmojiEvents as TrophyIcon,
  KeyboardArrowDown as ExpandIcon,
  KeyboardArrowUp as CollapseIcon,
  Search as SearchIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { LeaderboardManager } from '../tournament/LeaderboardManager';
import type { LeaderboardEntry, LeaderboardSortBy, PlayerEntry } from '../tournament/types';
import BadgeChip, { type BadgeType } from './BadgeChip';
import { API_BASE } from '../config';

// ─── Props ────────────────────────────────────────────────────────────────────

interface LeaderboardPanelProps {
  onBack: () => void;
}

// ─── Sort Config ──────────────────────────────────────────────────────────────

type SortField = 'rank' | 'name' | 'elo' | 'totalGames' | 'winRate';
type SortDir = 'asc' | 'desc';

// ─── Server Leaderboard Entry ─────────────────────────────────────────────────

interface ServerLeaderboardEntry {
  rank: number;
  id: string;
  name: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  totalGames: number;
  winRate: number;
  badge_text: string;
  badge_type: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function LeaderboardPanel({ onBack }: LeaderboardPanelProps): JSX.Element {
  const [sortField, setSortField] = useState<SortField>('elo');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [serverEntries, setServerEntries] = useState<Map<string, ServerLeaderboardEntry>>(new Map());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchLeaderboard = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/leaderboard?limit=500`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.entries !== undefined) {
        const map = new Map<string, ServerLeaderboardEntry>();
        for (const entry of data.entries as ServerLeaderboardEntry[]) {
          map.set(entry.id, entry);
        }
        setServerEntries(map);

        // Sync ELO/name into local LeaderboardManager
        for (const entry of data.entries as ServerLeaderboardEntry[]) {
          LeaderboardManager.updateFromServer(entry.id, entry.name, entry.elo);
        }
        setLastUpdated(new Date());
      }
    } catch {
      // Server not available
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Poll server for live updates
  useEffect(() => {
    fetchLeaderboard();
    const timer = setInterval(fetchLeaderboard, 10000); // 10s
    return () => clearInterval(timer);
  }, [fetchLeaderboard]);

  const entries = useMemo((): LeaderboardEntry[] => {
    LeaderboardManager.load();
    if (search.trim().length > 0) {
      const players = LeaderboardManager.searchPlayers(search.trim());
      return players.map((p, idx): LeaderboardEntry => {
        const serverEntry = serverEntries.get(p.id);
        return {
          rank: idx + 1,
          id: p.id,
          name: p.name,
          elo: p.elo,
          wins: p.wins,
          losses: p.losses,
          draws: p.draws,
          winRate: p.totalGames > 0 ? p.wins / p.totalGames : 0,
          totalGames: p.totalGames,
          badge_type: serverEntry?.badge_type ?? '',
          badge_text: serverEntry?.badge_text ?? '',
        };
      });
    }
    const localEntries = LeaderboardManager.getLeaderboard(
      sortField === 'elo' ? 'elo' : sortField === 'winRate' ? 'winRate' : 'totalGames',
      50,
    );
    return localEntries.map((entry): LeaderboardEntry => {
      const serverEntry = serverEntries.get(entry.id);
      return {
        ...entry,
        badge_type: serverEntry?.badge_type ?? '',
        badge_text: serverEntry?.badge_text ?? '',
      };
    });
  }, [search, sortField, serverEntries]);

  // Sort entries
  const sortedEntries = useMemo(() => {
    const arr = [...entries];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'rank': cmp = a.rank - b.rank; break;
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'elo': cmp = a.elo - b.elo; break;
        case 'totalGames': cmp = a.totalGames - b.totalGames; break;
        case 'winRate': cmp = a.winRate - b.winRate; break;
        default: cmp = b.elo - a.elo;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [entries, sortField, sortDir]);

  const handleSort = (field: SortField): void => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const toggleExpand = (id: string): void => {
    setExpandedId(expandedId === id ? null : id);
  };

  // Rank display
  const rankDisplay = (rank: number): { label: string; bg: string; color: string } => {
    if (rank === 1) return { label: '🥇 1', bg: 'rgba(255,215,0,0.12)', color: '#FFD700' };
    if (rank === 2) return { label: '🥈 2', bg: 'rgba(192,192,192,0.1)', color: '#C0C0C0' };
    if (rank === 3) return { label: '🥉 3', bg: 'rgba(205,127,50,0.1)', color: '#CD7F32' };
    return { label: `${rank}`, bg: 'transparent', color: '#888' };
  };

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', width: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5" fontWeight={600} sx={{ color: '#ccc' }}>
          🏆 排行榜
        </Typography>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="caption" color="#666">
            {lastUpdated
              ? `更新于 ${lastUpdated.toLocaleTimeString()}`
              : '加载中...'}
          </Typography>
          <IconButton
            size="small"
            onClick={fetchLeaderboard}
            disabled={isRefreshing}
            sx={{ color: '#888' }}
          >
            <RefreshIcon sx={{ fontSize: 18, opacity: isRefreshing ? 0.4 : 1 }} />
          </IconButton>
        </Stack>
      </Stack>

      {/* Controls */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        mb={2}
        alignItems="center"
      >
        <TextField
          size="small"
          placeholder="搜索玩家..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: '#666' }} />
              </InputAdornment>
            ),
          }}
          sx={{
            minWidth: 200,
            '& .MuiInputBase-root': { fontSize: '0.8rem', color: '#ccc', bgcolor: '#1e1e1e' },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: '#444' },
          }}
        />
      </Stack>

      {sortedEntries.length === 0 && (
        <Paper
          variant="outlined"
          sx={{ p: 4, textAlign: 'center', bgcolor: '#1e1e1e', borderColor: '#333', borderRadius: 1 }}
        >
          <Typography variant="body1" color="#666">
            {search.trim().length > 0 ? '未找到匹配的玩家' : '暂无排行榜数据，快去对战吧！'}
          </Typography>
        </Paper>
      )}

      {/* Leaderboard Table */}
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ bgcolor: '#1e1e1e', borderColor: '#333', borderRadius: 1 }}
      >
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { borderBottom: '1px solid #333', color: '#888', fontSize: '0.7rem' } }}>
              <TableCell sx={{ width: 48 }}>
                <TableSortLabel
                  active={sortField === 'rank'}
                  direction={sortField === 'rank' ? sortDir : 'desc'}
                  onClick={() => handleSort('rank')}
                  sx={{
                    fontSize: '0.7rem',
                    '&.Mui-active': { color: '#629924' },
                    '& .MuiTableSortLabel-icon': { fontSize: 14 },
                  }}
                >
                  排名
                </TableSortLabel>
              </TableCell>
              <TableCell>
                <TableSortLabel
                  active={sortField === 'name'}
                  direction={sortField === 'name' ? sortDir : 'asc'}
                  onClick={() => handleSort('name')}
                  sx={{
                    fontSize: '0.7rem',
                    '&.Mui-active': { color: '#629924' },
                    '& .MuiTableSortLabel-icon': { fontSize: 14 },
                  }}
                >
                  玩家
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortField === 'elo'}
                  direction={sortField === 'elo' ? sortDir : 'desc'}
                  onClick={() => handleSort('elo')}
                  sx={{
                    fontSize: '0.7rem',
                    '&.Mui-active': { color: '#629924' },
                    '& .MuiTableSortLabel-icon': { fontSize: 14 },
                  }}
                >
                  评分
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortField === 'totalGames'}
                  direction={sortField === 'totalGames' ? sortDir : 'desc'}
                  onClick={() => handleSort('totalGames')}
                  sx={{
                    fontSize: '0.7rem',
                    '&.Mui-active': { color: '#629924' },
                    '& .MuiTableSortLabel-icon': { fontSize: 14 },
                  }}
                >
                  总局数
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">
                <TableSortLabel
                  active={sortField === 'winRate'}
                  direction={sortField === 'winRate' ? sortDir : 'desc'}
                  onClick={() => handleSort('winRate')}
                  sx={{
                    fontSize: '0.7rem',
                    '&.Mui-active': { color: '#629924' },
                    '& .MuiTableSortLabel-icon': { fontSize: 14 },
                  }}
                >
                  胜率
                </TableSortLabel>
              </TableCell>
              <TableCell align="right">最近对局</TableCell>
              <TableCell sx={{ width: 40 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedEntries.map((entry) => {
              const rankInfo = rankDisplay(entry.rank);
              const isExpanded = expandedId === entry.id;
              const badgeType = (entry.badge_type as BadgeType) || '';
              return (
                <React.Fragment key={entry.id}>
                  <TableRow
                    hover
                    onClick={() => toggleExpand(entry.id)}
                    sx={{
                      cursor: 'pointer',
                      '& td': { borderBottom: '1px solid #2a2a2a', fontSize: '0.75rem' },
                      bgcolor: rankInfo.bg !== 'transparent' ? rankInfo.bg : undefined,
                      '&:hover': { bgcolor: 'rgba(98,153,36,0.06) !important' },
                    }}
                  >
                    <TableCell sx={{ color: rankInfo.color, fontWeight: entry.rank <= 3 ? 700 : 400 }}>
                      {rankInfo.label}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" alignItems="center" spacing={0.8}>
                        <Typography
                          variant="body2"
                          fontWeight={entry.rank <= 3 ? 600 : 400}
                          color={entry.rank <= 3 ? '#ccc' : '#aaa'}
                          fontSize="0.78rem"
                        >
                          {entry.name}
                        </Typography>
                        {badgeType !== '' && (
                          <BadgeChip
                            badgeType={badgeType}
                            badgeText={entry.badge_text}
                            size="small"
                          />
                        )}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Chip
                        label={entry.elo}
                        size="small"
                        sx={{
                          fontSize: '0.65rem',
                          height: 20,
                          bgcolor: 'rgba(98,153,36,0.1)',
                          color: '#629924',
                          fontWeight: 600,
                        }}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ color: '#aaa' }}>{entry.totalGames}</TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="caption"
                        color={entry.winRate >= 0.5 ? '#4caf50' : entry.winRate >= 0.3 ? '#ff9800' : '#e53e3e'}
                        fontSize="0.7rem"
                        fontWeight={600}
                      >
                        {(entry.winRate * 100).toFixed(1)}%
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Stack direction="row" spacing={0.3} justifyContent="flex-end">
                        <Typography variant="caption" color="#4caf50" fontSize="0.65rem">
                          {entry.wins}W
                        </Typography>
                        <Typography variant="caption" color="#e53e3e" fontSize="0.65rem">
                          {entry.losses}L
                        </Typography>
                        <Typography variant="caption" color="#888" fontSize="0.65rem">
                          {entry.draws}D
                        </Typography>
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <IconButton size="small">
                        {isExpanded ? <CollapseIcon sx={{ fontSize: 16, color: '#666' }} /> : <ExpandIcon sx={{ fontSize: 16, color: '#666' }} />}
                      </IconButton>
                    </TableCell>
                  </TableRow>

                  {/* Expanded detail row */}
                  <TableRow>
                    <TableCell colSpan={7} sx={{ p: 0, borderBottom: isExpanded ? '1px solid #2a2a2a' : 'none' }}>
                      <Collapse in={isExpanded}>
                        <PlayerDetail id={entry.id} />
                      </Collapse>
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

// ─── Player Detail (expanded) ─────────────────────────────────────────────────

function PlayerDetail({ id }: { id: string }): JSX.Element {
  const player = LeaderboardManager.getPlayerStats(id);
  if (player === null) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="#666">数据不可用</Typography>
      </Box>
    );
  }

  const eloHistory = player.eloHistory.length > 0 ? player.eloHistory : [player.elo];
  const eloChange = eloHistory.length >= 2 ? eloHistory[eloHistory.length - 1] - eloHistory[0] : 0;
  const winRate = player.totalGames > 0 ? (player.wins / player.totalGames) * 100 : 0;

  return (
    <Box sx={{ p: 2.5, bgcolor: '#191919' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3}>
        {/* Stats summary */}
        <Box sx={{ minWidth: 200 }}>
          <Typography variant="subtitle2" sx={{ color: '#ccc', mb: 1 }}>
            {player.name} 详细统计
          </Typography>
          <Stack spacing={0.5}>
            <StatRow label="当前 ELO" value={player.elo.toString()} color="#629924" />
            <StatRow
              label="ELO 变化"
              value={`${eloChange >= 0 ? '+' : ''}${eloChange}`}
              color={eloChange >= 0 ? '#4caf50' : '#e53e3e'}
            />
            <StatRow label="总对局" value={player.totalGames.toString()} />
            <StatRow label="胜 / 负 / 和" value={`${player.wins} / ${player.losses} / ${player.draws}`} />
            <StatRow label="胜率" value={`${winRate.toFixed(1)}%`} color={winRate >= 50 ? '#4caf50' : '#e53e3e'} />
          </Stack>

          {/* Recent Results */}
          <Typography variant="caption" color="#888" sx={{ mt: 1.5, mb: 0.5, display: 'block' }}>
            最近 20 局:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.3 }}>
            {Array.from({ length: Math.min(20, player.wins + player.losses + player.draws) }, (_, i) => {
              if (i < player.wins) {
                return (
                  <Box
                    key={i}
                    sx={{
                      width: 14,
                      height: 14,
                      borderRadius: 0.5,
                      bgcolor: 'rgba(76,175,80,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Typography sx={{ fontSize: '0.45rem', color: '#4caf50' }}>W</Typography>
                  </Box>
                );
              }
              if (i < player.wins + player.losses) {
                return (
                  <Box
                    key={i}
                    sx={{
                      width: 14,
                      height: 14,
                      borderRadius: 0.5,
                      bgcolor: 'rgba(229,62,62,0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Typography sx={{ fontSize: '0.45rem', color: '#e53e3e' }}>L</Typography>
                  </Box>
                );
              }
              return (
                <Box
                  key={i}
                  sx={{
                    width: 14,
                    height: 14,
                    borderRadius: 0.5,
                    bgcolor: 'rgba(158,158,158,0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Typography sx={{ fontSize: '0.45rem', color: '#888' }}>D</Typography>
                </Box>
              );
            })}
          </Box>
        </Box>

        {/* ELO chart */}
        <Box sx={{ flex: 1, minHeight: 120 }}>
          <Typography variant="caption" color="#888" sx={{ mb: 0.5, display: 'block' }}>
            ELO 变化趋势 (最近 {eloHistory.length} 局)
          </Typography>
          <EloChart history={eloHistory} />
        </Box>
      </Stack>
    </Box>
  );
}

function StatRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}): JSX.Element {
  return (
    <Stack direction="row" justifyContent="space-between" spacing={2}>
      <Typography variant="caption" color="#888">
        {label}
      </Typography>
      <Typography variant="caption" fontWeight={600} color={color ?? '#aaa'}>
        {value}
      </Typography>
    </Stack>
  );
}

// ─── ELO History Chart (SVG polyline) ─────────────────────────────────────────

function EloChart({ history }: { history: number[] }): JSX.Element {
  if (history.length < 2) {
    return (
      <Typography variant="caption" color="#555">
        需要至少 2 局才能显示趋势
      </Typography>
    );
  }

  const width = 280;
  const height = 100;
  const padding = { top: 10, right: 10, bottom: 20, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const minVal = Math.min(...history) - 10;
  const maxVal = Math.max(...history) + 10;
  const range = maxVal - minVal || 1;

  const points = history.map((val, i) => {
    const x = padding.left + (i / (history.length - 1)) * chartW;
    const y = padding.top + chartH - ((val - minVal) / range) * chartH;
    return `${x},${y}`;
  });

  const startElo = history[0];
  const endElo = history[history.length - 1];
  const trendColor = endElo >= startElo ? '#4caf50' : '#e53e3e';

  const yLabels = [minVal, Math.round((minVal + maxVal) / 2), maxVal];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ maxWidth: width }}>
      {yLabels.map((val) => {
        const y = padding.top + chartH - ((val - minVal) / range) * chartH;
        return (
          <g key={val}>
            <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#333" strokeWidth={0.5} />
            <text x={padding.left - 4} y={y + 4} textAnchor="end" fill="#777" fontSize="9">
              {val}
            </text>
          </g>
        );
      })}
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={trendColor}
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {history.map((val, i) => {
        const x = padding.left + (i / (history.length - 1)) * chartW;
        const y = padding.top + chartH - ((val - minVal) / range) * chartH;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={i === 0 || i === history.length - 1 ? 3 : 1.5}
            fill={trendColor}
          />
        );
      })}
      <text x={padding.left} y={height - 2} textAnchor="start" fill="#777" fontSize="8">
        始
      </text>
      <text x={width - padding.right} y={height - 2} textAnchor="end" fill="#777" fontSize="8">
        今
      </text>
    </svg>
  );
}
