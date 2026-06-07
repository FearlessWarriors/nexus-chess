import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tabs,
  Tab,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Checkbox,
  Divider,
  IconButton,
  LinearProgress,
} from '@mui/material';
import {
  EmojiEvents as TrophyIcon,
  NavigateNext as NextIcon,
  Add as AddIcon,
  AccessTime as TimeIcon,
  Groups as GroupsIcon,
} from '@mui/icons-material';
import { TournamentManager } from '../tournament/TournamentManager';
import { LeaderboardManager } from '../tournament/LeaderboardManager';
import type {
  Tournament,
  TournamentFormat,
  TournamentPlayer,
  TournamentMatch,
  MatchResult,
  PlayerEntry,
} from '../tournament/types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface TournamentPanelProps {
  onBack: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TournamentPanel({ onBack }: TournamentPanelProps): JSX.Element {
  const managerRef = useRef<TournamentManager>(new TournamentManager());
  const manager = managerRef.current;
  const [, setTick] = useState(0);

  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showResultDialog, setShowResultDialog] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  const forceUpdate = useCallback(() => setTick((n) => n + 1), []);

  const refresh = useCallback(() => {
    setTournaments(manager.listTournaments());
  }, [manager]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const selected = selectedId !== null ? manager.getTournament(selectedId) : undefined;

  const activeTournaments = tournaments.filter((t) => t.status === 'waiting' || t.status === 'in_progress');
  const completedTournaments = tournaments.filter((t) => t.status === 'completed');
  const displayedTournaments = tab === 0 ? activeTournaments : completedTournaments;

  // Show empty state when no tournaments exist
  useEffect(() => {
    if (tournaments.length === 0) {
      // No auto-generation — wait for real players
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', width: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Typography variant="h5" fontWeight={600} sx={{ color: '#ccc' }}>
            👑 锦标赛
          </Typography>
          <Chip
            label={`${activeTournaments.length} 活跃`}
            size="small"
            sx={{ fontSize: '0.6rem', height: 18, bgcolor: 'rgba(98,153,36,0.15)', color: '#629924' }}
          />
        </Stack>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setShowCreate(true)}
          sx={{
            bgcolor: '#629924',
            fontSize: '0.75rem',
            '&:hover': { bgcolor: '#7ab528' },
          }}
        >
          创建锦标赛
        </Button>
      </Stack>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_e, v) => setTab(v)}
        sx={{
          mb: 2,
          minHeight: 36,
          '& .MuiTab-root': { minHeight: 36, fontSize: '0.75rem', color: '#888', textTransform: 'none', py: 0.5 },
          '& .Mui-selected': { color: '#629924' },
          '& .MuiTabs-indicator': { bgcolor: '#629924' },
        }}
      >
        <Tab label={`进行中 (${activeTournaments.length})`} />
        <Tab label={`已完成 (${completedTournaments.length})`} />
      </Tabs>

      {displayedTournaments.length === 0 && (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center', bgcolor: '#1e1e1e', borderColor: '#333', borderRadius: 1 }}>
          <Typography variant="body1" color="#666">
            {tab === 0 ? '暂无活跃锦标赛，点击"创建锦标赛"开始' : '暂无已完成的锦标赛'}
          </Typography>
        </Paper>
      )}

      <Stack spacing={2}>
        {displayedTournaments.map((t) => (
          <Paper
            key={t.id}
            variant="outlined"
            sx={{
              p: 2,
              cursor: 'pointer',
              bgcolor: '#1e1e1e',
              borderColor: selectedId === t.id ? '#629924' : '#333',
              borderWidth: selectedId === t.id ? 2 : 1,
              borderRadius: 1,
              '&:hover': { borderColor: '#555' },
            }}
            onClick={() => setSelectedId(t.id === selectedId ? null : t.id)}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Stack direction="row" spacing={1} alignItems="center">
                <TrophyIcon sx={{ color: t.status === 'completed' ? '#FFD700' : '#555', fontSize: 20 }} />
                <Typography variant="subtitle1" fontWeight={600} color="#ccc" fontSize="0.9rem">
                  {t.name}
                </Typography>
                <Chip
                  label={t.format === 'swiss' ? '瑞士制' : '淘汰赛'}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.6rem', height: 18, borderColor: '#555', color: '#888' }}
                />
                <Chip
                  label={
                    t.status === 'waiting'
                      ? '等待中'
                      : t.status === 'in_progress'
                        ? '进行中'
                        : '已结束'
                  }
                  size="small"
                  sx={{
                    fontSize: '0.6rem',
                    height: 18,
                    bgcolor:
                      t.status === 'completed'
                        ? 'rgba(76,175,80,0.15)'
                        : t.status === 'in_progress'
                          ? 'rgba(98,153,36,0.15)'
                          : 'rgba(255,255,255,0.05)',
                    color:
                      t.status === 'completed'
                        ? '#4caf50'
                        : t.status === 'in_progress'
                          ? '#629924'
                          : '#888',
                  }}
                />
              </Stack>
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="caption" color="#666" fontSize="0.7rem">
                  <GroupsIcon sx={{ fontSize: 12, mr: 0.3, verticalAlign: 'middle' }} />
                  {t.players.length} 人
                </Typography>
                <Typography variant="caption" color="#666" fontSize="0.7rem">
                  第 {t.currentRound}/{t.config.rounds} 轮
                </Typography>
              </Stack>
            </Stack>

            {selectedId === t.id && (
              <TournamentDetail
                tournament={t}
                manager={manager}
                showResultDialog={showResultDialog}
                setShowResultDialog={setShowResultDialog}
                onUpdate={refresh}
              />
            )}
          </Paper>
        ))}
      </Stack>

      {/* Create Tournament Dialog */}
      <CreateTournamentDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={(name, format, players, config) => {
          manager.createTournament(name, format, players, config);
          refresh();
          setShowCreate(false);
        }}
      />

      {/* Result Entry Dialog */}
      <ResultDialog
        open={showResultDialog !== null}
        matchId={showResultDialog ?? ''}
        tournament={selected ?? null}
        onClose={() => setShowResultDialog(null)}
        onReport={(matchId, result) => {
          if (selected != null) {
            manager.reportResult(selected.id, matchId, result);
            refresh();
          }
          setShowResultDialog(null);
        }}
      />
    </Box>
  );
}

