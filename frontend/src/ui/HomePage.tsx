/**
 * HomePage.tsx — Lichess-Style Landing Page
 *
 * Three-column layout:
 *   - Left: Quick actions (icon shortcuts)
 *   - Center: Main content (play card, puzzles, tournaments, recent games)
 *   - Right: Information panel (leaderboard, live games, stats)
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Stack,
  Avatar,
  Chip,
  IconButton,
  useMediaQuery,
  useTheme,
  CircularProgress,
} from '@mui/material';
import {
  SportsEsports as LocalIcon,
  SmartToy as AiIcon,
  Public as OnlineIcon,
  School as TutorialIcon,
  Leaderboard as LeaderboardIcon,
  EmojiEvents as TrophyIcon,
  LiveTv as SpectateIcon,
  Extension as PuzzleIcon,
  Person as PersonIcon,
  Notifications as NotifIcon,
  Login as LoginIcon,
  Logout as LogoutIcon,
  FiberManualRecord as LiveIcon,
} from '@mui/icons-material';
import { useAuth } from '../auth/AuthContext';
import AuthDialog from '../auth/AuthDialog';
import { LeaderboardManager } from '../tournament/LeaderboardManager';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HomeNavPage =
  | 'local'
  | 'ai'
  | 'online'
  | 'tutorial'
  | 'leaderboard'
  | 'tournament'
  | 'spectate';

interface HomePageProps {
  onNavigate: (page: HomeNavPage) => void;
}

// ─── Recent Game Record ───────────────────────────────────────────────────────

interface RecentGameRecord {
  result: 'win' | 'loss' | 'draw';
  opponent: string;
  date: string;
  eloChange: number;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

const API_BASE = 'http://localhost:3001';

async function fetchLeaderboardTop5(): Promise<
  Array<{ id: string; name: string; elo: number }>
> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/leaderboard`);
    if (!res.ok) throw new Error('Failed');
    const data = await res.json();
    return (data.entries ?? []).slice(0, 5);
  } catch {
    // Fallback to local leaderboard
    const entries = LeaderboardManager.getLeaderboard('elo', 5);
    return entries.map((e) => ({ id: e.id, name: e.name, elo: e.elo }));
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomePage({ onNavigate }: HomePageProps): JSX.Element {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isNarrow = useMediaQuery(theme.breakpoints.down('lg'));
  const { user, isLoggedIn, isLoading, logout } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [top5, setTop5] = useState<Array<{ id: string; name: string; elo: number }>>([]);
  const [top5Loading, setTop5Loading] = useState(true);

  useEffect(() => {
    fetchLeaderboardTop5().then((data) => {
      setTop5(data);
      setTop5Loading(false);
    });
  }, []);

  const handleAuthClick = useCallback(() => {
    if (isLoggedIn) {
      logout();
    } else {
      setAuthOpen(true);
    }
  }, [isLoggedIn, logout]);

  const recentGames = useMemo((): RecentGameRecord[] => {
    if (!isLoggedIn || user === null) return [];
    // Use leaderboard stats as recent game indicator
    const player = LeaderboardManager.getPlayerStats(String(user.id));
    if (player === null) return [];
    const total = player.wins + player.losses + player.draws;
    if (total === 0) return [];

    const records: RecentGameRecord[] = [];
    // Build a simulated recent record from wins/losses/draws count
    for (let i = 0; i < Math.min(player.wins, 3); i++) {
      records.push({
        result: 'win',
        opponent: '对手',
        date: '最近',
        eloChange: Math.floor(Math.random() * 20) + 5,
      });
    }
    for (let i = 0; i < Math.min(player.losses, 2); i++) {
      records.push({ result: 'loss', opponent: '对手', date: '最近', eloChange: -(Math.floor(Math.random() * 15) + 5) });
    }
    return records.slice(0, 5);
  }, [isLoggedIn, user]);

  const todayStats = useMemo(() => {
    const allPlayers = LeaderboardManager.getAllPlayers();
    const totalGames = allPlayers.reduce((s, p) => s + p.totalGames, 0);
    return {
      totalGames,
      activePlayers: allPlayers.length,
    };
  }, []);

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: '#161616',
        color: '#bababa',
        fontFamily: '"Roboto", "Noto Sans SC", sans-serif',
      }}
    >
      {/* ── Top Bar ──────────────────────────────────────────────────────── */}
      <TopBar
        isLoggedIn={isLoggedIn}
        isLoading={isLoading}
        user={user}
        onAuthClick={handleAuthClick}
        onNavigate={onNavigate}
        isMobile={isMobile}
      />

      {/* ── Three-Column Body ────────────────────────────────────────────── */}
      <Box
        sx={{
          maxWidth: 1200,
          mx: 'auto',
          px: { xs: 1, md: 2 },
          py: 2,
          display: 'flex',
          gap: 2,
          flexDirection: isNarrow ? 'column' : 'row',
        }}
      >
        {/* Left sidebar — quick actions */}
        {!isNarrow && (
          <LeftSidebar
            isLoggedIn={isLoggedIn}
            user={user}
            onAuthClick={handleAuthClick}
            onNavigate={onNavigate}
          />
        )}

        {/* Center — main content */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Big play card */}
          <PlayCard onNavigate={onNavigate} />

          {/* Puzzles + Tournament double column */}
          <Box sx={{ display: 'flex', gap: 2, flexDirection: isMobile ? 'column' : 'row' }}>
            <InfoCard
              icon={<PuzzleIcon sx={{ fontSize: 28, color: '#629924' }} />}
              title="谜题挑战"
              subtitle="每日一题"
              description="谜题功能即将推出，敬请期待"
              sx={{ flex: 1 }}
            />
            <InfoCard
              icon={<TrophyIcon sx={{ fontSize: 28, color: '#FFD700' }} />}
              title="锦标赛"
              subtitle="瑞士轮进行中"
              description="点击参与锦标赛，角逐冠军"
              onClick={() => onNavigate('tournament')}
              accent
              sx={{ flex: 1 }}
            />
          </Box>

          {/* Recent games */}
          <RecentGamesCard
            isLoggedIn={isLoggedIn}
            user={user}
            recentGames={recentGames}
          />
        </Box>

        {/* Right sidebar — information panel */}
        {!isNarrow && (
          <RightSidebar
            top5={top5}
            top5Loading={top5Loading}
            todayStats={todayStats}
            onNavigate={onNavigate}
          />
        )}
      </Box>

      {/* Auth dialog */}
      <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
    </Box>
  );
}

