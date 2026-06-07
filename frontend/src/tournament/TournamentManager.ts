import {
  Tournament,
  TournamentConfig,
  TournamentFormat,
  TournamentStatus,
  TournamentPlayer,
  TournamentMatch,
  TournamentRound,
  RoundStatus,
  MatchResult,
  PlayerEntry,
} from './types';
import { LeaderboardManager } from './LeaderboardManager';

// ─── ID Generator ────────────────────────────────────────────────────────────

let _idCounter = 0;
function shortId(): string {
  _idCounter++;
  return `t${Date.now().toString(36)}${_idCounter.toString(36)}`;
}

function matchId(): string {
  _idCounter++;
  return `m${Date.now().toString(36)}${_idCounter.toString(36)}`;
}

// ─── Tournament Manager ──────────────────────────────────────────────────────

export class TournamentManager {
  private tournaments: Map<string, Tournament> = new Map();

  // ── Creation ────────────────────────────────────────────────────────────

  /**
   * Create a new tournament.
   */
  createTournament(
    name: string,
    format: TournamentFormat,
    players: PlayerEntry[],
    config?: Partial<TournamentConfig>,
  ): Tournament {
    const defaults: TournamentConfig = {
      name,
      format,
      maxPlayers: format === 'elimination' ? 8 : 0,
      rounds: format === 'swiss' ? 5 : 0,
    };

    const cfg: TournamentConfig = { ...defaults, ...config, name, format };

    // Convert players to tournament players
    const tPlayers: TournamentPlayer[] = players.map((p) => ({
      ...p,
      score: 0,
      buchholz: 0,
      eliminated: false,
    }));

    const tournament: Tournament = {
      id: shortId(),
      name,
      format,
      status: 'waiting',
      players: tPlayers,
      rounds: [],
      currentRound: 0,
      config: cfg,
      createdAt: Date.now(),
      winnerIds: [],
    };

    this.tournaments.set(tournament.id, tournament);
    return tournament;
  }

  // ── Round Management ────────────────────────────────────────────────────

  /**
   * Start the next round. Pairs players according to the tournament format.
   */
  startNextRound(tournamentId: string): TournamentRound | null {
    const t = this.tournaments.get(tournamentId);
    if (t === undefined) return null;
    if (t.status === 'completed') return null;

    // Transition from waiting to in_progress
    if (t.status === 'waiting') {
      t.status = 'in_progress';
    }

    t.currentRound++;
    const roundNumber = t.currentRound;

    let matches: TournamentMatch[];

    if (t.format === 'swiss') {
      matches = this.swissPairing(t);
    } else {
      matches = this.eliminationPairing(t);
    }

    const round: TournamentRound = {
      number: roundNumber,
      matches,
      status: 'in_progress',
    };

    t.rounds.push(round);

    // Check if all matches are byes (no real matches) — end tournament
    const realMatches = matches.filter((m) => !m.isBye);
    if (realMatches.length === 0 && t.format === 'elimination') {
      // Only one player left — they win
      const survivors = t.players.filter((p) => !p.eliminated);
      t.winnerIds = survivors.map((p) => p.id);
      t.status = 'completed';
    }

    return round;
  }

