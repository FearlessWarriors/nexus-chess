/**
 * ProfileDialog.tsx — User profile popup dialog
 *
 * Shows: nickname, ELO, W/L/D, rank, current badge
 * Allows editing badge text (max 10 chars)
 * Calls PUT /api/v1/auth/badge
 */

import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Stack,
  Box,
  Divider,
} from '@mui/material';
import { useAuth, type UserInfo } from '../auth/AuthContext';
import BadgeChip, { type BadgeType } from './BadgeChip';

// ─── Props ───────────────────────────────────────────────────────────────────

interface ProfileDialogProps {
  open: boolean;
  onClose: () => void;
}

// ─── API ─────────────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:3001';

// ─── Component ───────────────────────────────────────────────────────────────

export default function ProfileDialog({ open, onClose }: ProfileDialogProps): JSX.Element {
  const { user, token, updateBadge } = useAuth();
  const [badgeInput, setBadgeInput] = useState<string>(user?.badge_text ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      setBadgeInput(user?.badge_text ?? '');
      setError(null);
      setSuccess(false);
    }
  }, [open, user?.badge_text]);

  const handleSave = useCallback(async () => {
    if (token === null) return;

    const sanitized = badgeInput.trim().slice(0, 10);
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/badge`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ badge_text: sanitized }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? '保存失败');
        setSaving(false);
        return;
      }

      updateBadge(data.badge_text);
      setBadgeInput(data.badge_text);
      setSuccess(true);
    } catch {
      setError('网络错误，请重试');
    } finally {
      setSaving(false);
    }
  }, [badgeInput, token, updateBadge]);

  if (user === null) {
    return (
      <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
        <DialogContent>
          <Typography color="#888">请先登录</Typography>
        </DialogContent>
      </Dialog>
    );
  }

  const badgeType: BadgeType = (user.badge_type as BadgeType) || '';
  const displayBadgeText = user.badge_text || '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: '#1e1e1e',
          border: '1px solid #333',
          borderRadius: 2,
          color: '#ccc',
        },
      }}
    >
      <DialogTitle sx={{ color: '#ccc', fontSize: '1rem', fontWeight: 600 }}>
        个人资料
      </DialogTitle>

      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {/* Name and badge */}
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="h6" sx={{ color: '#fff', fontWeight: 700 }}>
              {user.name}
            </Typography>
            {badgeType !== '' && (
              <BadgeChip
                badgeType={badgeType}
                badgeText={displayBadgeText}
                size="medium"
              />
            )}
            {user.is_admin && badgeType === '' && (
              <BadgeChip badgeType="admin" size="medium" />
            )}
          </Stack>

          <Divider sx={{ borderColor: '#333' }} />

          {/* Stats */}
          <Stack spacing={0.8}>
            <StatRow label="ELO 评分" value={user.elo.toString()} color="#629924" />
            <StatRow label="排名" value={`#${user.rank ?? '-'}`} color="#FFD700" />
            <StatRow
              label="战绩"
              value={`${user.wins}胜 / ${user.losses}负 / ${user.draws}和`}
              color="#aaa"
            />
            <StatRow
              label="胜率"
              value={
                user.wins + user.losses + user.draws > 0
                  ? `${((user.wins / (user.wins + user.losses + user.draws)) * 100).toFixed(1)}%`
                  : '-'
              }
              color={
                user.wins + user.losses + user.draws > 0 &&
                user.wins / (user.wins + user.losses + user.draws) >= 0.5
                  ? '#4caf50'
                  : '#e53e3e'
              }
            />
            <StatRow label="管理员" value={user.is_admin ? '是 👑' : '否'} color={user.is_admin ? '#FFD700' : '#666'} />
          </Stack>

          <Divider sx={{ borderColor: '#333' }} />

          {/* Badge editor */}
          <Box>
            <Typography variant="caption" color="#888" sx={{ mb: 0.5, display: 'block' }}>
              编辑牌子文字 (最长 10 字符)
            </Typography>
            <Stack direction="row" spacing={1} alignItems="flex-start">
              <TextField
                size="small"
                value={badgeInput}
                onChange={(e) => {
                  const val = e.target.value.slice(0, 10);
                  setBadgeInput(val);
                  setSuccess(false);
                }}
                placeholder="输入自定义文字..."
                inputProps={{ maxLength: 10 }}
                sx={{
                  flex: 1,
                  '& .MuiInputBase-root': {
                    fontSize: '0.8rem',
                    color: '#ccc',
                    bgcolor: '#2a2a2a',
                  },
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#444' },
                }}
              />
              <Button
                variant="contained"
                size="small"
                onClick={handleSave}
                disabled={saving}
                sx={{
                  bgcolor: '#629924',
                  fontSize: '0.7rem',
                  minWidth: 60,
                  '&:hover': { bgcolor: '#7ab528' },
                }}
              >
                {saving ? '...' : '保存'}
              </Button>
            </Stack>
            {error !== null && (
              <Typography variant="caption" color="#e53e3e" sx={{ mt: 0.5, display: 'block' }}>
                {error}
              </Typography>
            )}
            {success && (
              <Typography variant="caption" color="#4caf50" sx={{ mt: 0.5, display: 'block' }}>
                牌子已更新！
              </Typography>
            )}
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={onClose}
          size="small"
          sx={{ color: '#888', fontSize: '0.7rem' }}
        >
          关闭
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ─── Stat Row ────────────────────────────────────────────────────────────────

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
    <Stack direction="row" justifyContent="space-between">
      <Typography variant="caption" color="#888">
        {label}
      </Typography>
      <Typography variant="caption" fontWeight={600} color={color ?? '#aaa'}>
        {value}
      </Typography>
    </Stack>
  );
}
