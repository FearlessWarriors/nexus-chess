import React, { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  TextField,
  Stack,
  Chip,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  ContentCopy as CopyIcon,
  Login as JoinIcon,
  Add as CreateIcon,
  Circle as OnlineIcon,
  Visibility as SpectatorIcon,
} from '@mui/icons-material';
import type { RoomClient } from '../network/RoomClient';

// ─── Props ────────────────────────────────────────────────────────────────────

interface RoomState {
  roomId: string;
  opponentName: string;
  opponentElo: number;
  opponentConnected: boolean;
  spectators: string[];
}

interface RoomPanelProps {
  roomClient: RoomClient | null;
  roomState: RoomState | null;
  onCreateRoom: () => void;
  onJoinRoom: (roomId: string) => void;
  onLeaveRoom: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Room management panel for creating rooms, joining by ID,
 * and displaying room/opponent info.
 */
export default function RoomPanel({
  roomState,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
}: RoomPanelProps): JSX.Element {
  const [joinRoomId, setJoinRoomId] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopyRoomId = useCallback(async () => {
    if (roomState === null) return;
    try {
      await navigator.clipboard.writeText(roomState.roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  }, [roomState]);

  const handleJoinSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (joinRoomId.trim().length === 0) return;
    onJoinRoom(joinRoomId.trim());
    setJoinRoomId('');
  };

  // In a room
  if (roomState !== null) {
    return (
      <Paper variant="outlined" sx={{ p: 3, maxWidth: 360 }}>
        <Stack spacing={2}>
          <Typography variant="h6" fontWeight={600}>
            房间
          </Typography>

          {/* Room ID */}
          <Stack direction="row" alignItems="center" spacing={1}>
            <Typography variant="body2" color="text.secondary">
              ID:
            </Typography>
            <Chip
              label={roomState.roomId}
              size="small"
              variant="outlined"
              onDelete={handleCopyRoomId}
              deleteIcon={
                <Tooltip title={copied ? '已复制' : '复制'}>
                  <CopyIcon fontSize="small" />
                </Tooltip>
              }
            />
          </Stack>

          <Divider />

          {/* Opponent Info */}
          <Typography variant="subtitle2" color="text.secondary">
            对手
          </Typography>
          <Stack direction="row" alignItems="center" spacing={1}>
            <OnlineIcon
              fontSize="small"
              sx={{ color: roomState.opponentConnected ? 'success.main' : 'error.main' }}
            />
            <Typography variant="body1">{roomState.opponentName}</Typography>
            <Chip label={`Elo ${roomState.opponentElo}`} size="small" />
            {!roomState.opponentConnected && (
              <Chip label="已断线" size="small" color="warning" />
            )}
          </Stack>

          {/* Spectators */}
          {roomState.spectators.length > 0 && (
            <>
              <Divider />
              <Typography variant="subtitle2" color="text.secondary">
                观战者 ({roomState.spectators.length})
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={0.5}>
                {roomState.spectators.map((s, i) => (
                  <Chip
                    key={i}
                    icon={<SpectatorIcon />}
                    label={s}
                    size="small"
                    variant="outlined"
                  />
                ))}
              </Stack>
            </>
          )}

          <Button variant="outlined" color="error" onClick={onLeaveRoom} fullWidth>
            离开房间
          </Button>
        </Stack>
      </Paper>
    );
  }

  // Not in a room — show create/join options
  return (
    <Paper variant="outlined" sx={{ p: 3, maxWidth: 360 }}>
      <Stack spacing={3}>
        <Typography variant="h6" fontWeight={600}>
          好友对战
        </Typography>

        {/* Create Room */}
        <Button
          variant="contained"
          size="large"
          startIcon={<CreateIcon />}
          onClick={onCreateRoom}
          fullWidth
        >
          创建房间
        </Button>

        <Divider>
          <Typography variant="caption" color="text.disabled">
            或
          </Typography>
        </Divider>

        {/* Join Room */}
        <Box component="form" onSubmit={handleJoinSubmit}>
          <Stack spacing={1.5}>
            <Typography variant="subtitle2" color="text.secondary">
              加入已有房间
            </Typography>
            <TextField
              size="small"
              placeholder="输入房间 ID"
              value={joinRoomId}
              onChange={(e) => setJoinRoomId(e.target.value)}
              fullWidth
              inputProps={{ maxLength: 16 }}
            />
            <Button
              type="submit"
              variant="outlined"
              startIcon={<JoinIcon />}
              disabled={joinRoomId.trim().length === 0}
              fullWidth
            >
              加入
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
}