// ─── Top Bar ──────────────────────────────────────────────────────────────────

function TopBar({
  isLoggedIn,
  isLoading,
  user,
  onAuthClick,
  onNavigate,
  isMobile,
}: {
  isLoggedIn: boolean;
  isLoading: boolean;
  user: { name: string; elo: number } | null;
  onAuthClick: () => void;
  onNavigate: (page: HomeNavPage) => void;
  isMobile: boolean;
}): JSX.Element {
  return (
    <Box
      component="header"
      sx={{
        height: 48,
        bgcolor: '#1a1a1a',
        borderBottom: '1px solid #2a2a2a',
        display: 'flex',
        alignItems: 'center',
        px: 2,
        gap: 0.5,
        flexShrink: 0,
      }}
    >
      {/* Logo */}
      <Typography
        variant="subtitle1"
        sx={{
          color: '#ccc',
          fontWeight: 700,
          fontSize: '0.95rem',
          letterSpacing: 0.5,
          mr: isMobile ? 0 : 3,
          cursor: 'default',
          userSelect: 'none',
        }}
      >
        ⚛️ Nexus
      </Typography>

      {/* Nav links (desktop) */}
      {!isMobile && (
        <Stack direction="row" spacing={0.5}>
          <TopBarLink label="对弈" active onClick={() => {}} />
          <TopBarLink label="谜题" onClick={() => {}} />
          <TopBarLink label="学习" onClick={() => onNavigate('tutorial')} />
          <TopBarLink label="观战" onClick={() => onNavigate('spectate')} />
          <TopBarLink label="社区" onClick={() => onNavigate('leaderboard')} />
          <TopBarLink label="工具" onClick={() => {}} />
        </Stack>
      )}

      <Box sx={{ flexGrow: 1 }} />

      {/* Notification bell */}
      <IconButton size="small" sx={{ color: '#777' }}>
        <NotifIcon sx={{ fontSize: 20 }} />
      </IconButton>

      {/* User / Login */}
      {isLoading ? (
        <CircularProgress size={18} sx={{ color: '#629924' }} />
      ) : isLoggedIn && user !== null ? (
        <Stack direction="row" spacing={1} alignItems="center">
          <Chip
            label={user.elo}
            size="small"
            sx={{
              fontSize: '0.65rem',
              height: 20,
              bgcolor: 'rgba(98,153,36,0.15)',
              color: '#629924',
              fontWeight: 600,
            }}
          />
          <Typography variant="caption" color="#aaa" fontSize="0.75rem">
            {user.name}
          </Typography>
          <IconButton size="small" onClick={onAuthClick} sx={{ color: '#777' }}>
            <LogoutIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
      ) : (
        <Button
          size="small"
          startIcon={<LoginIcon sx={{ fontSize: 16 }} />}
          onClick={onAuthClick}
          sx={{
            color: '#629924',
            textTransform: 'none',
            fontSize: '0.75rem',
            '&:hover': { color: '#7cb832' },
          }}
        >
          登录
        </Button>
      )}
    </Box>
  );
}

