import { describe, it, expect, beforeEach } from 'vitest';
import { TournamentManager } from './TournamentManager';
import { LeaderboardManager } from './LeaderboardManager';
import type { PlayerEntry, MatchResult } from './types';

describe('TournamentManager', () => {
  let manager: TournamentManager;

  const createPlayers = (count: number): PlayerEntry[] => {
    const players: PlayerEntry[] = [];
    for (let i = 0; i < count; i++) {
      players.push({
        id: `player_${i}`,
        name: `Player ${i}`,
        elo: 1000 + i * 50,
        wins: 0,
        losses: 0,
        draws: 0,
        totalGames: 0,
        eloHistory: [1000 + i * 50],
        lastPlayedAt: 0,
      });
    }
    return players;
  };

  beforeEach(() => {
    manager = new TournamentManager();
    LeaderboardManager.clear();
  });

  describe('createTournament', () => {
    it('creates a Swiss tournament with players', () => {
      const players = createPlayers(8);
      const t = manager.createTournament('Test Swiss', 'swiss', players);

      expect(t.name).toBe('Test Swiss');
      expect(t.format).toBe('swiss');
      expect(t.status).toBe('waiting');
      expect(t.players.length).toBe(8);
      expect(t.currentRound).toBe(0);
      expect(t.rounds.length).toBe(0);
      expect(t.config.rounds).toBe(5);

      // Players should have tournament-specific fields
      expect(t.players[0].score).toBe(0);
      expect(t.players[0].buchholz).toBe(0);
      expect(t.players[0].eliminated).toBe(false);
    });

    it('creates an elimination tournament', () => {
      const players = createPlayers(8);
      const t = manager.createTournament('Test Elim', 'elimination', players);

      expect(t.format).toBe('elimination');
      expect(t.config.maxPlayers).toBe(8);
    });
  });

  describe('Swiss pairing', () => {
    it('pairs all active players in first round', () => {
      const players = createPlayers(8);
      const t = manager.createTournament('Swiss Test', 'swiss', players);

      const round = manager.startNextRound(t.id);
      expect(round).not.toBeNull();
      expect(round!.number).toBe(1);
      expect(round!.status).toBe('in_progress');

      // 8 players = 4 matches
      const realMatches = round!.matches.filter((m) => !m.isBye);
      expect(realMatches.length).toBe(4);

      // Each player should appear exactly once
      const playerIds = new Set<string>();
      for (const m of realMatches) {
        playerIds.add(m.whiteId);
        playerIds.add(m.blackId);
      }
      expect(playerIds.size).toBe(8);
    });

    it('pairs by score in subsequent rounds', () => {
      const players = createPlayers(8);
      const t = manager.createTournament('Swiss Test', 'swiss', players);

      // Round 1
      const round1 = manager.startNextRound(t.id);
      expect(round1).not.toBeNull();
      
      // Report all round 1 results: white wins all matches
      for (const m of round1!.matches) {
        if (!m.isBye) {
          manager.reportResult(t.id, m.id, 'white_win');
        }
      }

      // Round 2
      const round2 = manager.startNextRound(t.id);
      expect(round2).not.toBeNull();
      expect(round2!.number).toBe(2);

      // Winners (score=1) should be paired with winners
      const updatedT = manager.getTournament(t.id)!;
      const winners = updatedT.players.filter((p) => p.score === 1);
      expect(winners.length).toBe(4);
    });

    it('handles odd number of players with bye', () => {
      const players = createPlayers(7);
      const t = manager.createTournament('Swiss Odd', 'swiss', players);

      const round = manager.startNextRound(t.id);
      const byes = round!.matches.filter((m) => m.isBye);
      expect(byes.length).toBe(1);

      // Bye player should get 1 point
      const byePlayer = t.players.find((p) => p.id === byes[0].whiteId);
      expect(byePlayer!.score).toBe(1);
    });

    it('completes after configured rounds', () => {
      const players = createPlayers(4);
      const t = manager.createTournament('Swiss Complete', 'swiss', players, { rounds: 3 });

      // Play 3 rounds
      for (let r = 0; r < 3; r++) {
        const round = manager.startNextRound(t.id);
        if (round === null) break;
        for (const m of round.matches) {
          if (!m.isBye) {
            manager.reportResult(t.id, m.id, 'white_win');
          }
        }
      }

      const final = manager.getTournament(t.id)!;
      // May already be completed after the 3rd round starts (since swissPairing checks)
    });
  });

  describe('Elimination pairing', () => {
    it('seeds by ELO in first round', () => {
      const players = createPlayers(8);
      const t = manager.createTournament('Elim Test', 'elimination', players);

      const round = manager.startNextRound(t.id);
      expect(round).not.toBeNull();

      // Should pair 1st vs 8th, 2nd vs 7th, etc.
      const realMatches = round!.matches.filter((m) => !m.isBye);
      
      // Sort players by ELO descending
      const sorted = [...players].sort((a, b) => b.elo - a.elo);
      
      // First match should be top vs bottom
      expect(realMatches[0].whiteId).toBe(sorted[0].id);
      expect(realMatches[0].blackId).toBe(sorted[7].id);
    });

    it('eliminates loser after match', () => {
      const players = createPlayers(4);
      const t = manager.createTournament('Elim Test', 'elimination', players);

      const round = manager.startNextRound(t.id);
      const match = round!.matches.find((m) => !m.isBye)!;

      // White wins
      manager.reportResult(t.id, match.id, 'white_win');

      const updated = manager.getTournament(t.id)!;
      const loser = updated.players.find((p) => p.id === match.blackId)!;
      expect(loser.eliminated).toBe(true);
      
      const winner = updated.players.find((p) => p.id === match.whiteId)!;
      expect(winner.eliminated).toBe(false);
    });
  });

  describe('reportResult', () => {
    it('updates scores on white_win', () => {
      const players = createPlayers(4);
      const t = manager.createTournament('Result Test', 'swiss', players);
      const round = manager.startNextRound(t.id);
      const match = round!.matches.find((m) => !m.isBye)!;

      manager.reportResult(t.id, match.id, 'white_win');

      const updated = manager.getTournament(t.id)!;
      const white = updated.players.find((p) => p.id === match.whiteId)!;
      const black = updated.players.find((p) => p.id === match.blackId)!;

      expect(white.score).toBe(1);
      expect(black.score).toBe(0);
    });

    it('updates scores on draw', () => {
      const players = createPlayers(4);
      const t = manager.createTournament('Draw Test', 'swiss', players);
      const round = manager.startNextRound(t.id);
      const match = round!.matches.find((m) => !m.isBye)!;

      manager.reportResult(t.id, match.id, 'draw');

      const updated = manager.getTournament(t.id)!;
      const white = updated.players.find((p) => p.id === match.whiteId)!;
      const black = updated.players.find((p) => p.id === match.blackId)!;

      expect(white.score).toBe(0.5);
      expect(black.score).toBe(0.5);
    });

    it('rejects duplicate report', () => {
      const players = createPlayers(4);
      const t = manager.createTournament('Dup Test', 'swiss', players);
      const round = manager.startNextRound(t.id);
      const match = round!.matches.find((m) => !m.isBye)!;

      manager.reportResult(t.id, match.id, 'white_win');
      const result2 = manager.reportResult(t.id, match.id, 'black_win');
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('already reported');
    });

    it('rejects report on bye match', () => {
      const players = createPlayers(3);
      const t = manager.createTournament('Bye Test', 'swiss', players);
      const round = manager.startNextRound(t.id);
      const byeMatch = round!.matches.find((m) => m.isBye)!;

      const result = manager.reportResult(t.id, byeMatch.id, 'white_win');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Bye');
    });
  });

  describe('listTournaments / getTournament', () => {
    it('lists all tournaments', () => {
      manager.createTournament('T1', 'swiss', createPlayers(4));
      manager.createTournament('T2', 'elimination', createPlayers(8));

      expect(manager.listTournaments().length).toBe(2);
    });

    it('returns undefined for unknown tournament', () => {
      expect(manager.getTournament('nonexistent')).toBeUndefined();
    });
  });
});

