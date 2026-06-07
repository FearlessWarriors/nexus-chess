/**
 * gravity.ts — Gravity Control Zone & Lock Detection
 *
 * This module is the single source of truth for:
 *   1. Control-zone computation (what squares each side "controls")
 *   2. Locked-piece detection (which pieces cannot move because they
 *      stand inside the opponent's gravity well)
 *
 * It is intentionally kept separate from rules.ts and movegen.ts so
 * both can import it without creating circular dependencies.
 */

import {
  BoardGrid,
  Piece,
  PieceType,
  Color,
  Position,
  BOARD_SIZE,
  CORE_EVOLVE_ROW,
  isValidPosition,
  isCenter,
  posToString,
  posFromString,
} from './types';
import { getPieces } from './board';

// ─── Direction Vectors ────────────────────────────────────────────────────────

/** 8 compass directions: N, NE, E, SE, S, SW, W, NW */
export const ALL_DIRECTIONS: Position[] = [
  { col: 0, row: -1 },
  { col: 1, row: -1 },
  { col: 1, row: 0 },
  { col: 1, row: 1 },
  { col: 0, row: 1 },
  { col: -1, row: 1 },
  { col: -1, row: 0 },
  { col: -1, row: -1 },
];

/** 4 orthogonal directions: N, E, S, W */
export const ORTHOGONAL_DIRECTIONS: Position[] = [
  { col: 0, row: -1 },
  { col: 1, row: 0 },
  { col: 0, row: 1 },
  { col: -1, row: 0 },
];

// ─── Control Zone Computation ─────────────────────────────────────────────────

/**
 * Compute the full gravity control zone for `color`.
 *
 * Control zone = union of every friendly piece's individual reach,
 * MINUS d4 (the Sanctuary, which is never controlled),
 * MINUS any square that an **enemy Anchor** controls (Anchor control
 * cannot be overridden by the opposing side).
 *
 * Returns a Set of position strings ("d4", "e5", …).
 */
export function getControlZone(board: BoardGrid, color: Color): Set<string> {
  const zone = new Set<string>();
  const pieces = getPieces(board, color);

  for (const piece of pieces) {
    switch (piece.type) {
      case PieceType.CORE:
        addCoreControl(piece, zone);
        break;
      case PieceType.ANCHOR:
        addAnchorControl(piece, zone);
        break;
      case PieceType.FLUX:
        addFluxControl(piece, zone);
        break;
    }
  }

  // 1. Remove d4 (Sanctuary) — it is never part of any control zone.
  zone.delete(posToString({ col: 3, row: 3 }));

  // 2. Remove squares controlled by enemy Anchors (their control is absolute).
  const enemyColor = color === Color.WHITE ? Color.BLACK : Color.WHITE;
  const enemyAnchors = getPieces(board, enemyColor).filter(
    (p) => p.type === PieceType.ANCHOR,
  );
  for (const anchor of enemyAnchors) {
    removeAnchorFromZone(anchor, zone);
  }

  return zone;
}

// ─── Individual piece control helpers ─────────────────────────────────────────

/**
 * Core controls its 8-neighbourhood. When the Core is at row 3 (the middle row,
 * CORE_EVOLVE_ROW), it **evolves** and additionally controls the four
 * orthogonal-2 squares: (col, row-2), (col, row+2), (col-2, row), (col+2, row).
 *
 * Evolution is checked on row equality ONLY (col is irrelevant — any Core on
 * row 3 is evolved).
 */
function addCoreControl(core: Piece, zone: Set<string>): void {
  // The core always controls its own square (its gravity center).
  // Without this, a core that advances alone becomes "isolated" and locked,
  // which would penalize the AI for pursuing the sanctuary victory condition.
  zone.add(posToString(core.pos));

  // 8-neighbourhood (always)
  for (const dir of ALL_DIRECTIONS) {
    const p: Position = {
      col: core.pos.col + dir.col,
      row: core.pos.row + dir.row,
    };
    if (isValidPosition(p)) {
      zone.add(posToString(p));
    }
  }

  // Evolved: row === CORE_EVOLVE_ROW → add orthogonal range-2 squares
  if (core.pos.row === CORE_EVOLVE_ROW) {
    const range2Offsets: Position[] = [
      { col: 0, row: -2 },
      { col: 0, row: 2 },
      { col: -2, row: 0 },
      { col: 2, row: 0 },
    ];
    for (const offset of range2Offsets) {
      const p: Position = {
        col: core.pos.col + offset.col,
        row: core.pos.row + offset.row,
      };
      if (isValidPosition(p)) {
        zone.add(posToString(p));
      }
    }
  }
}

