import {
  PlayerEntry,
  LeaderboardEntry,
  LeaderboardSortBy,
  MatchResult,
} from './types';

// ─── ELO Constants ───────────────────────────────────────────────────────────

/** Standard K-factor for ELO calculation */
const K_FACTOR = 32;

/** Default starting ELO for new players */
const DEFAULT_ELO = 1000;

/** Max ELO history entries to retain */
const MAX_ELO_HISTORY = 20;

// ─── Local Storage Key ───────────────────────────────────────────────────────

const STORAGE_KEY = 'nexus-chess-leaderboard';

// ─── Leaderboard Manager ─────────────────────────────────────────────────────

export class LeaderboardManager {
  private static players: Map<string, PlayerEntry> = new Map();
  private static initialized = false;

  // ── Initialization ──────────────────────────────────────────────────────

  /** Load persisted data from localStorage */
  static load(): void {
    if (LeaderboardManager.initialized) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const data: PlayerEntry[] = JSON.parse(raw);
        for (const entry of data) {
          LeaderboardManager.players.set(entry.id, entry);
        }
      }
    } catch {
      // Corrupted data — start fresh
    }
    LeaderboardManager.initialized = true;
  }

  /** Persist current state to localStorage */
  private static save(): void {
    try {
      const data = Array.from(LeaderboardManager.players.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage full or unavailable
    }
  }

  // ── Player Management ───────────────────────────────────────────────────

  /**
   * Get or create a player entry.
   */
  static getOrCreatePlayer(id: string, name: string): PlayerEntry {
    LeaderboardManager.load();
    let player = LeaderboardManager.players.get(id);
    if (player === undefined) {
      player = {
        id,
        name,
        elo: DEFAULT_ELO,
        wins: 0,
        losses: 0,
        draws: 0,
        totalGames: 0,
        eloHistory: [DEFAULT_ELO],
        lastPlayedAt: 0,
      };
      LeaderboardManager.players.set(id, player);
      LeaderboardManager.save();
    }
    return player;
  }

  /**
   * Get player stats. Returns null if player not found.
   */
  static getPlayerStats(id: string): PlayerEntry | null {
    LeaderboardManager.load();
    return LeaderboardManager.players.get(id) ?? null;
  }

  /**
   * Sync player ELO and name from server leaderboard data.
   * Called periodically by LeaderboardPanel to keep local cache in sync.
   */
  static updateFromServer(id: string, name: string, elo: number): void {
    LeaderboardManager.load();
    const existing = LeaderboardManager.players.get(id);
    if (existing !== undefined) {
      // Only update if server ELO differs (server is authoritative)
      if (existing.elo !== elo) {
        existing.eloHistory.push(elo);
        if (existing.eloHistory.length > 50) existing.eloHistory.shift();
        existing.elo = elo;
      }
      if (existing.name !== name) {
        existing.name = name;
      }
      LeaderboardManager.save();
    } else {
      // New player from server
      LeaderboardManager.addPlayer(id, name, elo);
    }
  }

  /**
   * Add a new player (or update name of existing).
   */
  static addPlayer(id: string, name: string, elo: number = DEFAULT_ELO): PlayerEntry {
    LeaderboardManager.load();
    const existing = LeaderboardManager.players.get(id);
    if (existing !== undefined) {
      existing.name = name;
      LeaderboardManager.save();
      return existing;
    }

    const player: PlayerEntry = {
      id,
      name,
      elo,
      wins: 0,
      losses: 0,
      draws: 0,
      totalGames: 0,
      eloHistory: [elo],
      lastPlayedAt: Date.now(),
    };
    LeaderboardManager.players.set(id, player);
    LeaderboardManager.save();
    return player;
  }

  // ── ELO Calculation ─────────────────────────────────────────────────────

  /**
   * Update ELO ratings for two players based on match result.
   *
   * Standard ELO formula:
   *   expected_A = 1 / (1 + 10^((elo_B - elo_A) / 400))
   *   new_elo_A = elo_A + K * (actual_A - expected_A)
   */
  static updateRatings(
    playerA: PlayerEntry,
    playerB: PlayerEntry,
    result: MatchResult,
  ): void {
    LeaderboardManager.load();

    // Ensure players are in the registry
    const pa = LeaderboardManager.getOrCreatePlayer(playerA.id, playerA.name);
    const pb = LeaderboardManager.getOrCreatePlayer(playerB.id, playerB.name);

    const expectedA = 1 / (1 + Math.pow(10, (pb.elo - pa.elo) / 400));
    const expectedB = 1 - expectedA;

    let actualA: number;
    let actualB: number;

    switch (result) {
      case 'white_win':
        actualA = 1;
        actualB = 0;
        pa.wins++;
        pb.losses++;
        break;
      case 'black_win':
        actualA = 0;
        actualB = 1;
        pa.losses++;
        pb.wins++;
        break;
      case 'draw':
        actualA = 0.5;
        actualB = 0.5;
        pa.draws++;
        pb.draws++;
        break;
    }

    const eloChangeA = Math.round(K_FACTOR * (actualA - expectedA));
    const eloChangeB = Math.round(K_FACTOR * (actualB - expectedB));

    pa.elo += eloChangeA;
    pb.elo += eloChangeB;
    pa.totalGames++;
    pb.totalGames++;
    pa.lastPlayedAt = Date.now();
    pb.lastPlayedAt = Date.now();

    // Update ELO history
    pa.eloHistory.push(pa.elo);
    if (pa.eloHistory.length > MAX_ELO_HISTORY) pa.eloHistory = pa.eloHistory.slice(-MAX_ELO_HISTORY);
    pb.eloHistory.push(pb.elo);
    if (pb.eloHistory.length > MAX_ELO_HISTORY) pb.eloHistory = pb.eloHistory.slice(-MAX_ELO_HISTORY);

    LeaderboardManager.save();
  }

  // ── Leaderboard Queries ─────────────────────────────────────────────────

  /**
   * Get the full leaderboard sorted by the specified criterion.
   */
  static getLeaderboard(
    sortBy: LeaderboardSortBy = 'elo',
    limit: number = 50,
  ): LeaderboardEntry[] {
    LeaderboardManager.load();
    const entries = Array.from(LeaderboardManager.players.values());

    // Sort
    entries.sort((a, b) => {
      switch (sortBy) {
        case 'elo':
          return b.elo - a.elo;
        case 'winRate': {
          const rateA = a.totalGames > 0 ? a.wins / a.totalGames : 0;
          const rateB = b.totalGames > 0 ? b.wins / b.totalGames : 0;
          return rateB - rateA || b.elo - a.elo;
        }
        case 'totalGames':
          return b.totalGames - a.totalGames || b.elo - a.elo;
        default:
          return b.elo - a.elo;
      }
    });

    // Limit and add ranks
    const limited = entries.slice(0, limit);
    return limited.map((p, idx) => ({
      rank: idx + 1,
      id: p.id,
      name: p.name,
      elo: p.elo,
      wins: p.wins,
      losses: p.losses,
      draws: p.draws,
      winRate: p.totalGames > 0 ? p.wins / p.totalGames : 0,
      totalGames: p.totalGames,
    }));
  }

  /**
   * Search for players by name (case-insensitive partial match).
   */
  static searchPlayers(query: string, limit: number = 20): PlayerEntry[] {
    LeaderboardManager.load();
    const q = query.toLowerCase().trim();
    if (q.length === 0) return [];
    const results: PlayerEntry[] = [];
    for (const player of LeaderboardManager.players.values()) {
      if (player.name.toLowerCase().includes(q)) {
        results.push(player);
      }
    }
    results.sort((a, b) => b.elo - a.elo);
    return results.slice(0, limit);
  }

  /**
   * Get all players (for tournament creation selection).
   */
  static getAllPlayers(): PlayerEntry[] {
    LeaderboardManager.load();
    const entries = Array.from(LeaderboardManager.players.values());
    entries.sort((a, b) => b.elo - a.elo);
    return entries;
  }

  /** Clear all leaderboard data (for testing) */
  static clear(): void {
    LeaderboardManager.players.clear();
    localStorage.removeItem(STORAGE_KEY);
  }
}
