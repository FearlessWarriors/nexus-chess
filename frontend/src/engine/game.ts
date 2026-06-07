/**
 * game.ts — Gravity-Lock Game Controller
 *
 * Orchestrates the full game lifecycle under the gravity-lock ruleset:
 *   - Move execution with lock checking
 *   - Push move handling
 *   - Sanctuary victory detection
 *   - Siege victory detection
 *   - Core cooldown management
 *   - Anchor overload removal
 *   - Repetition and 50-move draw detection
 */

import {
  Piece,
  PieceType,
  Color,
  Position,
  Move,
  MoveFlag,
  GameState,
  GameStatus,
  CENTER,
  posEquals,
  posToString,
  opponentColor,
} from './types';
import {
  createInitialBoard,
  getPiece,
  getCore,
  setPiece,
  removePiece,
} from './board';
import { MoveGenerator } from './movegen';
import { RuleEngine, checkAndExecuteOverload, boardPositionKey } from './rules';

// ─── Game Controller ──────────────────────────────────────────────────────────

export class Game {
  state: GameState;

  /** Fired after every successful move or game-state mutation */
  onStateChange?: (state: GameState) => void;

  /** Fired when the game terminates */
  onGameOver?: (result: { status: GameStatus; winner: Color | null }) => void;

  constructor() {
    this.state = this._createInitialState();
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /** Reset the game to the initial position. */
  reset(): void {
    this.state = this._createInitialState();
    this.onStateChange?.(this.state);
  }

  /**
   * Attempt to make a move from `from` to `to`.
   *
   * @returns An object with `success: true` and the new state if legal,
   *          or `success: false` with an error message.
   */
  makeMove(from: Position, to: Position): {
    success: boolean;
    newState?: GameState;
    gameOver?: boolean;
    error?: string;
    /** Pieces removed by anchor overload during this move */
    overloadRemoved?: Piece[];
  } {
    const { state } = this;

    // ----- 1. Check game is active -----
    if (state.status !== GameStatus.IN_PROGRESS) {
      return { success: false, error: 'Game is already over' };
    }

    // ----- 2. Find the piece at the source square -----
    const piece = getPiece(state.board, from.col, from.row);
    if (piece === null) {
      return { success: false, error: `No piece at ${posToString(from)}` };
    }
    if (piece.color !== state.turn) {
      return {
        success: false,
        error: `It is ${state.turn}'s turn, not ${piece.color}'s`,
      };
    }

    // ----- 3. Generate all legal moves for the current player -----
    const allMoves = MoveGenerator.generateMoves(state, state.turn);

    if (allMoves.length === 0) {
      // No legal moves — game ends
      const newState = state.clone();
      const result = RuleEngine.getGameResult(newState, false);
      newState.status = result.status;
      newState.winner = result.winner;
      this.state = newState;
      this.onStateChange?.(newState);
      this.onGameOver?.({ status: newState.status, winner: newState.winner });
      return {
        success: true,
        newState,
        gameOver: true,
      };
    }

    // ----- 4. Match the destination -----
    const move = allMoves.find((m) => posEquals(m.from, from) && posEquals(m.to, to));
    if (move === undefined) {
      return {
        success: false,
        error: `Illegal move: ${posToString(from)} \u2192 ${posToString(to)}`,
      };
    }

    // ----- 5. Execute the move -----
    const newState = state.clone();
    const isPush = move.flag === MoveFlag.PUSH;

    if (isPush) {
      // Push move: displace the enemy core
      this._executePushMove(newState, move);
    } else {
      // Normal move
      this._executeNormalMove(newState, move);
    }

    // ----- 6. Handle core cooldown -----
    // Clear own cooldown (it only lasts 1 turn)
    newState.coreCooldown.set(newState.turn, false);

    // If we just pushed the enemy core, set its cooldown
    if (isPush) {
      const enemyColor = opponentColor(newState.turn);
      newState.coreCooldown.set(enemyColor, true);
    }

    // ----- 7. Anchor overload check -----
    // Check the opponent's anchors AFTER the mover's move but BEFORE switching turns.
    // The mover (currentTurn) just finished their move; we check if the opponent's
    // Anchors are overloaded.
    const currentTurn = newState.turn;
    const overloadRemoved = checkAndExecuteOverload(newState, currentTurn);

    // ----- 8. Update half-move clock -----
    // Anchor removal counts as a capture-like event → reset halfMoveClock
    if (overloadRemoved.length > 0) {
      newState.halfMoveClock = 0;
    } else {
      newState.halfMoveClock = 0; // all moves in gravity rules reset the clock
    }

    // ----- 9. Update sanctuary tracking -----
    // Check if the CURRENT side's core is on d4 BEFORE the turn switches
    const currentCore = getCore(newState.board, newState.turn);
    if (posEquals(currentCore.pos, CENTER)) {
      newState.sanctuaryOccupied = newState.turn;
    } else {
      newState.sanctuaryOccupied = null;
    }

    // ----- 10. Switch turn -----
    const wasBlack = newState.turn === Color.BLACK;
    newState.turn = opponentColor(newState.turn);

    // Full-move number increments after Black's move
    if (wasBlack) {
      newState.fullMoveNumber++;
    }

    // ----- 11. Update position count for repetition detection -----
    const posKey = boardPositionKey(newState);
    newState.positionCount.set(
      posKey,
      (newState.positionCount.get(posKey) ?? 0) + 1,
    );

    // ----- 12. Check victory conditions for the player who just moved -----
    // The player who just moved is now the opponent of newState.turn
    const moverColor = opponentColor(newState.turn);

    // Check sanctuary victory (mover's core on d4)
    // We need a temporary state where it's still mover's turn
    const checkState = newState.clone();
    checkState.turn = moverColor;
    const sanctuaryWin = RuleEngine.isSanctuaryVictory(checkState, moverColor);

    // Check siege victory (new current player's core is trapped)
    const siegeWin = RuleEngine.isSiegeVictory(newState, moverColor);

    // Check if new current player has legal moves
    const newMoves = MoveGenerator.generateMoves(newState, newState.turn);

    // ----- 13. Determine game result -----
    let result: { status: GameStatus; winner: Color | null };

    if (sanctuaryWin) {
      result = {
        status:
          moverColor === Color.WHITE
            ? GameStatus.WHITE_WIN
            : GameStatus.BLACK_WIN,
        winner: moverColor,
      };
    } else if (siegeWin) {
      result = {
        status:
          moverColor === Color.WHITE
            ? GameStatus.WHITE_WIN
            : GameStatus.BLACK_WIN,
        winner: moverColor,
      };
    } else {
      result = RuleEngine.getGameResult(newState, newMoves.length > 0);
    }

    newState.status = result.status;
    newState.winner = result.winner;

    // Record the move
    newState.moveHistory = [...state.moveHistory, move];

    // ----- 14. Commit state -----
    this.state = newState;

    // ----- 15. Fire callbacks -----
    this.onStateChange?.(newState);

    const gameOver = newState.status !== GameStatus.IN_PROGRESS;
    if (gameOver) {
      this.onGameOver?.({ status: newState.status, winner: newState.winner });
    }

    return {
      success: true,
      newState,
      gameOver,
      overloadRemoved: overloadRemoved.length > 0 ? overloadRemoved : undefined,
    };
  }

  makeMoveFast(move: Move): {
    success: boolean;
    newState?: GameState;
    gameOver?: boolean;
    error?: string;
    overloadRemoved?: Piece[];
  } {
    const { state } = this;

    if (state.status !== GameStatus.IN_PROGRESS) {
      return { success: false, error: 'Game is already over' };
    }

    const piece = getPiece(state.board, move.from.col, move.from.row);
    if (piece === null) {
      return { success: false, error: `No piece at ${posToString(move.from)}` };
    }
    if (piece.color !== state.turn) {
      return {
        success: false,
        error: `It is ${state.turn}'s turn, not ${piece.color}'s`,
      };
    }

    const newState = state.clone();
    const isPush = move.flag === MoveFlag.PUSH;

    if (isPush) {
      this._executePushMove(newState, move);
    } else {
      this._executeNormalMove(newState, move);
    }

    newState.coreCooldown.set(newState.turn, false);

    if (isPush) {
      const enemyColor = opponentColor(newState.turn);
      newState.coreCooldown.set(enemyColor, true);
    }

    const currentTurn = newState.turn;
    const overloadRemoved = checkAndExecuteOverload(newState, currentTurn);

    if (overloadRemoved.length > 0) {
      newState.halfMoveClock = 0;
    } else {
      newState.halfMoveClock = 0;
    }

    const currentCore = getCore(newState.board, newState.turn);
    if (posEquals(currentCore.pos, CENTER)) {
      newState.sanctuaryOccupied = newState.turn;
    } else {
      newState.sanctuaryOccupied = null;
    }

    const wasBlack = newState.turn === Color.BLACK;
    newState.turn = opponentColor(newState.turn);

    if (wasBlack) {
      newState.fullMoveNumber++;
    }

    const posKey = boardPositionKey(newState);
    newState.positionCount.set(
      posKey,
      (newState.positionCount.get(posKey) ?? 0) + 1,
    );

    const moverColor = opponentColor(newState.turn);
    const checkState = newState.clone();
    checkState.turn = moverColor;
    const sanctuaryWin = RuleEngine.isSanctuaryVictory(checkState, moverColor);
    const siegeWin = RuleEngine.isSiegeVictory(newState, moverColor);
    const newMoves = MoveGenerator.generateMoves(newState, newState.turn);

    let result: { status: GameStatus; winner: Color | null };

    if (sanctuaryWin) {
      result = {
        status:
          moverColor === Color.WHITE
            ? GameStatus.WHITE_WIN
            : GameStatus.BLACK_WIN,
        winner: moverColor,
      };
    } else if (siegeWin) {
      result = {
        status:
          moverColor === Color.WHITE
            ? GameStatus.WHITE_WIN
            : GameStatus.BLACK_WIN,
        winner: moverColor,
      };
    } else {
      result = RuleEngine.getGameResult(newState, newMoves.length > 0);
    }

    newState.status = result.status;
    newState.winner = result.winner;
    newState.moveHistory = [...state.moveHistory, move];
    this.state = newState;

    this.onStateChange?.(newState);

    const gameOver = newState.status !== GameStatus.IN_PROGRESS;
    if (gameOver) {
      this.onGameOver?.({ status: newState.status, winner: newState.winner });
    }

    return {
      success: true,
      newState,
      gameOver,
      overloadRemoved: overloadRemoved.length > 0 ? overloadRemoved : undefined,
    };
  }

  /**
   * Undo the last move. Returns true if successful.
   */
  undoMove(): boolean {
    if (this.state.moveHistory.length === 0) {
      return false;
    }

    // Rebuild state from scratch by replaying all moves except the last
    const moves = this.state.moveHistory.slice(0, -1);
    const fresh = this._createInitialState();

    // Temporarily suppress callbacks during replay
    const prevOnStateChange = this.onStateChange;
    const prevOnGameOver = this.onGameOver;
    this.onStateChange = undefined;
    this.onGameOver = undefined;

    this.state = fresh;
    for (const m of moves) {
      const result = this.makeMove(m.from, m.to);
      if (!result.success) {
        // Should not happen; restore callbacks and abort
        this.onStateChange = prevOnStateChange;
        this.onGameOver = prevOnGameOver;
        this.reset();
        return false;
      }
    }

    // Restore callbacks
    this.onStateChange = prevOnStateChange;
    this.onGameOver = prevOnGameOver;
    this.onStateChange?.(this.state);
    return true;
  }

  /**
   * Get all legal destination positions for the piece at `pos`.
   * Returns an empty array if there is no piece or no legal moves.
   */
  getLegalMoves(pos: Position): Position[] {
    const allMoves = MoveGenerator.generateMoves(this.state, this.state.turn);
    return allMoves
      .filter((m) => posEquals(m.from, pos))
      .map((m) => m.to);
  }

  /**
   * Get the current game result. Returns IN_PROGRESS if the game is ongoing.
   */
  getGameResult(): { status: GameStatus; winner: Color | null } {
    return { status: this.state.status, winner: this.state.winner };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /** Execute a normal (non-push) move on the cloned state. */
  private _executeNormalMove(state: GameState, move: Move): void {
    // Remove piece from source
    removePiece(state.board, move.from.col, move.from.row);

    // Place piece at destination
    const movedPiece: Piece = {
      type: move.piece.type,
      color: move.piece.color,
      pos: { col: move.to.col, row: move.to.row },
    };
    setPiece(state.board, move.to.col, move.to.row, movedPiece);

    // If the moved piece is an Anchor, reset its overload counter
    // (movement resets the tracking — the overload tracker key is per-position,
    // so the old key naturally becomes stale; we reset the new position)
    if (move.piece.type === PieceType.ANCHOR) {
      const newKey = `c${move.to.col}r${move.to.row}`;
      state.anchorOverloadTracker.set(newKey, 0);
    }
  }

  /** Execute a push move on the cloned state. */
  private _executePushMove(state: GameState, move: Move): void {
    // A push move moves the enemy core from `move.from` to `move.to`
    // Remove enemy core from source
    removePiece(state.board, move.from.col, move.from.row);

    // Place enemy core at destination
    const enemyColor = opponentColor(state.turn);
    const pushedPiece: Piece = {
      type: PieceType.CORE,
      color: enemyColor,
      pos: { col: move.to.col, row: move.to.row },
    };
    setPiece(state.board, move.to.col, move.to.row, pushedPiece);
  }

  private _createInitialState(): GameState {
    const state = new GameState();
    state.board = createInitialBoard();
    state.turn = Color.WHITE;
    state.status = GameStatus.IN_PROGRESS;
    state.moveHistory = [];
    state.halfMoveClock = 0;
    state.fullMoveNumber = 1;
    state.positionCount = new Map();
    state.winner = null;
    state.coreCooldown = new Map([
      [Color.WHITE, false],
      [Color.BLACK, false],
    ]);
    state.sanctuaryOccupied = null;
    state.anchorOverloadTracker = new Map();

    // Record initial position
    state.positionCount.set(boardPositionKey(state), 1);

    return state;
  }
}