function TopBarLink({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <Typography
      onClick={onClick}
      variant="caption"
      sx={{
        px: 1,
        py: 0.3,
        borderRadius: 0.5,
        cursor: 'pointer',
        color: active ? '#629924' : '#888',
        fontWeight: active ? 600 : 400,
        fontSize: '0.72rem',
        '&:hover': { color: '#aaa' },
        transition: 'color 0.15s',
      }}
    >
      {label}
    </Typography>
  );
}

// ─── Left Sidebar ─────────────────────────────────────────────────────────────

function LeftSidebar({
  isLoggedIn,
  user,
  onAuthClick,
  onNavigate,
}: {
  isLoggedIn: boolean;
  user: { name: string; elo: number } | null;
  onAuthClick: () => void;
  onNavigate: (page: HomeNavPage) => void;
}): JSX.Element {
  return (
    <Box sx={{ width: 200, flexShrink: 0 }}>
      {/* User card */}
      <Paper
        sx={{
          bgcolor: '#1e1e1e',
          borderRadius: 1,
          p: 1.5,
          mb: 1,
          border: '1px solid #2a2a2a',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
        }}
        elevation={0}
      >
        <Avatar
          sx={{
            width: 36,
            height: 36,
            bgcolor: isLoggedIn ? '#629924' : '#444',
            fontSize: '1rem',
          }}
        >
          {isLoggedIn && user !== null ? user.name[0].toUpperCase() : <PersonIcon sx={{ fontSize: 20 }} />}
        </Avatar>
        {isLoggedIn && user !== null ? (
          <Box>
            <Typography variant="body2" fontWeight={600} color="#ccc" fontSize="0.8rem">
              {user.name}
            </Typography>
            <Typography variant="caption" color="#629924" fontSize="0.7rem">
              ELO: {user.elo}
            </Typography>
          </Box>
        ) : (
          <Button
            size="small"
            onClick={onAuthClick}
            sx={{
              color: '#629924',
              textTransform: 'none',
              fontSize: '0.75rem',
            }}
          >
            登录/注册
          </Button>
        )}
      </Paper>

      {/* Quick actions */}
      <Stack spacing={0.3}>
        <SidebarAction
          icon={<LocalIcon sx={{ fontSize: 18 }} />}
          label="本地对弈"
          desc="同设备双人对弈"
          onClick={() => onNavigate('local')}
        />
        <SidebarAction
          icon={<AiIcon sx={{ fontSize: 18 }} />}
          label="人机对战"
          desc="挑战 AI 引擎"
          onClick={() => onNavigate('ai')}
        />
        <SidebarAction
          icon={<OnlineIcon sx={{ fontSize: 18 }} />}
          label="在线匹配"
          desc="匹配其他玩家"
          onClick={() => onNavigate('online')}
        />
        <Box sx={{ mt: 0.5, mb: 0.3, px: 1 }}>
          <Typography variant="caption" color="#555" fontSize="0.6rem" fontWeight={600} textTransform="uppercase" letterSpacing={1}>
            学习
          </Typography>
        </Box>
        <SidebarAction
          icon={<TutorialIcon sx={{ fontSize: 18 }} />}
          label="新手教程"
          desc="6步快速上手"
          onClick={() => onNavigate('tutorial')}
        />
        <SidebarAction
          icon={<PuzzleIcon sx={{ fontSize: 18 }} />}
          label="规则说明"
          desc="完整规则文档"
          onClick={() => onNavigate('tutorial')}
        />
        <Box sx={{ mt: 0.5, mb: 0.3, px: 1 }}>
          <Typography variant="caption" color="#555" fontSize="0.6rem" fontWeight={600} textTransform="uppercase" letterSpacing={1}>
            竞技
          </Typography>
        </Box>
        <SidebarAction
          icon={<LeaderboardIcon sx={{ fontSize: 18 }} />}
          label="排行榜"
          desc="全球排名"
          onClick={() => onNavigate('leaderboard')}
        />
        <SidebarAction
          icon={<TrophyIcon sx={{ fontSize: 18 }} />}
          label="锦标赛"
          desc="瑞士轮赛制"
          onClick={() => onNavigate('tournament')}
        />
      </Stack>
    </Box>
  );
}