/**
 * Anchor controls:
 *   1. Four orthogonal infinite lines (stopped only by board edges).
 *   2. Its own four orthogonal neighbours (same as line range-1, but
 *      included for clarity — they are already covered by the lines).
 */
function addAnchorControl(anchor: Piece, zone: Set<string>): void {
  for (const dir of ORTHOGONAL_DIRECTIONS) {
    let step = 1;
    while (true) {
      const p: Position = {
        col: anchor.pos.col + dir.col * step,
        row: anchor.pos.row + dir.row * step,
      };
      if (!isValidPosition(p)) {
        break;
      }
      zone.add(posToString(p));
      step++;
    }
  }
}

/** Flux controls the 8 squares at range 2 (the jump landing spots). */
function addFluxControl(flux: Piece, zone: Set<string>): void {
  for (const dir of ALL_DIRECTIONS) {
    const p: Position = {
      col: flux.pos.col + dir.col * 2,
      row: flux.pos.row + dir.row * 2,
    };
    if (isValidPosition(p)) {
      zone.add(posToString(p));
    }
  }
}

/**
 * Remove all squares that `anchor` controls from `zone`.
 * Used to enforce "Anchor control cannot be overridden by the enemy".
 */
function removeAnchorFromZone(anchor: Piece, zone: Set<string>): void {
  for (const dir of ORTHOGONAL_DIRECTIONS) {
    let step = 1;
    while (true) {
      const p: Position = {
        col: anchor.pos.col + dir.col * step,
        row: anchor.pos.row + dir.row * step,
      };
      if (!isValidPosition(p)) {
        break;
      }
      zone.delete(posToString(p));
      step++;
    }
  }
}

// ─── Lock Detection ───────────────────────────────────────────────────────────

/**
 * Determine whether `piece` is locked (cannot move) under the gravity rules.
 *
 * Lock rules:
 *   - Flux: NEVER locked (immune).
 *   - Core: locked ONLY if isolated (no friendly control zone covers it).
 *           Otherwise immune.
 *   - Anchor: locked if its square lies inside the enemy control zone.
 *
 * @param piece          The piece to test.
 * @param board          The current board.
 * @param myControlZone  Pre-computed control zone for `piece.color` (optional;
 *                       computed on-the-fly if omitted).
 * @param enemyControlZone Pre-computed control zone for the opponent (optional).
 */
export function isLocked(
  piece: Piece,
  board: BoardGrid,
  myControlZone?: Set<string>,
  enemyControlZone?: Set<string>,
): boolean {
  // Flux is always immune
  if (piece.type === PieceType.FLUX) {
    return false;
  }

  const myZone = myControlZone ?? getControlZone(board, piece.color);
  const enemyZone =
    enemyControlZone ??
    getControlZone(board, piece.color === Color.WHITE ? Color.BLACK : Color.WHITE);

  const posKey = posToString(piece.pos);

  if (piece.type === PieceType.CORE) {
    // Core is immune unless isolated (not covered by its own control zone)
    const isIsolated = !myZone.has(posKey);
    return isIsolated;
  }

  // Anchor: locked if in enemy control zone
  if (piece.type === PieceType.ANCHOR) {
    return enemyZone.has(posKey);
  }

  return false;
}

/**
 * Get all locked pieces for `color`.
 * Returns a list of pieces that cannot move this turn.
 */
export function getLockedPieces(
  board: BoardGrid,
  color: Color,
): Piece[] {
  const pieces = getPieces(board, color);
  const myZone = getControlZone(board, color);
  const enemyColor = color === Color.WHITE ? Color.BLACK : Color.WHITE;
  const enemyZone = getControlZone(board, enemyColor);

  return pieces.filter((p) => isLocked(p, board, myZone, enemyZone));
}

/**
 * Check if a Core is in evolved state (on the middle row).
 * Returns true if the core's row matches CORE_EVOLVE_ROW.
 */
export function isCoreEvolved(core: Piece): boolean {
  return core.type === PieceType.CORE && core.pos.row === CORE_EVOLVE_ROW;
}
