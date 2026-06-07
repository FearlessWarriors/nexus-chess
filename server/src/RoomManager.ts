import { v4 as uuidv4 } from 'uuid';
import {
  Room,
  RoomStatus,
  PlayerState,
  ConnectionStatus,
  MoveRecord,
} from './types.js';

// ─── Initial FEN ─────────────────────────────────────────────────────────────

const INITIAL_FEN =
  'BScBSBScBCBScBSBSc/7/7/7/7/7/WScWSWScWCWScWSWSc w 0 1';

// ─── RoomManager ─────────────────────────────────────────────────────────────

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private playerRooms: Map<string, string> = new Map(); // playerId → roomId

  /**
   * Create a new room. Returns the room ID.
   * The creator initially occupies the room alone (status = 'waiting').
   */
  createRoom(playerId: string): string {
    const roomId = uuidv4().slice(0, 8);
    const room: Room = {
      id: roomId,
      status: 'waiting',
      playerWhite: null,
      playerBlack: null,
      spectators: new Set(),
      currentFen: INITIAL_FEN,
      moveHistory: [],
      createdAt: Date.now(),
    };
    this.rooms.set(roomId, room);
    return roomId;
  }

  /**
   * Join an existing room. The player is assigned the first available color.
   * Returns the assigned color or null on failure.
   */
  joinRoom(roomId: string, playerId: string): { success: boolean; color?: 'white' | 'black'; error?: string } {
    const room = this.rooms.get(roomId);
    if (room === undefined) {
      return { success: false, error: 'Room not found' };
    }
    if (room.status !== 'waiting') {
      return { success: false, error: 'Room is not accepting players' };
    }
    if (this.playerRooms.has(playerId)) {
      return { success: false, error: 'Player already in a room' };
    }

    // Assign first available color
    if (room.playerWhite === null) {
      room.playerWhite = playerId;
      this.playerRooms.set(playerId, roomId);
      return { success: true, color: 'white' };
    }
    if (room.playerBlack === null) {
      room.playerBlack = playerId;
      this.playerRooms.set(playerId, roomId);
      // Both players present → game starts
      room.status = 'playing';
      return { success: true, color: 'black' };
    }

    return { success: false, error: 'Room is full' };
  }

  /**
   * Seats two matched players into a room and starts the game.
   */
  seatPlayers(roomId: string, whiteId: string, blackId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (room === undefined) {
      return { success: false, error: 'Room not found' };
    }
    room.playerWhite = whiteId;
    room.playerBlack = blackId;
    room.status = 'playing';
    this.playerRooms.set(whiteId, roomId);
    this.playerRooms.set(blackId, roomId);
    return { success: true };
  }

  /**
   * Remove a player from their current room.
   */
  leaveRoom(roomId: string, playerId: string): void {
    const room = this.rooms.get(roomId);
    if (room === undefined) {
      return;
    }

    if (room.playerWhite === playerId) {
      room.playerWhite = null;
    } else if (room.playerBlack === playerId) {
      room.playerBlack = null;
    }
    room.spectators.delete(playerId);
    this.playerRooms.delete(playerId);

    // If both players gone, mark finished
    if (room.playerWhite === null && room.playerBlack === null) {
      room.status = 'finished';
    } else if (room.status === 'playing') {
      // A player left during a game — mark finished
      room.status = 'finished';
    }
  }

  /**
   * Add a spectator to a room.
   */
  addSpectator(roomId: string, playerId: string): { success: boolean; error?: string } {
    const room = this.rooms.get(roomId);
    if (room === undefined) {
      return { success: false, error: 'Room not found' };
    }
    if (this.playerRooms.has(playerId)) {
      return { success: false, error: 'Player already in a room' };
    }
    room.spectators.add(playerId);
    this.playerRooms.set(playerId, roomId);
    return { success: true };
  }

  /**
   * Record a move in the room's history and update the FEN snapshot.
   */
  recordMove(roomId: string, record: MoveRecord): boolean {
    const room = this.rooms.get(roomId);
    if (room === undefined) {
      return false;
    }
    room.moveHistory.push(record);
    room.currentFen = record.fen;
    return true;
  }

  /**
   * Mark a room as finished.
   */
  finishRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room !== undefined) {
      room.status = 'finished';
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  /** Get a room by ID */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** Get the room a player is currently in */
  getPlayerRoom(playerId: string): Room | undefined {
    const roomId = this.playerRooms.get(playerId);
    if (roomId === undefined) {
      return undefined;
    }
    return this.rooms.get(roomId);
  }

  /** Get the opponent's playerId in a room */
  getOpponent(room: Room, playerId: string): string | null {
    if (room.playerWhite === playerId) {
      return room.playerBlack;
    }
    if (room.playerBlack === playerId) {
      return room.playerWhite;
    }
    return null;
  }

  /** Get the color assigned to a player in a room */
  getPlayerColor(room: Room, playerId: string): 'white' | 'black' | null {
    if (room.playerWhite === playerId) {
      return 'white';
    }
    if (room.playerBlack === playerId) {
      return 'black';
    }
    return null;
  }

  /** Check if a player is in any room */
  isPlayerInRoom(playerId: string): boolean {
    return this.playerRooms.has(playerId);
  }

  /** Get all room IDs (for cleanup) */
  getAllRoomIds(): string[] {
    return Array.from(this.rooms.keys());
  }

  /** Get all active (waiting/playing) rooms for spectate lobby */
  getActiveGames(): Array<{
    id: string;
    whiteName: string;
    whiteElo: number;
    blackName: string;
    blackElo: number;
    moveCount: number;
    spectatorCount: number;
    createdAt: number;
  }> {
    const activeGames: Array<{
      id: string;
      whiteName: string;
      whiteElo: number;
      blackName: string;
      blackElo: number;
      moveCount: number;
      spectatorCount: number;
      createdAt: number;
    }> = [];
    for (const room of this.rooms.values()) {
      if (room.status === 'playing' || room.status === 'waiting') {
        activeGames.push({
          id: room.id,
          whiteName: room.playerWhite ?? '?',
          whiteElo: 1000,
          blackName: room.playerBlack ?? '?',
          blackElo: 1000,
          moveCount: room.moveHistory.length,
          spectatorCount: room.spectators.size,
          createdAt: room.createdAt,
        });
      }
    }
    // Sort by spectator count descending, then by move count
    activeGames.sort((a, b) => b.spectatorCount - a.spectatorCount || b.moveCount - a.moveCount);
    return activeGames;
  }

  /** Remove stale finished rooms older than `maxAgeMs` */
  cleanupStaleRooms(maxAgeMs: number): number {
    const now = Date.now();
    let removed = 0;
    for (const [id, room] of this.rooms) {
      if (room.status === 'finished' && now - room.createdAt > maxAgeMs) {
        // Clean up player mappings
        if (room.playerWhite !== null) {
          this.playerRooms.delete(room.playerWhite);
        }
        if (room.playerBlack !== null) {
          this.playerRooms.delete(room.playerBlack);
        }
        for (const spec of room.spectators) {
          this.playerRooms.delete(spec);
        }
        this.rooms.delete(id);
        removed++;
      }
    }
    return removed;
  }
}