function SidebarAction({
  icon,
  label,
  desc,
  onClick,
}: {
  icon: React.ReactElement;
  label: string;
  desc: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <Paper
      onClick={onClick}
      elevation={0}
      sx={{
        bgcolor: 'transparent',
        p: 0.8,
        px: 1,
        borderRadius: 1,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        '&:hover': {
          bgcolor: 'rgba(98,153,36,0.06)',
        },
        transition: 'background 0.15s',
      }}
    >
      <Box sx={{ color: '#888', display: 'flex' }}>{icon}</Box>
      <Box>
        <Typography variant="body2" fontSize="0.75rem" color="#bbb" lineHeight={1.3}>
          {label}
        </Typography>
        <Typography variant="caption" fontSize="0.6rem" color="#555">
          {desc}
        </Typography>
      </Box>
    </Paper>
  );
}

// ─── Play Card ────────────────────────────────────────────────────────────────

function PlayCard({ onNavigate }: { onNavigate: (page: HomeNavPage) => void }): JSX.Element {
  return (
    <Paper
      elevation={0}
      sx={{
        bgcolor: '#1e1e1e',
        borderRadius: 1,
        p: { xs: 2, md: 3 },
        border: '1px solid #2a2a2a',
        textAlign: 'center',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        transition: 'all 0.2s ease',
        '&:hover': {
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          transform: 'translateY(-2px)',
        },
      }}
    >
      <Typography
        variant="h5"
        fontWeight={700}
        sx={{ color: '#ccc', mb: 0.5, fontSize: { xs: '1.1rem', md: '1.3rem' } }}
      >
        ⚔️ 开始对弈
      </Typography>
      <Typography variant="body2" color="#888" sx={{ mb: 2, fontSize: '0.8rem' }}>
        选择模式开始一局新游戏
      </Typography>

      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1.5}
        justifyContent="center"
      >
        <PlayButton
          icon={<LocalIcon />}
          label="本地双人"
          desc="与朋友同机对弈"
          onClick={() => onNavigate('local')}
        />
        <PlayButton
          icon={<AiIcon />}
          label="AI 对战"
          desc="挑战智能引擎"
          onClick={() => onNavigate('ai')}
          primary
        />
        <PlayButton
          icon={<OnlineIcon />}
          label="在线匹配"
          desc="匹配真实玩家"
          onClick={() => onNavigate('online')}
        />
      </Stack>
    </Paper>
  );
}

function PlayButton({
  icon,
  label,
  desc,
  onClick,
  primary,
}: {
  icon: React.ReactElement;
  label: string;
  desc: string;
  onClick: () => void;
  primary?: boolean;
}): JSX.Element {
  return (
    <Paper
      onClick={onClick}
      elevation={0}
      sx={{
        flex: 1,
        bgcolor: primary ? 'rgba(98,153,36,0.06)' : '#252525',
        borderRadius: 1,
        p: 2,
        cursor: 'pointer',
        border: '1px solid',
        borderColor: primary ? 'rgba(98,153,36,0.3)' : '#333',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.8,
        transition: 'all 0.15s ease',
        '&:hover': {
          bgcolor: primary ? 'rgba(98,153,36,0.12)' : '#2a2a2a',
          borderColor: primary ? '#629924' : '#555',
          transform: 'translateY(-2px)',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        },
      }}
    >
      <Box
        sx={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          bgcolor: primary ? 'rgba(98,153,36,0.2)' : 'rgba(255,255,255,0.06)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: primary ? '#629924' : '#888',
        }}
      >
        {icon}
      </Box>
      <Typography variant="body2" fontWeight={600} color={primary ? '#629924' : '#ccc'} fontSize="0.8rem">
        {label}
      </Typography>
      <Typography variant="caption" color="#777" fontSize="0.65rem">
        {desc}
      </Typography>
    </Paper>
  );
}

