/**
 * AdminPanel.tsx — Administrator Control Panel
 *
 * Only visible to admin users (user.is_admin === true).
 * Features:
 *   - User list table with search/pagination
 *   - Suspend / Unsuspend users
 *   - Promote / Demote admins
 *   - Reset user passwords
 *   - Game management (view/delete)
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
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
  Button,
  TextField,
  Stack,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Pagination,
  InputAdornment,
  CircularProgress,
  Snackbar,
  Alert,
  Tooltip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Block as BlockIcon,
  CheckCircle as UnblockIcon,
  ArrowUpward as PromoteIcon,
  ArrowDownward as DemoteIcon,
  LockReset as ResetIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
} from '@mui/icons-material';
import { useAuth } from '../auth/AuthContext';

import { API_BASE } from '../config';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdminUser {
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

interface AdminGame {
  id: number;
  white_id: number | null;
  black_id: number | null;
  result: string;
  winner_id: number | null;
  created_at: string;
  finished_at: string | null;
  white_name: string | null;
  black_name: string | null;
}

type TabId = 'users' | 'games';

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminPanel(): JSX.Element {
  const { token } = useAuth();
  const [activeTab, setActiveTab] = useState<TabId>('users');

  if (token === null) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="#888">请先登录管理员账号</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1100, mx: 'auto', width: '100%' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h5" fontWeight={600} sx={{ color: '#FFD700' }}>
          👑 管理员面板
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant={activeTab === 'users' ? 'contained' : 'outlined'}
            onClick={() => setActiveTab('users')}
            sx={{
              fontSize: '0.7rem',
              bgcolor: activeTab === 'users' ? '#FFD700' : 'transparent',
              color: activeTab === 'users' ? '#1a1a1a' : '#888',
              borderColor: '#555',
              '&:hover': { borderColor: '#FFD700', color: '#FFD700' },
            }}
          >
            用户管理
          </Button>
          <Button
            size="small"
            variant={activeTab === 'games' ? 'contained' : 'outlined'}
            onClick={() => setActiveTab('games')}
            sx={{
              fontSize: '0.7rem',
              bgcolor: activeTab === 'games' ? '#FFD700' : 'transparent',
              color: activeTab === 'games' ? '#1a1a1a' : '#888',
              borderColor: '#555',
              '&:hover': { borderColor: '#FFD700', color: '#FFD700' },
            }}
          >
            对局管理
          </Button>
        </Stack>
      </Stack>

      {activeTab === 'users' ? (
        <UserManagement token={token} />
      ) : (
        <GameManagement token={token} />
      )}
    </Box>
  );
}

// ─── User Management Tab ─────────────────────────────────────────────────────

function UserManagement({ token }: { token: string }): JSX.Element {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<AdminUser | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [resetResult, setResetResult] = useState<string | null>(null);

  const limit = 20;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String((page - 1) * limit),
      });
      if (search.trim().length > 0) {
        params.set('q', search.trim());
      }

      const res = await fetch(`${API_BASE}/api/v1/admin/users?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (res.ok) {
        setUsers(data.users as AdminUser[]);
        setTotal(data.total as number);
      } else {
        setSnackbar({ message: data.error ?? '加载失败', severity: 'error' });
      }
    } catch {
      setSnackbar({ message: '网络错误', severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [token, page, search, limit]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleAction = useCallback(
    async (userId: number, action: string, body?: Record<string, unknown>) => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/admin/users/${userId}/${action}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const data = await res.json();

        if (res.ok) {
          setSnackbar({ message: `操作成功: ${action}`, severity: 'success' });
          if (action === 'reset-password' && data.newPassword !== undefined) {
            setResetResult(`新密码: ${data.newPassword}`);
          }
          fetchUsers();
        } else {
          setSnackbar({ message: data.error ?? '操作失败', severity: 'error' });
        }
      } catch {
        setSnackbar({ message: '网络错误', severity: 'error' });
      }
    },
    [token, fetchUsers],
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <>
      {/* Search */}
      <Stack direction="row" spacing={2} mb={2} alignItems="center">
        <TextField
          size="small"
          placeholder="搜索用户..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 16, color: '#666' }} />
              </InputAdornment>
            ),
          }}
          sx={{
            flex: 1,
            maxWidth: 300,
            '& .MuiInputBase-root': { fontSize: '0.8rem', color: '#ccc', bgcolor: '#1e1e1e' },
            '& .MuiOutlinedInput-notchedOutline': { borderColor: '#444' },
          }}
        />
        <IconButton onClick={fetchUsers} size="small" sx={{ color: '#888' }}>
          <RefreshIcon fontSize="small" />
        </IconButton>
        {loading && <CircularProgress size={16} sx={{ color: '#FFD700' }} />}
      </Stack>

      {/* User Table */}
      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ bgcolor: '#1e1e1e', borderColor: '#333', borderRadius: 1, mb: 2 }}
      >
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { borderBottom: '1px solid #333', color: '#888', fontSize: '0.7rem' } }}>
              <TableCell>ID</TableCell>
              <TableCell>昵称</TableCell>
              <TableCell align="right">ELO</TableCell>
              <TableCell>标签</TableCell>
              <TableCell>状态</TableCell>
              <TableCell align="center">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((u) => (
              <TableRow
                key={u.id}
                sx={{
                  '& td': { borderBottom: '1px solid #2a2a2a', fontSize: '0.75rem', color: '#aaa' },
                  '&:hover': { bgcolor: 'rgba(255,215,0,0.03)' },
                }}
              >
                <TableCell sx={{ color: '#666', fontSize: '0.7rem' }}>{u.id}</TableCell>
                <TableCell>
                  <Stack direction="row" alignItems="center" spacing={0.8}>
                    <Typography variant="body2" color="#ccc" fontSize="0.78rem" fontWeight={600}>
                      {u.name}
                    </Typography>
                    {u.is_admin === 1 && (
                      <Chip label="ADMIN" size="small" sx={{ fontSize: '0.55rem', height: 18, bgcolor: '#FFD700', color: '#1a1a1a', fontWeight: 700 }} />
                    )}
                    {u.badge_type !== '' && u.badge_type !== null && (
                      <Chip
                        label={u.badge_text || u.badge_type}
                        size="small"
                        sx={{
                          fontSize: '0.55rem',
                          height: 18,
                          bgcolor: u.badge_type === 'top10' ? 'rgba(255,215,0,0.3)' :
                                   u.badge_type === 'top100' ? 'rgba(220,20,60,0.5)' :
                                   'rgba(255,255,255,0.2)',
                          color: u.badge_type === 'top500' ? '#1a1a1a' : '#fff',
                          fontWeight: 700,
                        }}
                      />
                    )}
                  </Stack>
                </TableCell>
                <TableCell align="right">
                  <Chip
                    label={u.elo}
                    size="small"
                    sx={{ fontSize: '0.65rem', height: 20, bgcolor: 'rgba(98,153,36,0.1)', color: '#629924', fontWeight: 600 }}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="caption" color="#888" fontSize="0.65rem">
                    {u.wins}W / {u.losses}L / {u.draws}D
                  </Typography>
                </TableCell>
                <TableCell>
                  {u.suspended === 1 ? (
                    <Tooltip title={u.suspended_reason || '已封禁'}>
                      <Chip label="已封禁" size="small" sx={{ fontSize: '0.6rem', height: 18, bgcolor: 'rgba(229,62,62,0.2)', color: '#e53e3e' }} />
                    </Tooltip>
                  ) : u.is_banned === 1 ? (
                    <Chip label="临时封禁" size="small" sx={{ fontSize: '0.6rem', height: 18, bgcolor: 'rgba(255,152,0,0.2)', color: '#ff9800' }} />
                  ) : (
                    <Chip label="正常" size="small" sx={{ fontSize: '0.6rem', height: 18, bgcolor: 'rgba(76,175,80,0.1)', color: '#4caf50' }} />
                  )}
                </TableCell>
                <TableCell align="center">
                  <Stack direction="row" spacing={0.3} justifyContent="center">
                    {u.suspended === 1 ? (
                      <Tooltip title="解封">
                        <IconButton size="small" onClick={() => handleAction(u.id, 'unsuspend')} sx={{ color: '#4caf50' }}>
                          <UnblockIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Tooltip title="封禁">
                        <IconButton
                          size="small"
                          onClick={() => {
                            setSuspendTarget(u);
                            setSuspendReason('');
                          }}
                          sx={{ color: '#e53e3e' }}
                        >
                          <BlockIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                    {u.is_admin === 1 ? (
                      <Tooltip title="降级">
                        <IconButton size="small" onClick={() => handleAction(u.id, 'demote')} sx={{ color: '#ff9800' }}>
                          <DemoteIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Tooltip title="提升为管理员">
                        <IconButton size="small" onClick={() => handleAction(u.id, 'promote')} sx={{ color: '#FFD700' }}>
                          <PromoteIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Tooltip title="重置密码">
                      <IconButton size="small" onClick={() => handleAction(u.id, 'reset-password')} sx={{ color: '#888' }}>
                        <ResetIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
            {users.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ color: '#666', py: 4 }}>
                  暂无用户数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Pagination */}
      {totalPages > 1 && (
        <Stack alignItems="center">
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_e, p) => setPage(p)}
            size="small"
            sx={{
              '& .MuiPaginationItem-root': { color: '#888', fontSize: '0.7rem' },
              '& .Mui-selected': { bgcolor: 'rgba(255,215,0,0.2)', color: '#FFD700' },
            }}
          />
        </Stack>
      )}

      {/* Suspend Dialog */}
      <Dialog
        open={suspendTarget !== null}
        onClose={() => setSuspendTarget(null)}
        PaperProps={{ sx: { bgcolor: '#1e1e1e', border: '1px solid #333', borderRadius: 2 } }}
      >
        <DialogTitle sx={{ color: '#ccc', fontSize: '0.95rem' }}>
          封禁用户: {suspendTarget?.name}
        </DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            size="small"
            placeholder="封禁原因（可选）"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value.slice(0, 200))}
            sx={{
              mt: 1,
              '& .MuiInputBase-root': { fontSize: '0.8rem', color: '#ccc', bgcolor: '#2a2a2a' },
              '& .MuiOutlinedInput-notchedOutline': { borderColor: '#444' },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setSuspendTarget(null)} sx={{ color: '#888' }}>
            取消
          </Button>
          <Button
            size="small"
            color="error"
            variant="contained"
            onClick={() => {
              if (suspendTarget !== null) {
                handleAction(suspendTarget.id, 'suspend', {
                  reason: suspendReason.trim() || undefined,
                });
                setSuspendTarget(null);
              }
            }}
            sx={{ fontSize: '0.7rem' }}
          >
            确认封禁
          </Button>
        </DialogActions>
      </Dialog>

      {/* Reset Password Result Dialog */}
      <Dialog
        open={resetResult !== null}
        onClose={() => setResetResult(null)}
        PaperProps={{ sx: { bgcolor: '#1e1e1e', border: '1px solid #333', borderRadius: 2 } }}
      >
        <DialogTitle sx={{ color: '#ccc', fontSize: '0.95rem' }}>密码已重置</DialogTitle>
        <DialogContent>
          <Typography color="#4caf50" fontWeight={600} fontSize="0.9rem" sx={{ fontFamily: 'monospace' }}>
            {resetResult}
          </Typography>
          <Typography variant="caption" color="#888" sx={{ mt: 1, display: 'block' }}>
            请将此密码发送给用户，此密码仅显示一次。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setResetResult(null)} sx={{ color: '#888' }}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={snackbar !== null}
        autoHideDuration={3000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snackbar !== null ? (
          <Alert severity={snackbar.severity} sx={{ fontSize: '0.8rem' }}>
            {snackbar.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}

// ─── Game Management Tab ─────────────────────────────────────────────────────

function GameManagement({ token }: { token: string }): JSX.Element {
  const [games, setGames] = useState<AdminGame[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [snackbar, setSnackbar] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  const limit = 20;

  const fetchGames = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String((page - 1) * limit),
      });

      const res = await fetch(`${API_BASE}/api/v1/admin/games?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (res.ok) {
        setGames(data.games as AdminGame[]);
        setTotal(data.total as number);
      } else {
        setSnackbar({ message: data.error ?? '加载失败', severity: 'error' });
      }
    } catch {
      setSnackbar({ message: '网络错误', severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [token, page, limit]);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  const handleDeleteGame = useCallback(
    async (gameId: number) => {
      if (!confirm(`确定删除对局 #${gameId}？此操作不可撤销。`)) return;

      try {
        const res = await fetch(`${API_BASE}/api/v1/admin/games/${gameId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();

        if (res.ok) {
          setSnackbar({ message: `对局 #${gameId} 已删除`, severity: 'success' });
          fetchGames();
        } else {
          setSnackbar({ message: data.error ?? '删除失败', severity: 'error' });
        }
      } catch {
        setSnackbar({ message: '网络错误', severity: 'error' });
      }
    },
    [token, fetchGames],
  );

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const resultLabel = (result: string): { label: string; color: string } => {
    switch (result) {
      case 'white_win': return { label: '白胜', color: '#FFF8DC' };
      case 'black_win': return { label: '黑胜', color: '#aaa' };
      case 'draw': return { label: '平局', color: '#888' };
      case 'in_progress': return { label: '进行中', color: '#4caf50' };
      default: return { label: result, color: '#888' };
    }
  };

  return (
    <>
      <Stack direction="row" spacing={2} mb={2} alignItems="center">
        <IconButton onClick={fetchGames} size="small" sx={{ color: '#888' }}>
          <RefreshIcon fontSize="small" />
        </IconButton>
        {loading && <CircularProgress size={16} sx={{ color: '#FFD700' }} />}
      </Stack>

      <TableContainer
        component={Paper}
        variant="outlined"
        sx={{ bgcolor: '#1e1e1e', borderColor: '#333', borderRadius: 1, mb: 2 }}
      >
        <Table size="small">
          <TableHead>
            <TableRow sx={{ '& th': { borderBottom: '1px solid #333', color: '#888', fontSize: '0.7rem' } }}>
              <TableCell>ID</TableCell>
              <TableCell>白方</TableCell>
              <TableCell>黑方</TableCell>
              <TableCell>结果</TableCell>
              <TableCell>时间</TableCell>
              <TableCell align="center">操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {games.map((g) => {
              const r = resultLabel(g.result);
              return (
                <TableRow
                  key={g.id}
                  sx={{
                    '& td': { borderBottom: '1px solid #2a2a2a', fontSize: '0.75rem', color: '#aaa' },
                    '&:hover': { bgcolor: 'rgba(255,215,0,0.03)' },
                  }}
                >
                  <TableCell sx={{ color: '#666', fontSize: '0.7rem' }}>{g.id}</TableCell>
                  <TableCell sx={{ color: '#FFF8DC' }}>{g.white_name ?? `ID:${g.white_id}`}</TableCell>
                  <TableCell sx={{ color: '#aaa' }}>{g.black_name ?? `ID:${g.black_id}`}</TableCell>
                  <TableCell>
                    <Chip
                      label={r.label}
                      size="small"
                      sx={{ fontSize: '0.6rem', height: 18, bgcolor: 'transparent', color: r.color, border: `1px solid ${r.color}40` }}
                    />
                  </TableCell>
                  <TableCell sx={{ fontSize: '0.65rem', color: '#666' }}>
                    {g.created_at?.slice(0, 16).replace('T', ' ') ?? '-'}
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="删除此对局">
                      <IconButton size="small" onClick={() => handleDeleteGame(g.id)} sx={{ color: '#e53e3e' }}>
                        <DeleteIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
            {games.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ color: '#666', py: 4 }}>
                  暂无对局数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {totalPages > 1 && (
        <Stack alignItems="center">
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_e, p) => setPage(p)}
            size="small"
            sx={{
              '& .MuiPaginationItem-root': { color: '#888', fontSize: '0.7rem' },
              '& .Mui-selected': { bgcolor: 'rgba(255,215,0,0.2)', color: '#FFD700' },
            }}
          />
        </Stack>
      )}

      <Snackbar
        open={snackbar !== null}
        autoHideDuration={3000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snackbar !== null ? (
          <Alert severity={snackbar.severity} sx={{ fontSize: '0.8rem' }}>
            {snackbar.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