  /**
   * Report a match result. Updates player scores, ELO ratings, and checks
   * for tournament completion.
   */
  reportResult(
    tournamentId: string,
    matchId: string,
    result: MatchResult,
  ): {
    success: boolean;
    roundComplete?: boolean;
    tournamentComplete?: boolean;
    error?: string;
  } {
    const t = this.tournaments.get(tournamentId);
    if (t === undefined) return { success: false, error: 'Tournament not found' };

    const currentRound = t.rounds[t.rounds.length - 1];
    if (currentRound === undefined) return { success: false, error: 'No active round' };

    const match = currentRound.matches.find((m) => m.id === matchId);
    if (match === undefined) return { success: false, error: 'Match not found' };
    if (match.result !== null) return { success: false, error: 'Match already reported' };
    if (match.isBye) return { success: false, error: 'Bye matches are auto-scored' };

    match.result = result;

    // Update player scores
    const whitePlayer = t.players.find((p) => p.id === match.whiteId);
    const blackPlayer = t.players.find((p) => p.id === match.blackId);

    if (whitePlayer === undefined || blackPlayer === undefined) {
      return { success: false, error: 'Player not found' };
    }

    if (result === 'white_win') {
      whitePlayer.score += 1;
      if (t.format === 'elimination') blackPlayer.eliminated = true;
    } else if (result === 'black_win') {
      blackPlayer.score += 1;
      if (t.format === 'elimination') whitePlayer.eliminated = true;
    } else {
      // Draw
      whitePlayer.score += 0.5;
      blackPlayer.score += 0.5;
      // In elimination, draw is not allowed; treat as no change
    }

    // Update ELO
    LeaderboardManager.updateRatings(whitePlayer, blackPlayer, result);

    // Check if round is complete
    const allReported = currentRound.matches.every(
      (m) => m.result !== null || m.isBye,
    );
    let roundComplete = false;
    let tournamentComplete = false;

    if (allReported) {
      currentRound.status = 'completed';
      roundComplete = true;

      // Update Buchholz for Swiss
      if (t.format === 'swiss') {
        this.updateBuchholz(t);
      }

      // Check tournament completion
      tournamentComplete = this.checkCompletion(t);
    }

    return { success: true, roundComplete, tournamentComplete };
  }

  /** Get a tournament by ID */
  getTournament(id: string): Tournament | undefined {
    return this.tournaments.get(id);
  }

  /** List all tournaments */
  listTournaments(): Tournament[] {
    return Array.from(this.tournaments.values());
  }

  /** Get a player by ID across all tournaments */
  getPlayerInTournament(tournamentId: string, playerId: string): TournamentPlayer | undefined {
    const t = this.tournaments.get(tournamentId);
    if (t === undefined) return undefined;
    return t.players.find((p) => p.id === playerId);
  }

  // ── Swiss Pairing ───────────────────────────────────────────────────────

  /**
   * Swiss system pairing:
   * 1. Group players by score (descending)
   * 2. Within each group, randomly pair players
   * 3. If odd number in a group, the lowest-score player drops to next group
   * 4. The final unpaired player gets a bye (free win)
   */
  private swissPairing(t: Tournament): TournamentMatch[] {
    const activePlayers = t.players.filter((p) => !p.eliminated);

    // Sort by score descending, then by ELO descending
    activePlayers.sort((a, b) => b.score - a.score || b.elo - a.elo);

    // Group by score
    const groups = new Map<number, TournamentPlayer[]>();
    for (const p of activePlayers) {
      const score = p.score;
      if (!groups.has(score)) groups.set(score, []);
      groups.get(score)!.push(p);
    }

    // Flatten groups in descending score order
    const sortedGroups = Array.from(groups.entries()).sort((a, b) => b[0] - a[0]);

    // Collect all players in order
    const ordered: TournamentPlayer[] = [];
    for (const [, groupPlayers] of sortedGroups) {
      // Shuffle within group
      const shuffled = this.shuffle([...groupPlayers]);
      ordered.push(...shuffled);
    }

    // Pair adjacent players
    const matches: TournamentMatch[] = [];
    const used = new Set<string>();

    for (let i = 0; i < ordered.length; i++) {
      if (used.has(ordered[i].id)) continue;

      // Find next available player
      let j = i + 1;
      while (j < ordered.length && used.has(ordered[j].id)) {
        j++;
      }

      if (j >= ordered.length) {
        // Odd player out — bye
        matches.push({
          id: matchId(),
          round: t.currentRound,
          whiteId: ordered[i].id,
          blackId: '',
          result: null,
          gameId: null,
          isBye: true,
        });
        ordered[i].score += 1; // Bye gives 1 point
      } else {
        used.add(ordered[i].id);
        used.add(ordered[j].id);

        // Alternate colors
        let whiteId: string;
        let blackId: string;
        if (i % 2 === 0) {
          whiteId = ordered[i].id;
          blackId = ordered[j].id;
        } else {
          whiteId = ordered[j].id;
          blackId = ordered[i].id;
        }

        matches.push({
          id: matchId(),
          round: t.currentRound,
          whiteId,
          blackId,
          result: null,
          gameId: null,
          isBye: false,
        });
      }
    }

    // Check Swiss completion: if only one active player or all rounds done
    if (t.config.rounds > 0 && t.currentRound >= t.config.rounds) {
      t.status = 'completed';
      // Winner is highest scorer
      this.determineSwissWinners(t);
    }

    return matches;
  }

