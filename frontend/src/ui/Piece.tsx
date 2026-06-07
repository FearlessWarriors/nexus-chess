import React from 'react';
import { PieceType, Color } from '../engine/types';

// ─── Props ────────────────────────────────────────────────────────────────────

interface PieceProps {
  type: PieceType;
  color: Color;
  /** Piece is locked (cannot move) */
  locked?: boolean;
  /** Piece (Core) is in cooldown after being pushed */
  cooldown?: boolean;
}

// ─── Color Palette ────────────────────────────────────────────────────────────

const PIECE_COLORS: Record<Color, { fill: string; stroke: string; shadow: string }> = {
  [Color.WHITE]: {
    fill: '#FFF8DC',
    stroke: '#8B7355',
    shadow: 'drop-shadow(1px 2px 2px rgba(0,0,0,0.35))',
  },
  [Color.BLACK]: {
    fill: '#1A1A1A',
    stroke: '#444444',
    shadow: 'drop-shadow(1px 2px 2px rgba(0,0,0,0.55))',
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Renders a single chess piece as an inline SVG based on type, color,
 * and visual state (locked / cooldown).
 */
export default function Piece({
  type,
  color,
  locked = false,
  cooldown = false,
}: PieceProps): JSX.Element {
  const palette = PIECE_COLORS[color];

  const wrapperStyle: React.CSSProperties = {
    filter: palette.shadow,
    opacity: locked ? 0.45 : 1,
    transition: 'opacity 0.3s ease, filter 0.3s ease',
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Locked indicator */}
      {locked && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <svg viewBox="0 0 24 24" width="60%" height="60%" style={{ opacity: 0.7 }}>
            <rect
              x="5"
              y="11"
              width="14"
              height="10"
              rx="2"
              fill="none"
              stroke="#FF4444"
              strokeWidth="2"
            />
            <path
              d="M8 11V7a4 4 0 1 1 8 0v4"
              fill="none"
              stroke="#FF4444"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}

      {/* Cooldown pulse (Core only) */}
      {cooldown && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 15,
            pointerEvents: 'none',
          }}
        >
          <svg viewBox="0 0 100 100" width="100%" height="100%">
            <circle
              cx="50"
              cy="50"
              r="46"
              fill="none"
              stroke="#4488FF"
              strokeWidth="4"
              opacity={0.7}
            >
              <animate
                attributeName="opacity"
                values="0.7;0.2;0.7"
                dur="1.2s"
                repeatCount="indefinite"
              />
              <animate
                attributeName="r"
                values="46;42;46"
                dur="1.2s"
                repeatCount="indefinite"
              />
            </circle>
          </svg>
        </div>
      )}

      {/* Piece SVG */}
      <div style={wrapperStyle}>
        {type === PieceType.CORE && <CorePiece palette={palette} />}
        {type === PieceType.ANCHOR && <AnchorPiece palette={palette} />}
        {type === PieceType.FLUX && <FluxPiece palette={palette} />}
      </div>
    </div>
  );
}

// ─── Sub-renderers ────────────────────────────────────────────────────────────

interface Palette {
  fill: string;
  stroke: string;
  shadow: string;
}

/** Core: eight-pointed star (八芒星) — minimal, elegant */
function CorePiece({ palette }: { palette: Palette }): JSX.Element {
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
    >
      {/* Outer glow ring */}
      <circle
        cx="50"
        cy="50"
        r="44"
        fill="none"
        stroke={palette.stroke}
        strokeWidth="3"
        opacity={0.6}
      />
      <circle
        cx="50"
        cy="50"
        r="38"
        fill={palette.fill}
        stroke={palette.stroke}
        strokeWidth="2.5"
      />
      {/* Octagram star */}
      <polygon
        points="50,12 59,34 83,34 64,49 71,71 50,57 29,71 36,49 17,34 41,34"
        fill={palette.stroke}
        stroke={palette.fill}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Center dot */}
      <circle
        cx="50"
        cy="50"
        r="6"
        fill={palette.fill}
        stroke={palette.stroke}
        strokeWidth="1"
      />
    </svg>
  );
}

/**
 * Anchor: solid circle + crosshair lines (symbolizing stable strongpoint).
 * The cross represents the orthogonal infinite control lines.
 */
function AnchorPiece({ palette }: { palette: Palette }): JSX.Element {
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
    >
      {/* Crosshair lines (control zone hint) */}
      <line
        x1="10" y1="50" x2="90" y2="50"
        stroke={palette.stroke}
        strokeWidth="2"
        opacity={0.5}
      />
      <line
        x1="50" y1="10" x2="50" y2="90"
        stroke={palette.stroke}
        strokeWidth="2"
        opacity={0.5}
      />
      {/* Solid disc — symbolizing the anchor / strongpoint */}
      <circle
        cx="50"
        cy="50"
        r="30"
        fill={palette.fill}
        stroke={palette.stroke}
        strokeWidth="3"
      />
      {/* Anchor icon: central dot with horizontal bar */}
      <circle
        cx="50"
        cy="50"
        r="8"
        fill={palette.stroke}
      />
      <line
        x1="38" y1="42" x2="62" y2="42"
        stroke={palette.stroke}
        strokeWidth="4"
        strokeLinecap="round"
      />
      {/* Small dots at cardinal positions */}
      <circle cx="50" cy="22" r="3" fill={palette.stroke} opacity={0.7} />
      <circle cx="78" cy="50" r="3" fill={palette.stroke} opacity={0.7} />
      <circle cx="50" cy="78" r="3" fill={palette.stroke} opacity={0.7} />
      <circle cx="22" cy="50" r="3" fill={palette.stroke} opacity={0.7} />
    </svg>
  );
}

/**
 * Flux: hollow diamond + trail dots (symbolizing fluidity and speed).
 * Eight surrounding dots indicate the 8 jump landing spots.
 */
function FluxPiece({ palette }: { palette: Palette }): JSX.Element {
  return (
    <svg
      viewBox="0 0 100 100"
      width="100%"
      height="100%"
    >
      {/* Outer diamond (hollow) */}
      <polygon
        points="50,8 90,50 50,92 10,50"
        fill={palette.fill}
        stroke={palette.stroke}
        strokeWidth="2.5"
        strokeLinejoin="round"
        opacity={0.85}
      />
      {/* Inner diamond (smaller, offset) */}
      <polygon
        points="50,22 72,50 50,78 28,50"
        fill="none"
        stroke={palette.stroke}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      {/* Trail dots at 8 directions (landing spots) */}
      <circle cx="50" cy="16" r="3" fill={palette.stroke} opacity={0.8} />
      <circle cx="77" cy="27" r="3" fill={palette.stroke} opacity={0.8} />
      <circle cx="84" cy="50" r="3" fill={palette.stroke} opacity={0.8} />
      <circle cx="77" cy="73" r="3" fill={palette.stroke} opacity={0.8} />
      <circle cx="50" cy="84" r="3" fill={palette.stroke} opacity={0.8} />
      <circle cx="23" cy="73" r="3" fill={palette.stroke} opacity={0.8} />
      <circle cx="16" cy="50" r="3" fill={palette.stroke} opacity={0.8} />
      <circle cx="23" cy="27" r="3" fill={palette.stroke} opacity={0.8} />
      {/* Center marker */}
      <circle cx="50" cy="50" r="4" fill={palette.stroke} />
    </svg>
  );
}
