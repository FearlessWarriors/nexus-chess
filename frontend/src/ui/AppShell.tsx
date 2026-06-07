import React, { useState, useCallback } from 'react';
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  IconButton,
  useMediaQuery,
  useTheme,
  BottomNavigation,
  BottomNavigationAction,
  Paper,
  Typography,
  Stack,
} from '@mui/material';
import {
  SportsEsports as LocalIcon,
  SmartToy as AiIcon,
  Public as OnlineIcon,
  School as TutorialIcon,
  Leaderboard as LeaderboardIcon,
  EmojiEvents as TrophyIcon,
  LiveTv as SpectateIcon,
  Menu as MenuIcon,
  AdminPanelSettings as AdminIcon,
  AccountCircle as ProfileIcon,
} from '@mui/icons-material';
import { useAuth } from '../auth/AuthContext';
import BadgeChip, { type BadgeType } from './BadgeChip';
import ProfileDialog from './ProfileDialog';

// ─── Nav Item Definition ──────────────────────────────────────────────────────

export interface NavItem {
  id: string;
  label: string;
  description: string;
  icon: React.ReactElement;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'local', label: '对弈', description: '开始一局新游戏', icon: <LocalIcon /> },
  { id: 'ai', label: 'AI 对战', description: '与智能引擎对弈', icon: <AiIcon /> },
  { id: 'online', label: '在线对战', description: '匹配真实玩家', icon: <OnlineIcon /> },
  { id: 'tutorial', label: '教程', description: '学习游戏规则', icon: <TutorialIcon /> },
  { id: 'leaderboard', label: '排行榜', description: '查看全球排名', icon: <LeaderboardIcon /> },
  { id: 'tournament', label: '锦标赛', description: '瑞士轮赛事', icon: <TrophyIcon /> },
  { id: 'spectate', label: '观战', description: '观看实时对局', icon: <SpectateIcon /> },
];

// ─── Props ────────────────────────────────────────────────────────────────────

export type NavPage =
  | 'local'
  | 'ai'
  | 'online'
  | 'tutorial'
  | 'leaderboard'
  | 'tournament'
  | 'spectate'
  | 'admin';