  // ── Elimination Pairing ─────────────────────────────────────────────────

  /**
   * Elimination (knockout) bracket pairing.
   * Seeds by ELO, pairs 1 vs N, 2 vs N-1, etc.
   * Players with byes auto-advance.
   */
  private eliminationPairing(t: Tournament): TournamentMatch[] {
    const activePlayers = t.players.filter((p) => !p.eliminated);

    // If first round: seed by ELO
    if (t.currentRound === 1) {
      activePlayers.sort((a, b) => b.elo - a.elo);
    } else {
      // Subsequent rounds: maintain order from previous round pairing
      activePlayers.sort((a, b) => b.score - a.score || b.elo - a.elo);
    }

    const matches: TournamentMatch[] = [];
    const n = activePlayers.length;

    if (n === 1) {
      // Only one player — auto-win
      t.winnerIds = [activePlayers[0].id];
      t.status = 'completed';
      return [];
    }

    // Pair: 1 vs n, 2 vs n-1, etc.
    const pairCount = Math.floor(n / 2);
    const used = new Set<string>();

    for (let i = 0; i < pairCount; i++) {
      const whiteIdx = i;
      const blackIdx = n - 1 - i;
      const whitePlayer = activePlayers[whiteIdx];
      const blackPlayer = activePlayers[blackIdx];

      used.add(whitePlayer.id);
      used.add(blackPlayer.id);

      matches.push({
        id: matchId(),
        round: t.currentRound,
        whiteId: whitePlayer.id,
        blackId: blackPlayer.id,
        result: null,
        gameId: null,
        isBye: false,
      });
    }

    // Handle odd player (bye in first round)
    if (n % 2 !== 0 && t.currentRound === 1) {
      const byePlayer = activePlayers.find((p) => !used.has(p.id));
      if (byePlayer !== undefined) {
        matches.push({
          id: matchId(),
          round: t.currentRound,
          whiteId: byePlayer.id,
          blackId: '',
          result: null,
          gameId: null,
          isBye: true,
        });
      }
    }

    return matches;
  }

  // ── Completion ──────────────────────────────────────────────────────────

  private checkCompletion(t: Tournament): boolean {
    if (t.status === 'completed') return true;

    if (t.format === 'elimination') {
      const survivors = t.players.filter((p) => !p.eliminated);
      if (survivors.length <= 1) {
        t.winnerIds = survivors.map((p) => p.id);
        t.status = 'completed';
        return true;
      }
    }

    if (t.format === 'swiss') {
      if (t.config.rounds > 0 && t.currentRound >= t.config.rounds) {
        t.status = 'completed';
        this.determineSwissWinners(t);
        return true;
      }
    }

    return false;
  }

  private determineSwissWinners(t: Tournament): void {
    const active = t.players.filter((p) => !p.eliminated);
    active.sort((a, b) => b.score - a.score || b.buchholz - a.buchholz || b.elo - a.elo);
    const topScore = active.length > 0 ? active[0].score : 0;
    t.winnerIds = active.filter((p) => p.score === topScore).map((p) => p.id);
  }

  private updateBuchholz(t: Tournament): void {
    // Buchholz = sum of opponents' scores
    for (const player of t.players) {
      let buchholzSum = 0;
      for (const round of t.rounds) {
        for (const match of round.matches) {
          if (match.isBye) continue;
          if (match.whiteId === player.id) {
            const opp = t.players.find((p) => p.id === match.blackId);
            if (opp !== undefined) buchholzSum += opp.score;
          } else if (match.blackId === player.id) {
            const opp = t.players.find((p) => p.id === match.whiteId);
            if (opp !== undefined) buchholzSum += opp.score;
          }
        }
      }
      player.buchholz = buchholzSum;
    }
  }

  // ── Utility ─────────────────────────────────────────────────────────────

  private shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
