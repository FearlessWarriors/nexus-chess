// ─── Matchmaking Queue ───────────────────────────────────────────────────────

interface QueueEntry {
  playerId: string;
  elo: number;
  joinedAt: number;
}

/** Default Elo range for initial matching (±300) */
const DEFAULT_ELO_RANGE = 300;

/** After this many ms, widen Elo range to ±600 */
const WIDEN_ELO_AT_MS = 30_000;

/** After this many ms, remove Elo restriction entirely */
const NO_ELO_LIMIT_AT_MS = 60_000;

export class Matchmaking {
  private queue: QueueEntry[] = [];

  /**
   * Add a player to the matchmaking queue.
   * Returns the new queue position (1-indexed).
   */
  enqueue(playerId: string, elo: number = 1000): number {
    // Prevent duplicate entries
    if (this.queue.some((e) => e.playerId === playerId)) {
      return this.getPosition(playerId);
    }
    this.queue.push({ playerId, elo, joinedAt: Date.now() });
    return this.queue.length;
  }

  /**
   * Remove a player from the matchmaking queue.
   * Returns true if the player was found and removed.
   */
  dequeue(playerId: string): boolean {
    const idx = this.queue.findIndex((e) => e.playerId === playerId);
    if (idx === -1) {
      return false;
    }
    this.queue.splice(idx, 1);
    return true;
  }

  /**
   * Try to find a match. If two compatible players are found, they are
   * removed from the queue and returned as a pair.
   * Returns null if no match is available yet.
   */
  tryMatch(): { whiteId: string; blackId: string } | null {
    const now = Date.now();

    for (let i = 0; i < this.queue.length; i++) {
      const a = this.queue[i];
      const waitMs = now - a.joinedAt;

      for (let j = i + 1; j < this.queue.length; j++) {
        const b = this.queue[j];
        const eloDiff = Math.abs(a.elo - b.elo);

        if (this.isEloCompatible(eloDiff, waitMs)) {
          // Found a match — remove both from queue (j first to preserve index i)
          this.queue.splice(j, 1);
          this.queue.splice(i, 1);
          // Assign white to the first player in the pair
          return { whiteId: a.playerId, blackId: b.playerId };
        }
      }
    }

    return null;
  }

  /**
   * Get a player's position in the queue (1-indexed).
   * Returns 0 if not in queue.
   */
  getPosition(playerId: string): number {
    const idx = this.queue.findIndex((e) => e.playerId === playerId);
    return idx === -1 ? 0 : idx + 1;
  }

  /**
   * Get the number of players currently in the queue.
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Estimate wait time in seconds for a new player joining the queue.
   */
  estimateWaitSeconds(): number {
    const len = this.queue.length;
    if (len === 0) {
      return 0;
    }
    // Rough heuristic: each player in queue adds ~5s of expected wait
    return len * 5;
  }

  /**
   * Check if a player is in the queue.
   */
  isQueued(playerId: string): boolean {
    return this.queue.some((e) => e.playerId === playerId);
  }

  // ── Private ─────────────────────────────────────────────────────────────

  /**
   * Determine if two players are compatible based on Elo difference and
   * how long the first player has been waiting.
   */
  private isEloCompatible(eloDiff: number, waitMs: number): boolean {
    if (waitMs >= NO_ELO_LIMIT_AT_MS) {
      return true; // No Elo restriction after 60s
    }
    if (waitMs >= WIDEN_ELO_AT_MS) {
      return eloDiff <= DEFAULT_ELO_RANGE * 2; // ±600
    }
    return eloDiff <= DEFAULT_ELO_RANGE; // ±300
  }
}