interface AppShellProps {
  currentPage: NavPage;
  onNavigate: (page: NavPage) => void;
  children: React.ReactNode;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DRAWER_WIDTH_COLLAPSED = 72;
const DRAWER_WIDTH_EXPANDED = 260;

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Lichess-style AppShell with:
 *  - Left icon sidebar (collapsible on desktop, bottom nav on mobile)
 *  - Dark theme (#161616 background)
 *  - Green accent (#629924)
 *  - Badge display next to username
 *  - Admin panel access
 */
export default function AppShell({
  currentPage,
  onNavigate,
  children,
}: AppShellProps): JSX.Element {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const { user, isLoggedIn } = useAuth();

  const handleNav = useCallback(
    (page: string) => {
      onNavigate(page as NavPage);
      if (isMobile) {
        setSidebarOpen(false);
      }
    },
    [onNavigate, isMobile],
  );

  // Compute badge info for current user
  const userBadgeType: BadgeType = user?.is_admin
    ? 'admin'
    : (user?.badge_type as BadgeType) || '';
  const userBadgeText = user?.badge_text ?? '';

  return (
    <Box
      sx={{
        minHeight: '100vh',
        bgcolor: '#161616',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* ── Top Bar ──────────────────────────────────────────────────────── */}
      <Box
        component="header"
        sx={{
          height: 48,
          bgcolor: '#1a1a1a',
          borderBottom: '1px solid #2a2a2a',
          display: 'flex',
          alignItems: 'center',
          px: 2,
          gap: 1.5,
          flexShrink: 0,
        }}
      >
        {isMobile && (
          <IconButton
            size="small"
            onClick={() => setSidebarOpen((o) => !o)}
            sx={{ color: '#999' }}
          >
            <MenuIcon fontSize="small" />
          </IconButton>
        )}
        <Typography
          variant="subtitle1"
          sx={{
            color: '#ccc',
            fontWeight: 700,
            fontSize: '0.95rem',
            letterSpacing: 0.5,
          }}
        >
          ⚛️ Nexus · 核心棋
        </Typography>
        <Box sx={{ flexGrow: 1 }} />

        {/* User info area */}
        {isLoggedIn && user !== null && (
          <Stack direction="row" alignItems="center" spacing={0.8}>
            {/* Badge */}
            {userBadgeType !== '' && (
              <BadgeChip badgeType={userBadgeType} badgeText={userBadgeText} size="small" />
            )}
            {/* Username — clickable */}
            <Box
              onClick={() => setProfileOpen(true)}
              sx={{
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                '&:hover': { opacity: 0.8 },
              }}
            >
              <ProfileIcon sx={{ fontSize: 14, color: '#888' }} />
              <Typography
                variant="caption"
                sx={{
                  color: user.is_admin ? '#FFD700' : '#ccc',
                  fontWeight: 600,
                  fontSize: '0.75rem',
                  maxWidth: 120,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {user.name}
              </Typography>
            </Box>
            {/* Admin nav button */}
            {user.is_admin && (
              <Tooltip title="管理面板">
                <IconButton
                  size="small"
                  onClick={() => onNavigate('admin')}
                  sx={{
                    color: currentPage === 'admin' ? '#FFD700' : '#888',
                    '&:hover': { color: '#FFD700' },
                  }}
                >
                  <AdminIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        )}

        <Typography
          variant="caption"
          sx={{ color: '#555', fontSize: '0.7rem' }}
        >
          v1.0.0
        </Typography>
      </Box>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Desktop sidebar */}
        {!isMobile && (
          <DesktopSidebar
            currentPage={currentPage}
            onNavigate={handleNav}
            isAdmin={user?.is_admin === true}
          />
        )}

        {/* Mobile drawer */}
        {isMobile && (
          <Drawer
            anchor="left"
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            PaperProps={{
              sx: {
                bgcolor: '#1a1a1a',
                width: DRAWER_WIDTH_EXPANDED,
                borderRight: '1px solid #2a2a2a',
              },
            }}
          >
            <SidebarContent
              currentPage={currentPage}
              onNavigate={handleNav}
              isAdmin={user?.is_admin === true}
            />
          </Drawer>
        )}

        {/* Main content */}
        <Box
          component="main"
          sx={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            p: { xs: 1.5, md: 2 },
          }}
        >
          {children}
        </Box>
      </Box>

      {/* Mobile bottom nav */}
      {isMobile && (
        <Paper
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1100,
            bgcolor: '#1a1a1a',
            borderTop: '1px solid #2a2a2a',
            borderRadius: 0,
          }}
          elevation={4}
        >
          <BottomNavigation
            value={currentPage}
            onChange={(_e, val) => onNavigate(val as NavPage)}
            sx={{
              bgcolor: 'transparent',
              height: 56,
              '& .MuiBottomNavigationAction-root': {
                color: '#666',
                minWidth: 0,
                padding: '6px 0',
              },
              '& .Mui-selected': {
                color: '#629924',
              },
            }}
          >
            {NAV_ITEMS.slice(0, 5).map((item) => (
              <BottomNavigationAction
                key={item.id}
                label={item.label}
                value={item.id}
                icon={item.icon}
                sx={{
                  '& .MuiBottomNavigationAction-label': {
                    fontSize: '0.6rem',
                  },
                }}
              />
            ))}
          </BottomNavigation>
        </Paper>
      )}

      {/* Spacer for mobile bottom nav */}
      {isMobile && <Box sx={{ height: 56 }} />}

      {/* Profile Dialog */}
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />
    </Box>
  );
}

// ─── Desktop Sidebar ──────────────────────────────────────────────────────────

function DesktopSidebar({
  currentPage,
  onNavigate,
  isAdmin,
}: {
  currentPage: string;
  onNavigate: (page: string) => void;
  isAdmin: boolean;
}): JSX.Element {
  const [hovered, setHovered] = useState(false);

  return (
    <Box
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{
        width: hovered ? DRAWER_WIDTH_EXPANDED : DRAWER_WIDTH_COLLAPSED,
        transition: 'width 0.2s ease',
        bgcolor: '#1a1a1a',
        borderRight: '1px solid #2a2a2a',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <SidebarContent currentPage={currentPage} onNavigate={onNavigate} isAdmin={isAdmin} />
    </Box>
  );
}

// ─── Sidebar Content ──────────────────────────────────────────────────────────

function SidebarContent({
  currentPage,
  onNavigate,
  isAdmin,
}: {
  currentPage: string;
  onNavigate: (page: string) => void;
  isAdmin: boolean;
}): JSX.Element {
  const allItems = isAdmin
    ? [...NAV_ITEMS, { id: 'admin', label: '管理', description: '管理员面板', icon: <AdminIcon /> }]
    : NAV_ITEMS;

  return (
    <List sx={{ py: 1, width: DRAWER_WIDTH_EXPANDED }}>
      {allItems.map((item) => {
        const active = currentPage === item.id;
        const isAdminItem = item.id === 'admin';
        return (
          <Tooltip key={item.id} title={item.description} placement="right" arrow>
            <ListItemButton
              onClick={() => onNavigate(item.id)}
              sx={{
                py: 1.3,
                px: 2,
                minHeight: 52,
                borderLeft: '3px solid',
                borderLeftColor: active
                  ? isAdminItem
                    ? '#FFD700'
                    : '#629924'
                  : 'transparent',
                bgcolor: active
                  ? isAdminItem
                    ? 'rgba(255,215,0,0.08)'
                    : 'rgba(98,153,36,0.08)'
                  : 'transparent',
                '&:hover': {
                  bgcolor: active
                    ? isAdminItem
                      ? 'rgba(255,215,0,0.15)'
                      : 'rgba(98,153,36,0.15)'
                    : 'rgba(255,255,255,0.04)',
                },
                transition: 'all 0.15s ease',
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 40,
                  color: active
                    ? isAdminItem
                      ? '#FFD700'
                      : '#629924'
                    : '#777',
                  '& .MuiSvgIcon-root': {
                    fontSize: 28,
                  },
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                secondary={item.description}
                primaryTypographyProps={{
                  variant: 'body2',
                  fontSize: '0.85rem',
                  fontWeight: active ? 600 : 400,
                  color: active
                    ? isAdminItem
                      ? '#FFD700'
                      : '#629924'
                    : '#999',
                  lineHeight: 1.3,
                }}
                secondaryTypographyProps={{
                  variant: 'caption',
                  fontSize: '0.68rem',
                  color: '#555',
                  lineHeight: 1.2,
                }}
              />
            </ListItemButton>
          </Tooltip>
        );
      })}
    </List>
  );
}