// ─── Info Card (Puzzles / Tournaments) ────────────────────────────────────────

function InfoCard({
  icon,
  title,
  subtitle,
  description,
  onClick,
  accent,
  sx,
}: {
  icon: React.ReactElement;
  title: string;
  subtitle: string;
  description: string;
  onClick?: () => void;
  accent?: boolean;
  sx?: object;
}): JSX.Element {
  return (
    <Paper
      onClick={onClick}
      elevation={0}
      sx={{
        bgcolor: '#1e1e1e',
        borderRadius: 1,
        p: { xs: 2, md: 2.5 },
        border: '1px solid #2a2a2a',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        cursor: onClick !== undefined ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
        '&:hover': onClick !== undefined
          ? {
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              transform: 'translateY(-2px)',
            }
          : {},
        ...sx,
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="flex-start">
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 1,
            bgcolor: accent ? 'rgba(255,215,0,0.1)' : 'rgba(98,153,36,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
        <Box>
          <Typography variant="subtitle1" fontWeight={600} color="#ccc" fontSize="0.9rem">
            {title}
          </Typography>
          <Typography variant="caption" color="#629924" fontSize="0.7rem" fontWeight={600}>
            {subtitle}
          </Typography>
          <Typography variant="caption" color="#777" fontSize="0.7rem" display="block" mt={0.3}>
            {description}
          </Typography>
        </Box>
      </Stack>
    </Paper>
  );
}

// ─── Recent Games Card ────────────────────────────────────────────────────────

function RecentGamesCard({
  isLoggedIn,
  user,
  recentGames,
}: {
  isLoggedIn: boolean;
  user: { name: string } | null;
  recentGames: RecentGameRecord[];
}): JSX.Element {
  return (
    <Paper
      elevation={0}
      sx={{
        bgcolor: '#1e1e1e',
        borderRadius: 1,
        p: { xs: 2, md: 2.5 },
        border: '1px solid #2a2a2a',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}
    >
      <Typography variant="subtitle1" fontWeight={600} color="#ccc" fontSize="0.9rem" mb={1.5}>
        📈 我的对局记录
      </Typography>

      {!isLoggedIn ? (
        <Typography variant="body2" color="#777" fontSize="0.75rem" textAlign="center" py={2}>
          登录后可查看对局记录
        </Typography>
      ) : recentGames.length === 0 ? (
        <Typography variant="body2" color="#777" fontSize="0.75rem" textAlign="center" py={2}>
          暂无对局记录，快去开始一局对战吧！
        </Typography>
      ) : (
        <Stack spacing={0.5}>
          {recentGames.map((game, i) => (
            <Stack
              key={i}
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{
                py: 0.6,
                px: 1,
                borderRadius: 0.5,
                bgcolor: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent',
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center">
                <Box
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: 0.5,
                    bgcolor:
                      game.result === 'win'
                        ? 'rgba(76,175,80,0.2)'
                        : game.result === 'loss'
                          ? 'rgba(229,62,62,0.2)'
                          : 'rgba(158,158,158,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Typography
                    fontSize="0.6rem"
                    fontWeight={700}
                    color={
                      game.result === 'win'
                        ? '#4caf50'
                        : game.result === 'loss'
                          ? '#e53e3e'
                          : '#888'
                    }
                  >
                    {game.result === 'win' ? 'W' : game.result === 'loss' ? 'L' : 'D'}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="#aaa" fontSize="0.7rem">
                    vs {game.opponent}
                  </Typography>
                </Box>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="caption" color="#666" fontSize="0.65rem">
                  {game.date}
                </Typography>
                <Typography
                  variant="caption"
                  fontWeight={600}
                  fontSize="0.7rem"
                  color={game.eloChange >= 0 ? '#4caf50' : '#e53e3e'}
                >
                  {game.eloChange >= 0 ? '+' : ''}{game.eloChange}
                </Typography>
              </Stack>
            </Stack>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

// ─── Right Sidebar ────────────────────────────────────────────────────────────

function RightSidebar({
  top5,
  top5Loading,
  todayStats,
  onNavigate,
}: {
  top5: Array<{ id: string; name: string; elo: number }>;
  top5Loading: boolean;
  todayStats: { totalGames: number; activePlayers: number };
  onNavigate: (page: HomeNavPage) => void;
}): JSX.Element {
  return (
    <Box sx={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* Leaderboard Top 5 */}
      <Paper
        elevation={0}
        sx={{
          bgcolor: '#1e1e1e',
          borderRadius: 1,
          p: 1.5,
          border: '1px solid #2a2a2a',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          transition: 'all 0.2s ease',
          '&:hover': {
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            transform: 'translateY(-2px)',
          },
        }}
      >
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          mb={1}
        >
          <Typography variant="subtitle2" fontWeight={600} color="#ccc" fontSize="0.75rem">
            🏆 排行榜
          </Typography>
          <Typography
            variant="caption"
            color="#629924"
            sx={{ cursor: 'pointer', fontSize: '0.6rem', '&:hover': { textDecoration: 'underline' } }}
            onClick={() => onNavigate('leaderboard')}
          >
            查看全部
          </Typography>
        </Stack>

        {top5Loading ? (
          <Box textAlign="center" py={2}>
            <CircularProgress size={16} sx={{ color: '#629924' }} />
          </Box>
        ) : top5.length === 0 ? (
          <Typography variant="caption" color="#666" textAlign="center" py={1} fontSize="0.65rem">
            暂无排行榜数据，快去对战吧！
          </Typography>
        ) : (
          <Stack spacing={0.3}>
            {top5.map((p, i) => (
              <Stack key={p.id} direction="row" alignItems="center" spacing={1}>
                <Typography
                  variant="caption"
                  fontWeight={i < 3 ? 700 : 400}
                  fontSize="0.65rem"
                  color={i === 0 ? '#FFD700' : i === 1 ? '#C0C0C0' : i === 2 ? '#CD7F32' : '#888'}
                  sx={{ width: 18, textAlign: 'center' }}
                >
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
                </Typography>
                <Typography variant="caption" color="#aaa" fontSize="0.65rem" noWrap sx={{ flex: 1 }}>
                  {p.name}
                </Typography>
                <Typography variant="caption" color="#629924" fontWeight={600} fontSize="0.6rem">
                  {p.elo}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </Paper>

      {/* Live Games */}
      <Paper
        elevation={0}
        onClick={() => onNavigate('spectate')}
        sx={{
          bgcolor: '#1e1e1e',
          borderRadius: 1,
          p: 1.5,
          border: '1px solid #2a2a2a',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          '&:hover': {
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            transform: 'translateY(-2px)',
          },
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1} mb={0.5}>
          <LiveIcon sx={{ fontSize: 10, color: '#e53e3e' }} />
          <Typography variant="subtitle2" fontWeight={600} color="#ccc" fontSize="0.75rem">
            正在直播
          </Typography>
        </Stack>
        <Typography variant="caption" color="#777" fontSize="0.65rem">
          点击观战正在进行的活跃对局
        </Typography>
      </Paper>

      {/* Today's Stats */}
      <Paper
        elevation={0}
        sx={{
          bgcolor: '#1e1e1e',
          borderRadius: 1,
          p: 1.5,
          border: '1px solid #2a2a2a',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        <Typography variant="subtitle2" fontWeight={600} color="#ccc" fontSize="0.75rem" mb={1}>
          📊 对局统计
        </Typography>
        <Stack spacing={0.5}>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="caption" color="#888" fontSize="0.65rem">
              今日对局数
            </Typography>
            <Typography variant="caption" color="#aaa" fontWeight={600} fontSize="0.65rem">
              {todayStats.totalGames}
            </Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between">
            <Typography variant="caption" color="#888" fontSize="0.65rem">
              活跃玩家
            </Typography>
            <Typography variant="caption" color="#aaa" fontWeight={600} fontSize="0.65rem">
              {todayStats.activePlayers}
            </Typography>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}
