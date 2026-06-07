import React, { useCallback, useMemo } from 'react';
import {
  BoardGrid,
  Piece as PieceData,
  Position,
  Move,
  Color,
  posEquals,
  posToString,
  isCenter,
} from '../engine/types';
import { getControlZone } from '../engine/gravity';
import Piece from './Piece';

// ─── Props ────────────────────────────────────────────────────────────────────

interface BoardProps {
  /** 7×7 board grid from the engine */
  board: BoardGrid;
  /** Currently selected square, or null */
  selectedPos: Position | null;
  /** Legal destination squares for the selected piece */
  legalMoves: Position[];
  /** The last move made (for highlighting) */
  lastMove: Move | null;
  /** Called when a square is clicked */
  onSquareClick: (col: number, row: number) => void;
  /** Whether the board is flipped (Black's perspective) */
  flipped?: boolean;
  /** Current turn — used for control zone visualization */
  currentTurn?: Color;
  /** Pre-computed locked positions for the current side (position string keys) */
  lockedPositions?: Set<string>;
  /** Pre-computed cooldown status for each color's core */
  coreCooldown?: Map<Color, boolean>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BOARD_SIZE = 7;
const COL_LABELS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const ROW_LABELS = ['1', '2', '3', '4', '5', '6', '7'];

// Board colors
const LIGHT_SQUARE = '#DEB887';
const DARK_SQUARE = '#6B4226';

// Control zone overlay colors (semi-transparent)
const CONTROL_ZONE_WHITE = 'rgba(255, 255, 200, 0.18)';
const CONTROL_ZONE_BLACK = 'rgba(100, 100, 100, 0.25)';
const CONTROL_ZONE_BOTH = 'rgba(180, 160, 120, 0.22)';

// d4 Sanctuary glow
const SANCTUARY_GLOW = 'rgba(255, 215, 0, 0.35)';

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders the 7×7 Nexus Gravity chess board with:
 *   - Pieces (Core / Anchor / Flux)
 *   - Gravity control zone overlay
 *   - d4 Sanctuary golden glow
 *   - Locked piece indicators
 *   - Cooldown indicator
 *   - Selection highlighting
 *   - Legal-move indicators
 *   - Last-move highlights
 */
export default function Board({
  board,
  selectedPos,
  legalMoves,
  lastMove,
  onSquareClick,
  flipped = false,
  currentTurn,
  lockedPositions,
  coreCooldown,
}: BoardProps): JSX.Element {
  // Compute control zones for both sides
  const whiteZone = useMemo(
    () => (currentTurn !== undefined ? getControlZone(board, Color.WHITE) : new Set<string>()),
    [board, currentTurn],
  );
  const blackZone = useMemo(
    () => (currentTurn !== undefined ? getControlZone(board, Color.BLACK) : new Set<string>()),
    [board, currentTurn],
  );

  const isLegalTarget = useCallback(
    (col: number, row: number): boolean => {
      return legalMoves.some((m) => m.col === col && m.row === row);
    },
    [legalMoves],
  );

  const isSelected = useCallback(
    (col: number, row: number): boolean => {
      return selectedPos !== null && selectedPos.col === col && selectedPos.row === row;
    },
    [selectedPos],
  );

  const isLastMoveSquare = useCallback(
    (col: number, row: number): boolean => {
      if (lastMove === null) return false;
      return (
        (lastMove.from.col === col && lastMove.from.row === row) ||
        (lastMove.to.col === col && lastMove.to.row === row)
      );
    },
    [lastMove],
  );

  /** Map display row to actual board row, considering flip */
  const toBoardRow = (displayRow: number): number => {
    return flipped ? BOARD_SIZE - 1 - displayRow : displayRow;
  };

  /** Map display col to actual board col, considering flip */
  const toBoardCol = (displayCol: number): number => {
    return flipped ? BOARD_SIZE - 1 - displayCol : displayCol;
  };

  const getColLabel = (displayCol: number): string => {
    const actualCol = toBoardCol(displayCol);
    return COL_LABELS[actualCol];
  };

  const getRowLabel = (displayRow: number): string => {
    const actualRow = toBoardRow(displayRow);
    return ROW_LABELS[actualRow];
  };

  const handleClick = (displayCol: number, displayRow: number): void => {
    const col = toBoardCol(displayCol);
    const row = toBoardRow(displayRow);
    onSquareClick(col, row);
  };

  /** Get the control zone overlay color for a square */
  const getControlOverlay = (col: number, row: number): string | null => {
    const key = posToString({ col, row });
    const inWhite = whiteZone.has(key);
    const inBlack = blackZone.has(key);
    if (inWhite && inBlack) return CONTROL_ZONE_BOTH;
    if (inWhite) return CONTROL_ZONE_WHITE;
    if (inBlack) return CONTROL_ZONE_BLACK;
    return null;
  };

  /** Check if a piece at this position is locked */
  const isPieceLocked = (col: number, row: number): boolean => {
    if (lockedPositions === undefined) return false;
    const key = posToString({ col, row });
    return lockedPositions.has(key);
  };

  /** Check if a Core at this position is in cooldown */
  const isPieceCooldown = (piece: PieceData | null): boolean => {
    if (piece === null || piece.type !== 'core') return false;
    if (coreCooldown === undefined) return false;
    return coreCooldown.get(piece.color) === true;
  };

  return (
    <div className="inline-flex flex-col items-center select-none">
      {/* Column labels (top) */}
      <div className="flex" style={{ paddingLeft: '24px' }}>
        {Array.from({ length: BOARD_SIZE }, (_, displayCol) => (
          <div
            key={`col-label-${displayCol}`}
            className="flex items-center justify-center text-xs font-medium"
            style={{
              width: '64px',
              height: '24px',
              color: '#8B7355',
            }}
          >
            {getColLabel(displayCol)}
          </div>
        ))}
      </div>

      {/* Board rows */}
      <div className="flex">
        {/* Row labels (left) */}
        <div className="flex flex-col">
          {Array.from({ length: BOARD_SIZE }, (_, displayRow) => (
            <div
              key={`row-label-${displayRow}`}
              className="flex items-center justify-center text-xs font-medium"
              style={{
                width: '24px',
                height: '64px',
                color: '#8B7355',
              }}
            >
              {getRowLabel(displayRow)}
            </div>
          ))}
        </div>

        {/* Chessboard grid */}
        <div
          className="grid border-2 border-amber-900/60 rounded-sm overflow-hidden"
          style={{
            gridTemplateColumns: `repeat(${BOARD_SIZE}, 64px)`,
            gridTemplateRows: `repeat(${BOARD_SIZE}, 64px)`,
          }}
        >
          {Array.from({ length: BOARD_SIZE }, (_, displayRow) =>
            Array.from({ length: BOARD_SIZE }, (_, displayCol) => {
              const boardCol = toBoardCol(displayCol);
              const boardRow = toBoardRow(displayRow);
              const piece = board[boardRow][boardCol];
              const isLight = (boardRow + boardCol) % 2 === 0;
              const selected = isSelected(boardCol, boardRow);
              const legal = isLegalTarget(boardCol, boardRow);
              const lastMoveHL = isLastMoveSquare(boardCol, boardRow);
              const isd4 = isCenter({ col: boardCol, row: boardRow });
              const locked = isPieceLocked(boardCol, boardRow);
              const cooldown = isPieceCooldown(piece);
              const controlOverlay = getControlOverlay(boardCol, boardRow);

              // Base background
              let bgColor = isLight ? LIGHT_SQUARE : DARK_SQUARE;

              // Last move highlight overrides base
              if (lastMoveHL) {
                bgColor = isLight ? '#E8D47E' : '#A89040';
              }

              return (
                <div
                  key={`${boardCol}-${boardRow}`}
                  className="relative flex items-center justify-center cursor-pointer"
                  style={{
                    backgroundColor: bgColor,
                    width: '64px',
                    height: '64px',
                    // Selected square: golden border
                    ...(selected && {
                      boxShadow: 'inset 0 0 0 3px #FFD700',
                    }),
                  }}
                  onClick={() => handleClick(displayCol, displayRow)}
                >
                  {/* Control zone overlay */}
                  {controlOverlay !== null && !isd4 && (
                    <div
                      className="absolute inset-0 pointer-events-none z-0"
                      style={{ backgroundColor: controlOverlay }}
                    />
                  )}

                  {/* d4 Sanctuary glow */}
                  {isd4 && (
                    <div
                      className="absolute inset-0 pointer-events-none z-0"
                      style={{
                        backgroundColor: SANCTUARY_GLOW,
                        boxShadow: 'inset 0 0 12px rgba(255,215,0,0.4)',
                      }}
                    />
                  )}

                  {/* d4 Center marker dot */}
                  {isd4 && (
                    <div
                      className="absolute pointer-events-none z-5"
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: 'rgba(180,150,0,0.5)',
                      }}
                    />
                  )}

                  {/* Legal move indicator */}
                  {legal && (
                    <div
                      className="absolute rounded-full pointer-events-none z-10"
                      style={{
                        width: piece !== null ? 'calc(100% - 8px)' : '18px',
                        height: piece !== null ? 'calc(100% - 8px)' : '18px',
                        backgroundColor: piece !== null ? 'transparent' : 'rgba(0,128,0,0.45)',
                        border: piece !== null ? '3px solid rgba(0,128,0,0.55)' : 'none',
                        borderRadius: piece !== null ? '8px' : '50%',
                      }}
                    />
                  )}

                  {/* Piece */}
                  {piece !== null && (
                    <div className="absolute inset-1 z-10 pointer-events-none">
                      <Piece
                        type={piece.type}
                        color={piece.color}
                        locked={locked}
                        cooldown={cooldown}
                      />
                    </div>
                  )}
                </div>
              );
            }),
          )}
        </div>
      </div>
    </div>
  );
}
