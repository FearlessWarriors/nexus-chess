import React, { useState, useCallback, useMemo } from 'react';
import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  Box,
} from '@mui/material';
import AppShell, { type NavPage } from './AppShell';
import GamePage, { type GameMode } from './GamePage';
import TutorialPanel from './TutorialPanel';
import LeaderboardPanel from './LeaderboardPanel';
import TournamentPanel from './TournamentPanel';
import SpectatePanel from './SpectatePanel';
import HomePage from './HomePage';
import AdminPanel from './AdminPanel';
import { AuthProvider } from '../auth/AuthContext';

// ─── Theme ────────────────────────────────────────────────────────────────────

const lichessTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#629924' },
    secondary: { main: '#90caf9' },
    background: { default: '#161616', paper: '#1e1e1e' },
    text: {
      primary: '#bababa',
      secondary: '#888888',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Noto Sans SC", sans-serif',
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 4,
        },
      },
    },
  },
});

// ─── Page Router ──────────────────────────────────────────────────────────────

type AppPage =
  | 'home'
  | 'local'
  | 'ai'
  | 'online'
  | 'tutorial'
  | 'leaderboard'
  | 'tournament'
  | 'spectate'
  | 'admin';

// ─── App Root ─────────────────────────────────────────────────────────────────

function AppContent(): JSX.Element {
  const [navPage, setNavPage] = useState<NavPage>('local');
  const [appPage, setAppPage] = useState<AppPage>('home');

  const handleNavigate = useCallback((page: NavPage) => {
    setNavPage(page);
    setAppPage(page as AppPage);
  }, []);

  const handleBack = useCallback(() => {
    setAppPage('home');
  }, []);

  const currentContent = useMemo((): JSX.Element => {
    switch (appPage) {
      case 'home':
        return <HomePage onNavigate={handleNavigate} />;
      case 'local':
        return <GamePage mode="local" onBack={handleBack} />;
      case 'ai':
        return <GamePage mode="ai" onBack={handleBack} />;
      case 'online':
        return <GamePage mode="online" onBack={handleBack} />;
      case 'tutorial':
        return <TutorialPanel onBack={handleBack} />;
      case 'leaderboard':
        return <LeaderboardPanel onBack={handleBack} />;
      case 'tournament':
        return <TournamentPanel onBack={handleBack} />;
      case 'spectate':
        return <SpectatePanel onBack={handleBack} />;
      case 'admin':
        return <AdminPanel />;
      default:
        return <HomePage onNavigate={handleNavigate} />;
    }
  }, [appPage, handleNavigate, handleBack]);

  return (
    <ThemeProvider theme={lichessTheme}>
      <CssBaseline />
      {appPage === 'home' ? (
        /* HomePage has its own layout (three-column) */
        <Box sx={{ minHeight: '100vh', bgcolor: '#161616' }}>
          {currentContent}
        </Box>
      ) : (
        /* All other pages use AppShell with sidebar */
        <AppShell currentPage={navPage} onNavigate={handleNavigate}>
          {currentContent}
        </AppShell>
      )}
    </ThemeProvider>
  );
}

export default function App(): JSX.Element {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
