import React from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  CircularProgress,
  Stack,
} from '@mui/material';
import {
  SportsEsports as PlayIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';
import type { RoomClient } from '../network/RoomClient';

// ─── Props ────────────────────────────────────────────────────────────────────

interface QueuePanelProps {
  roomClient: RoomClient | null;
  isInQueue: boolean;
  queueTime: number; // seconds
  onJoinQueue: () => void;
  onLeaveQueue: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Matchmaking queue panel showing queue status, wait time, and
 * join/leave queue buttons with a spinning animation while waiting.
 */
export default function QueuePanel({
  isInQueue,
  queueTime,
  onJoinQueue,
  onLeaveQueue,
}: QueuePanelProps): JSX.Element {
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins > 0) {
      return `${mins}分${secs}秒`;
    }
    return `${secs}秒`;
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 2,
        maxWidth: 320,
      }}
    >
      <Typography variant="h6" fontWeight={600}>
        在线匹配
      </Typography>

      {isInQueue ? (
        <>
          {/* Spinning piece animation */}
          <Box sx={{ position: 'relative', width: 80, height: 80 }}>
            <CircularProgress
              size={80}
              thickness={3}
              sx={{
                color: 'primary.main',
                animation: 'spin 3s linear infinite',
                '@keyframes spin': {
                  '0%': { transform: 'rotate(0deg)' },
                  '100%': { transform: 'rotate(360deg)' },
                },
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <PlayIcon sx={{ fontSize: 32, color: 'primary.main' }} />
            </Box>
          </Box>

          <Typography variant="body1" color="text.secondary">
            正在寻找对手...
          </Typography>

          <Typography variant="h5" fontWeight={700} color="primary.main">
            {formatTime(queueTime)}
          </Typography>

          <Typography variant="caption" color="text.disabled">
            匹配范围会随时间逐渐扩大
          </Typography>

          <Button
            variant="outlined"
            color="error"
            startIcon={<CancelIcon />}
            onClick={onLeaveQueue}
            fullWidth
          >
            取消匹配
          </Button>
        </>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" textAlign="center">
            加入匹配队列，系统将自动为你寻找实力相近的对手
          </Typography>

          <Button
            variant="contained"
            size="large"
            startIcon={<PlayIcon />}
            onClick={onJoinQueue}
            fullWidth
            sx={{ mt: 1 }}
          >
            开始匹配
          </Button>
        </>
      )}
    </Paper>
  );
}