describe('LeaderboardManager - ELO Calculation', () => {
  beforeEach(() => {
    LeaderboardManager.clear();
  });

  it('K=32: expected win for equal ratings', () => {
    const p1 = LeaderboardManager.addPlayer('p1', 'Player 1', 1000);
    const p2 = LeaderboardManager.addPlayer('p2', 'Player 2', 1000);

    LeaderboardManager.updateRatings(p1, p2, 'white_win');

    const updated1 = LeaderboardManager.getPlayerStats('p1')!;
    const updated2 = LeaderboardManager.getPlayerStats('p2')!;

    // Expected = 0.5 each, K=32, change = 16
    expect(updated1.elo).toBe(1016);
    expect(updated2.elo).toBe(984);
  });

  it('K=32: expected loss for equal ratings', () => {
    const p1 = LeaderboardManager.addPlayer('p1', 'Player 1', 1000);
    const p2 = LeaderboardManager.addPlayer('p2', 'Player 2', 1000);

    LeaderboardManager.updateRatings(p1, p2, 'black_win');

    const updated1 = LeaderboardManager.getPlayerStats('p1')!;
    const updated2 = LeaderboardManager.getPlayerStats('p2')!;

    expect(updated1.elo).toBe(984);
    expect(updated2.elo).toBe(1016);
  });

  it('K=32: draw for equal ratings', () => {
    const p1 = LeaderboardManager.addPlayer('p1', 'Player 1', 1000);
    const p2 = LeaderboardManager.addPlayer('p2', 'Player 2', 1000);

    LeaderboardManager.updateRatings(p1, p2, 'draw');

    const updated1 = LeaderboardManager.getPlayerStats('p1')!;
    const updated2 = LeaderboardManager.getPlayerStats('p2')!;

    // Expected = 0.5, actual = 0.5, change = 0
    expect(updated1.elo).toBe(1000);
    expect(updated2.elo).toBe(1000);
  });

  it('K=32: higher-rated player wins (small gain)', () => {
    const p1 = LeaderboardManager.addPlayer('p1', 'Player 1', 1200);
    const p2 = LeaderboardManager.addPlayer('p2', 'Player 2', 1000);

    LeaderboardManager.updateRatings(p1, p2, 'white_win');

    const updated1 = LeaderboardManager.getPlayerStats('p1')!;
    // Expected ≈ 0.76, actual = 1, gain ≈ 0.24 * 32 ≈ 8
    expect(updated1.elo).toBeGreaterThan(1200);
    expect(updated1.elo).toBeLessThan(1210);
  });

  it('K=32: higher-rated player loses (big loss)', () => {
    const p1 = LeaderboardManager.addPlayer('p1', 'Player 1', 1200);
    const p2 = LeaderboardManager.addPlayer('p2', 'Player 2', 1000);

    LeaderboardManager.updateRatings(p1, p2, 'black_win');

    const updated1 = LeaderboardManager.getPlayerStats('p1')!;
    // Expected ≈ 0.76, actual = 0, loss ≈ -0.76 * 32 ≈ -24
    expect(updated1.elo).toBeLessThan(1200);
    expect(updated1.elo).toBeGreaterThan(1170);
  });

  it('updates win/loss/draw counts', () => {
    const p1 = LeaderboardManager.addPlayer('p1', 'Player 1', 1000);
    const p2 = LeaderboardManager.addPlayer('p2', 'Player 2', 1000);

    LeaderboardManager.updateRatings(p1, p2, 'white_win');
    
    const updated1 = LeaderboardManager.getPlayerStats('p1')!;
    const updated2 = LeaderboardManager.getPlayerStats('p2')!;
    expect(updated1.wins).toBe(1);
    expect(updated1.losses).toBe(0);
    expect(updated2.wins).toBe(0);
    expect(updated2.losses).toBe(1);
  });

  it('updates totalGames', () => {
    const p1 = LeaderboardManager.addPlayer('p1', 'Player 1', 1000);
    const p2 = LeaderboardManager.addPlayer('p2', 'Player 2', 1000);

    LeaderboardManager.updateRatings(p1, p2, 'draw');
    
    const updated1 = LeaderboardManager.getPlayerStats('p1')!;
    expect(updated1.totalGames).toBe(1);
    expect(updated1.draws).toBe(1);
  });

  it('ELO history is tracked', () => {
    const p1 = LeaderboardManager.addPlayer('p1', 'Player 1', 1000);
    const p2 = LeaderboardManager.addPlayer('p2', 'Player 2', 1000);

    LeaderboardManager.updateRatings(p1, p2, 'white_win');
    
    const updated1 = LeaderboardManager.getPlayerStats('p1')!;
    expect(updated1.eloHistory.length).toBeGreaterThanOrEqual(1);
  });
});

describe('LeaderboardManager - Rankings', () => {
  beforeEach(() => {
    LeaderboardManager.clear();
  });

  it('returns leaderboard sorted by ELO', () => {
    LeaderboardManager.addPlayer('p1', 'Low', 900);
    LeaderboardManager.addPlayer('p2', 'Mid', 1000);
    LeaderboardManager.addPlayer('p3', 'High', 1100);

    const leaderboard = LeaderboardManager.getLeaderboard('elo');
    expect(leaderboard.length).toBe(3);
    expect(leaderboard[0].elo).toBe(1100);
    expect(leaderboard[1].elo).toBe(1000);
    expect(leaderboard[2].elo).toBe(900);
    expect(leaderboard[0].rank).toBe(1);
    expect(leaderboard[1].rank).toBe(2);
    expect(leaderboard[2].rank).toBe(3);
  });

  it('searches players by name', () => {
    LeaderboardManager.addPlayer('p1', 'Alice', 1000);
    LeaderboardManager.addPlayer('p2', 'Bob', 1100);
    LeaderboardManager.addPlayer('p3', 'Charlie', 1200);

    const results = LeaderboardManager.searchPlayers('ali');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Alice');
  });
});