// ─── Tournament Detail ────────────────────────────────────────────────────────

function TournamentDetail({
  tournament,
  manager,
  showResultDialog,
  setShowResultDialog,
  onUpdate,
}: {
  tournament: Tournament;
  manager: TournamentManager;
  showResultDialog: string | null;
  setShowResultDialog: (id: string | null) => void;
  onUpdate: () => void;
}): JSX.Element {
  const isActive = tournament.status === 'in_progress' || tournament.status === 'waiting';

  // Sort players by score
  const sortedPlayers = [...tournament.players].sort(
    (a, b) => b.score - a.score || b.buchholz - a.buchholz || b.elo - a.elo,
  );

  return (
    <Box sx={{ mt: 2 }}>
      <Divider sx={{ mb: 2, borderColor: '#333' }} />

      {/* Progress bar */}
      {isActive && tournament.currentRound > 0 && (
        <Box sx={{ mb: 2 }}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="#888">
              轮次进度
            </Typography>
            <Typography variant="caption" color="#629924" fontWeight={600}>
              {tournament.currentRound} / {tournament.config.rounds}
            </Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={(tournament.currentRound / tournament.config.rounds) * 100}
            sx={{ height: 3, borderRadius: 1, bgcolor: '#333', '& .MuiLinearProgress-bar': { bgcolor: '#629924' } }}
          />
        </Box>
      )}

      {/* Player standings */}
      <Typography variant="subtitle2" sx={{ color: '#aaa', mb: 1, fontSize: '0.75rem' }}>
        积分表
      </Typography>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 2, bgcolor: '#191919', borderColor: '#2a2a2a' }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { borderBottom: '1px solid #2a2a2a', color: '#888', fontSize: '0.65rem' } }}>
              <TableCell sx={{ width: 32 }}>#</TableCell>
              <TableCell>玩家</TableCell>
              <TableCell align="right">ELO</TableCell>
              <TableCell align="right">积分</TableCell>
              {tournament.format === 'swiss' && <TableCell align="right">对手分</TableCell>}
              <TableCell align="center">胜/负/和</TableCell>
              <TableCell align="center">状态</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sortedPlayers.map((p, idx) => {
              // Count wins/losses/draws
              let pWins = 0;
              let pLosses = 0;
              let pDraws = 0;
              for (const round of tournament.rounds) {
                for (const match of round.matches) {
                  if (match.isBye && match.whiteId === p.id) { pWins++; continue; }
                  if (match.result === null) continue;
                  if (match.whiteId === p.id) {
                    if (match.result === 'white_win') pWins++;
                    else if (match.result === 'black_win') pLosses++;
                    else pDraws++;
                  } else if (match.blackId === p.id) {
                    if (match.result === 'black_win') pWins++;
                    else if (match.result === 'white_win') pLosses++;
                    else pDraws++;
                  }
                }
              }
              const rankBg = idx === 0 ? 'rgba(255,215,0,0.08)' : idx === 1 ? 'rgba(192,192,192,0.05)' : idx === 2 ? 'rgba(205,127,50,0.05)' : undefined;
              return (
                <TableRow
                  key={p.id}
                  sx={{
                    '& td': { borderBottom: '1px solid #2a2a2a', fontSize: '0.7rem', color: '#aaa' },
                    bgcolor: rankBg,
                  }}
                >
                  <TableCell sx={{ color: idx < 3 ? ['#FFD700', '#C0C0C0', '#CD7F32'][idx] : '#888', fontWeight: idx < 3 ? 700 : 400 }}>
                    {idx + 1}
                  </TableCell>
                  <TableCell sx={{ color: '#ccc', fontWeight: idx < 3 ? 600 : 400 }}>{p.name}</TableCell>
                  <TableCell align="right">{p.elo}</TableCell>
                  <TableCell align="right">
                    <Typography variant="caption" fontWeight={700} color="#629924" fontSize="0.7rem">
                      {p.score}
                    </Typography>
                  </TableCell>
                  {tournament.format === 'swiss' && (
                    <TableCell align="right">{p.buchholz.toFixed(1)}</TableCell>
                  )}
                  <TableCell align="center">
                    <Typography variant="caption" fontSize="0.65rem">
                      <span style={{ color: '#4caf50' }}>{pWins}</span>
                      {' / '}
                      <span style={{ color: '#e53e3e' }}>{pLosses}</span>
                      {' / '}
                      <span style={{ color: '#888' }}>{pDraws}</span>
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    {p.eliminated ? (
                      <Chip label="淘汰" size="small" sx={{ fontSize: '0.55rem', height: 16, bgcolor: 'rgba(229,62,62,0.15)', color: '#e53e3e' }} />
                    ) : tournament.winnerIds.includes(p.id) ? (
                      <Chip label="🏆" size="small" sx={{ fontSize: '0.55rem', height: 16 }} />
                    ) : (
                      <Chip label="进行中" size="small" variant="outlined" sx={{ fontSize: '0.55rem', height: 16, borderColor: '#555', color: '#888' }} />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Rounds */}
      {tournament.rounds.map((round) => (
        <Box key={round.number} sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} mb={1}>
            <Typography variant="subtitle2" sx={{ color: '#aaa', fontSize: '0.75rem' }}>
              第 {round.number} 轮
            </Typography>
            <Chip
              label={
                round.status === 'completed'
                  ? '已完成'
                  : round.status === 'in_progress'
                    ? '进行中'
                    : '待开始'
              }
              size="small"
              sx={{
                fontSize: '0.55rem',
                height: 16,
                bgcolor:
                  round.status === 'completed'
                    ? 'rgba(76,175,80,0.15)'
                    : round.status === 'in_progress'
                      ? 'rgba(98,153,36,0.15)'
                      : 'transparent',
                color:
                  round.status === 'completed'
                    ? '#4caf50'
                    : round.status === 'in_progress'
                      ? '#629924'
                      : '#888',
              }}
            />
          </Stack>

          <TableContainer component={Paper} variant="outlined" sx={{ bgcolor: '#191919', borderColor: '#2a2a2a' }}>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& th': { borderBottom: '1px solid #2a2a2a', color: '#888', fontSize: '0.65rem' } }}>
                  <TableCell>白方</TableCell>
                  <TableCell>黑方</TableCell>
                  <TableCell align="center">结果</TableCell>
                  <TableCell align="center" sx={{ width: 80 }}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {round.matches.map((match) => (
                  <MatchRow
                    key={match.id}
                    match={match}
                    tournament={tournament}
                    disabled={round.status === 'completed' || tournament.status === 'completed'}
                    onReport={() => setShowResultDialog(match.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      ))}

      {/* Next Round Button */}
      {isActive && tournament.status !== 'completed' && (
        <Button
          variant="contained"
          startIcon={<NextIcon />}
          onClick={() => {
            manager.startNextRound(tournament.id);
            onUpdate();
          }}
          fullWidth
          sx={{ bgcolor: '#629924', fontSize: '0.8rem', '&:hover': { bgcolor: '#7ab528' } }}
        >
          {tournament.currentRound === 0 ? '开始第一轮' : `开始第 ${tournament.currentRound + 1} 轮`}
        </Button>
      )}

      {tournament.status === 'completed' && tournament.winnerIds.length > 0 && (
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            textAlign: 'center',
            bgcolor: 'rgba(255,215,0,0.08)',
            borderColor: 'rgba(255,215,0,0.3)',
            borderRadius: 1,
          }}
        >
          <TrophyIcon sx={{ fontSize: 40, color: '#FFD700' }} />
          <Typography variant="h6" color="#FFD700">
            🏆{' '}
            {tournament.winnerIds
              .map((id) => tournament.players.find((p) => p.id === id)?.name ?? '?')
              .join(', ')}{' '}
            获胜！
          </Typography>
        </Paper>
      )}
    </Box>
  );
}

// ─── Match Row ────────────────────────────────────────────────────────────────

function MatchRow({
  match,
  tournament,
  disabled,
  onReport,
}: {
  match: TournamentMatch;
  tournament: Tournament;
  disabled: boolean;
  onReport: () => void;
}): JSX.Element {
  const whiteName = tournament.players.find((p) => p.id === match.whiteId)?.name ?? '?';
  const blackName = match.isBye ? '(轮空)' : tournament.players.find((p) => p.id === match.blackId)?.name ?? '?';

  const resultLabel = match.isBye
    ? `${whiteName} 轮空胜`
    : match.result === 'white_win'
      ? `${whiteName} 胜`
      : match.result === 'black_win'
        ? `${blackName} 胜`
        : match.result === 'draw'
          ? '平局'
          : '—';

  return (
    <TableRow sx={{ '& td': { borderBottom: '1px solid #2a2a2a', fontSize: '0.7rem', color: '#aaa' } }}>
      <TableCell>{whiteName}</TableCell>
      <TableCell>{blackName}</TableCell>
      <TableCell align="center">
        <Chip
          label={resultLabel}
          size="small"
          sx={{
            fontSize: '0.6rem',
            height: 18,
            bgcolor: match.result !== null || match.isBye ? 'rgba(76,175,80,0.15)' : 'transparent',
            color: match.result !== null || match.isBye ? '#4caf50' : '#888',
          }}
        />
      </TableCell>
      <TableCell align="center">
        {!match.isBye && match.result === null && !disabled && (
          <Button
            size="small"
            variant="outlined"
            onClick={onReport}
            sx={{ fontSize: '0.6rem', py: 0, px: 1, minWidth: 0, borderColor: '#555', color: '#aaa' }}
          >
            录入
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

// ─── Create Tournament Dialog ─────────────────────────────────────────────────

function CreateTournamentDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, format: TournamentFormat, players: PlayerEntry[], config?: object) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<TournamentFormat>('swiss');
  const [rounds, setRounds] = useState(5);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const allPlayers = LeaderboardManager.getAllPlayers();
  const availablePlayers: PlayerEntry[] = allPlayers;

  const handleToggle = (id: string): void => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleCreate = (): void => {
    if (name.trim().length === 0) return;
    const picked = availablePlayers.filter((p) => selectedIds.has(p.id));
    if (picked.length < 2) return;
    onCreate(name.trim(), format, picked, { rounds: format === 'swiss' ? rounds : 0 });
    setName('');
    setSelectedIds(new Set());
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { bgcolor: '#1e1e1e', border: '1px solid #333' } }}
    >
      <DialogTitle sx={{ color: '#ccc' }}>创建锦标赛</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="锦标赛名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            autoFocus
            InputLabelProps={{ sx: { color: '#888', fontSize: '0.8rem' } }}
            sx={{
              '& .MuiInputBase-root': { color: '#ccc', fontSize: '0.85rem' },
              '& .MuiOutlinedInput-notchedOutline': { borderColor: '#444' },
            }}
          />
          <FormControl fullWidth>
            <InputLabel sx={{ color: '#888', fontSize: '0.8rem' }}>赛制</InputLabel>
            <Select
              value={format}
              label="赛制"
              onChange={(e) => setFormat(e.target.value as TournamentFormat)}
              sx={{
                color: '#ccc',
                fontSize: '0.85rem',
                '& .MuiOutlinedInput-notchedOutline': { borderColor: '#444' },
              }}
            >
              <MenuItem value="swiss">瑞士制</MenuItem>
              <MenuItem value="elimination">淘汰赛</MenuItem>
            </Select>
          </FormControl>
          {format === 'swiss' && (
            <TextField
              label="轮数"
              type="number"
              value={rounds}
              onChange={(e) => setRounds(Math.max(1, Math.min(9, parseInt(e.target.value) || 5)))}
              fullWidth
              inputProps={{ min: 1, max: 9 }}
              InputLabelProps={{ sx: { color: '#888', fontSize: '0.8rem' } }}
              sx={{
                '& .MuiInputBase-root': { color: '#ccc', fontSize: '0.85rem' },
                '& .MuiOutlinedInput-notchedOutline': { borderColor: '#444' },
              }}
            />
          )}
          <Typography variant="subtitle2" color="#888" fontSize="0.75rem">
            选择参赛选手 ({selectedIds.size} 已选)
          </Typography>
          <List dense sx={{ maxHeight: 200, overflowY: 'auto', bgcolor: '#191919', borderRadius: 1 }}>
            {availablePlayers.length === 0 && (
              <ListItem dense>
                <Typography variant="caption" color="#666" sx={{ py: 2, textAlign: 'center', width: '100%' }}>
                  暂无注册玩家，请先注册并完成对局后再创建锦标赛
                </Typography>
              </ListItem>
            )}
            {availablePlayers.map((p) => (
              <ListItem
                key={p.id}
                dense
                component="div"
                onClick={() => handleToggle(p.id)}
                sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'rgba(98,153,36,0.06)' } }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Checkbox
                    checked={selectedIds.has(p.id)}
                    size="small"
                    onChange={() => handleToggle(p.id)}
                    sx={{ color: '#555', '&.Mui-checked': { color: '#629924' } }}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={<Typography variant="body2" color="#ccc" fontSize="0.8rem">{p.name}</Typography>}
                  secondary={<Typography variant="caption" color="#666" fontSize="0.65rem">ELO {p.elo} · {p.wins}W {p.losses}L {p.draws}D</Typography>}
                />
              </ListItem>
            ))}
          </List>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: '#888' }}>取消</Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={name.trim().length === 0 || selectedIds.size < 2}
          sx={{ bgcolor: '#629924', '&:hover': { bgcolor: '#7ab528' } }}
        >
          创建
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Result Entry Dialog ──────────────────────────────────────────────────────

function ResultDialog({
  open,
  matchId,
  tournament,
  onClose,
  onReport,
}: {
  open: boolean;
  matchId: string;
  tournament: Tournament | null;
  onClose: () => void;
  onReport: (matchId: string, result: MatchResult) => void;
}): JSX.Element {
  if (tournament === null) return <span />;

  const currentRound = tournament.rounds[tournament.rounds.length - 1];
  const match = currentRound?.matches.find((m) => m.id === matchId);
  if (match === undefined) return <span />;

  const whiteName = tournament.players.find((p) => p.id === match.whiteId)?.name ?? '白方';
  const blackName = tournament.players.find((p) => p.id === match.blackId)?.name ?? '黑方';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{ sx: { bgcolor: '#1e1e1e', border: '1px solid #333' } }}
    >
      <DialogTitle sx={{ color: '#ccc' }}>录入比赛结果</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="#888" gutterBottom fontSize="0.8rem">
          {whiteName} vs {blackName}
        </Typography>
        <Stack spacing={1.5} sx={{ mt: 2 }}>
          <Button
            variant="outlined"
            fullWidth
            onClick={() => onReport(matchId, 'white_win')}
            sx={{ borderColor: '#555', color: '#ccc', '&:hover': { borderColor: '#629924' } }}
          >
            {whiteName} 胜 (白方胜)
          </Button>
          <Button
            variant="outlined"
            fullWidth
            onClick={() => onReport(matchId, 'black_win')}
            sx={{ borderColor: '#555', color: '#ccc', '&:hover': { borderColor: '#629924' } }}
          >
            {blackName} 胜 (黑方胜)
          </Button>
          <Button
            variant="outlined"
            fullWidth
            onClick={() => onReport(matchId, 'draw')}
            sx={{ borderColor: '#555', color: '#ccc', '&:hover': { borderColor: '#629924' } }}
          >
            平局
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ color: '#888' }}>取消</Button>
      </DialogActions>
    </Dialog>
  );
}

