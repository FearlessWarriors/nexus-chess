import type { GameRecord, PlayerStats, ListGamesFilter, PaginatedResult, MoveRecord } from './types';
import { GameStatus } from '../engine/types';

// ─── IndexedDB Constants ──────────────────────────────────────────────────────

const DB_NAME = 'nexus-chess-history';
const DB_VERSION = 1;
const STORE_NAME = 'games';
const DEFAULT_PAGE_SIZE = 20;

// ─── Database Helpers ─────────────────────────────────────────────────────────

/** Open (or create) the IndexedDB database. Returns the DB instance. */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (_event: IDBVersionChangeEvent) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('date', 'date', { unique: false });
        store.createIndex('mode', 'mode', { unique: false });
        store.createIndex('result_status', 'result.status', { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message ?? 'unknown error'}`));
    };

    request.onblocked = () => {
      reject(new Error('Database upgrade blocked by another connection'));
    };
  });
}

/** Execute a read-write transaction on the games store */
async function withStore(
  mode: IDBTransactionMode,
): Promise<{ store: IDBObjectStore; db: IDBDatabase }> {
  const db = await openDatabase();
  const transaction = db.transaction(STORE_NAME, mode);
  const store = transaction.objectStore(STORE_NAME);
  return { store, db };
}

/** Wraps an IDBRequest in a Promise */
function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new Error(`IndexedDB request failed: ${request.error?.message ?? 'unknown error'}`));
    };
  });
}

// ─── Storage Service ──────────────────────────────────────────────────────────

/**
 * Persistent storage for game records using IndexedDB.
 * All methods return Promises and include error handling.
 */
export class Storage {
  // ── Single-game Operations ──────────────────────────────────────────────

  /**
   * Save a complete game record to IndexedDB.
   * Silently overwrites if a record with the same ID already exists.
   */
  static async saveGame(record: GameRecord): Promise<void> {
    try {
      const { store } = await withStore('readwrite');
      await promisifyRequest(store.put(record));
    } catch (err) {
      throw new Error(
        `Failed to save game ${record.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Retrieve a game record by its unique ID.
   * Returns null if no game with the given ID exists.
   */
  static async getGame(id: string): Promise<GameRecord | null> {
    try {
      const { store } = await withStore('readonly');
      const result = await promisifyRequest<GameRecord | undefined>(store.get(id));
      return result ?? null;
    } catch (err) {
      throw new Error(
        `Failed to get game ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Delete a game record by its unique ID.
   * Does not throw if the ID does not exist.
   */
  static async deleteGame(id: string): Promise<void> {
    try {
      const { store } = await withStore('readwrite');
      await promisifyRequest(store.delete(id));
    } catch (err) {
      throw new Error(
        `Failed to delete game ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Listing & Filtering ─────────────────────────────────────────────────

  /**
   * List game records with optional filtering and pagination.
   *
   * @param filter Optional filter criteria (mode, dateRange, result)
   * @param page   Zero-indexed page number (default 0)
   * @param pageSize Number of records per page (default 20)
   * @returns Paginated result containing game records sorted by date descending
   */
  static async listGames(
    filter?: ListGamesFilter,
    page: number = 0,
    pageSize: number = DEFAULT_PAGE_SIZE,
  ): Promise<PaginatedResult<GameRecord>> {
    try {
      // Fetch all games (we apply filters in-memory since IDB filtering is limited)
      const allGames = await Storage._fetchAllGames();

      // Apply filters
      let filtered = allGames;
      if (filter) {
        filtered = Storage._applyFilters(allGames, filter);
      }

      // Sort by date descending (newest first)
      filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

      // Paginate
      const total = filtered.length;
      const start = page * pageSize;
      const items = filtered.slice(start, start + pageSize);
      const hasMore = start + pageSize < total;

      return {
        items,
        page,
        pageSize,
        total,
        hasMore,
      };
    } catch (err) {
      throw new Error(
        `Failed to list games: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Statistics ───────────────────────────────────────────────────────────

  /**
   * Compute aggregated player statistics from all stored games.
   * Returns a zeroed PlayerStats if no games are stored.
   */
  static async getStats(): Promise<PlayerStats> {
    try {
      const allGames = await Storage._fetchAllGames();

      if (allGames.length === 0) {
        return {
          totalGames: 0,
          wins: 0,
          losses: 0,
          draws: 0,
          winRate: 0,
          avgMovesPerGame: 0,
          favoriteOpening: '',
          elo: undefined,
        };
      }

      let wins = 0;
      let losses = 0;
      let draws = 0;
      let totalMoves = 0;
      const openingCounts = new Map<string, number>();

      for (const game of allGames) {
        totalMoves += game.moves.length;

        // Track opening (first move notation)
        if (game.moves.length > 0) {
          const opening = game.moves[0].notation;
          openingCounts.set(opening, (openingCounts.get(opening) ?? 0) + 1);
        }

        // Determine result from white's perspective for simplicity;
        // "wins" counts WHITE_WIN as a win for the first player
        const status = game.result.status;
        if (
          status === GameStatus.WHITE_WIN ||
          status === GameStatus.WHITE_RESIGN
        ) {
          // White win means white won → count as "win" for white
          wins++;
        } else if (
          status === GameStatus.BLACK_WIN ||
          status === GameStatus.BLACK_RESIGN
        ) {
          losses++;
        } else if (status === GameStatus.DRAW) {
          draws++;
        }
        // IN_PROGRESS games shouldn't normally be stored, but ignore them
      }

      const totalGames = wins + losses + draws;

      // Find most common opening
      let favoriteOpening = '';
      let maxCount = 0;
      openingCounts.forEach((count, opening) => {
        if (count > maxCount) {
          maxCount = count;
          favoriteOpening = opening;
        }
      });

      return {
        totalGames,
        wins,
        losses,
        draws,
        winRate: totalGames > 0 ? wins / totalGames : 0,
        avgMovesPerGame: totalGames > 0 ? totalMoves / totalGames : 0,
        favoriteOpening,
        elo: undefined,
      };
    } catch (err) {
      throw new Error(
        `Failed to compute stats: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Export ──────────────────────────────────────────────────────────────

  /**
   * Export a single game in PGN-like format with FEN headers.
   * Returns a formatted string suitable for .pgn file output.
   */
  static async exportPGN(id: string): Promise<string> {
    try {
      const game = await Storage.getGame(id);
      if (game === null) {
        throw new Error(`Game not found: ${id}`);
      }
      return Storage._formatPGN(game);
    } catch (err) {
      throw new Error(
        `Failed to export PGN for game ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Export all stored games as a JSON string.
   * Useful for backup / data portability.
   */
  static async exportAllJSON(): Promise<string> {
    try {
      const allGames = await Storage._fetchAllGames();
      return JSON.stringify(allGames, null, 2);
    } catch (err) {
      throw new Error(
        `Failed to export all games: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  /** Fetch all games from the store (cursor-based, no pagination) */
  private static async _fetchAllGames(): Promise<GameRecord[]> {
    const { store } = await withStore('readonly');
    const request = store.getAll();
    const result = await promisifyRequest<GameRecord[]>(request);
    return result ?? [];
  }

  /** Apply in-memory filters to an array of game records */
  private static _applyFilters(
    games: GameRecord[],
    filter: ListGamesFilter,
  ): GameRecord[] {
    let result = games;

    if (filter.mode !== undefined) {
      result = result.filter((g) => g.mode === filter.mode);
    }

    if (filter.dateRange !== undefined) {
      const fromMs = new Date(filter.dateRange.from).getTime();
      const toMs = new Date(filter.dateRange.to).getTime();
      result = result.filter((g) => {
        const dateMs = new Date(g.date).getTime();
        return dateMs >= fromMs && dateMs <= toMs;
      });
    }

    if (filter.result !== undefined) {
      result = result.filter((g) => {
        const status = g.result.status;
        switch (filter.result) {
          case 'win':
            return status === GameStatus.WHITE_WIN || status === GameStatus.WHITE_RESIGN;
          case 'loss':
            return status === GameStatus.BLACK_WIN || status === GameStatus.BLACK_RESIGN;
          case 'draw':
            return status === GameStatus.DRAW;
          default:
            return true;
        }
      });
    }

    return result;
  }

  /** Format a single game record as PGN-like text */
  private static _formatPGN(game: GameRecord): string {
    const lines: string[] = [];

    // Headers
    lines.push('[Event "Nexus Chess Game"]');
    lines.push('[Site "Nexus Chess"]');

    // Date: ISO → "YYYY.MM.DD"
    const dateObj = new Date(game.date);
    const year = dateObj.getFullYear().toString();
    const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
    const day = dateObj.getDate().toString().padStart(2, '0');
    lines.push(`[Date "${year}.${month}.${day}"]`);

    lines.push(`[White "${game.players.white}"]`);
    lines.push(`[Black "${game.players.black}"]`);
    lines.push(`[Result "${Storage._resultString(game.result.status)}"]`);
    lines.push(`[FEN "${game.initialFen}"]`);
    lines.push(`[FinalFEN "${game.finalFen}"]`);
    lines.push(`[Duration "${game.duration}"]`);
    lines.push(`[Mode "${game.mode}"]`);
    lines.push('');

    // Moves
    if (game.moves.length > 0) {
      const moveLines = Storage._formatMoves(game.moves);
      for (const line of moveLines) {
        lines.push(line);
      }
    }

    lines.push('');
    lines.push(Storage._resultString(game.result.status));

    return lines.join('\n');
  }

  /** Format moves into PGN-style lines (pairs per line) */
  private static _formatMoves(moves: MoveRecord[]): string[] {
    const lines: string[] = [];
    let currentLine = '';

    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      // White moves start a new move number (in standard notation)
      // We use moveNumber from the record
      const isEven = i % 2 === 0;

      if (isEven) {
        // Flush previous line
        if (currentLine.length > 0) {
          lines.push(currentLine.trimEnd());
        }
        currentLine = `${move.moveNumber}. ${move.notation}`;
      } else {
        currentLine += ` ${move.notation}`;
      }
    }

    // Flush remaining
    if (currentLine.length > 0) {
      lines.push(currentLine.trimEnd());
    }

    return lines;
  }

  /** Convert GameStatus to PGN result string */
  private static _resultString(status: GameStatus): string {
    switch (status) {
      case GameStatus.WHITE_WIN:
      case GameStatus.WHITE_RESIGN:
        return '1-0';
      case GameStatus.BLACK_WIN:
      case GameStatus.BLACK_RESIGN:
        return '0-1';
      case GameStatus.DRAW:
        return '1/2-1/2';
      case GameStatus.IN_PROGRESS:
      default:
        return '*';
    }
  }
}
