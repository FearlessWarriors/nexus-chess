/**
 * BadgeChip.tsx — Visual badge chip displayed next to usernames
 *
 * Supports:
 *   - top10:  Gold-to-red gradient (#FFD700 → #DC143C), white text, 🏆 icon
 *   - top100: Red background (#DC143C), white text, 🏆 icon
 *   - top500: White background (#FFFFFF), dark text, 🏆 icon
 *   - admin:  Gold background (#FFD700), dark text, 👑 icon
 *   - Default badge text fallback: "Top 10" / "Top 100" / "Top 500"
 */

import React from 'react';
import { Chip } from '@mui/material';
import { EmojiEvents as TrophyIcon, Shield as AdminIcon } from '@mui/icons-material';

// ─── Types ───────────────────────────────────────────────────────────────────

export type BadgeType = 'top10' | 'top100' | 'top500' | 'admin' | '';

export interface BadgeChipProps {
  /** The badge type determining color scheme */
  badgeType: BadgeType;
  /** Display text (user-customized or default). Falls back to "Top N" if empty. */
  badgeText?: string;
  /** Size variant */
  size?: 'small' | 'medium';
  /** Additional className for Tailwind */
  className?: string;
}

// ─── Default text mapping ────────────────────────────────────────────────────

const DEFAULT_BADGE_TEXT: Record<string, string> = {
  top10: 'Top 10',
  top100: 'Top 100',
  top500: 'Top 500',
  admin: 'ADMIN',
};

// ─── Style maps ──────────────────────────────────────────────────────────────

interface BadgeStyle {
  background: string;
  color: string;
  border: string;
  icon: React.ReactElement;
}

function getBadgeStyle(badgeType: BadgeType): BadgeStyle | null {
  switch (badgeType) {
    case 'top10':
      return {
        background: 'linear-gradient(135deg, #FFD700 0%, #DC143C 100%)',
        color: '#FFFFFF',
        border: '1px solid rgba(255, 215, 0, 0.5)',
        icon: <TrophyIcon sx={{ fontSize: 12 }} />,
      };
    case 'top100':
      return {
        background: '#DC143C',
        color: '#FFFFFF',
        border: '1px solid rgba(220, 20, 60, 0.6)',
        icon: <TrophyIcon sx={{ fontSize: 12 }} />,
      };
    case 'top500':
      return {
        background: '#FFFFFF',
        color: '#1a1a1a',
        border: '1px solid #ccc',
        icon: <TrophyIcon sx={{ fontSize: 12, color: '#888' }} />,
      };
    case 'admin':
      return {
        background: 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)',
        color: '#1a1a1a',
        border: '1px solid rgba(255, 215, 0, 0.7)',
        icon: <AdminIcon sx={{ fontSize: 12 }} />,
      };
    default:
      return null;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * BadgeChip renders a styled badge next to player names.
 *
 * Usage:
 *   <BadgeChip badgeType="top10" badgeText="战术大师" size="small" />
 */
export default function BadgeChip({
  badgeType,
  badgeText,
  size = 'small',
  className,
}: BadgeChipProps): JSX.Element | null {
  if (badgeType === '' || badgeType === undefined) {
    return null;
  }

  const style = getBadgeStyle(badgeType);
  if (style === null) {
    return null;
  }

  const displayText = (badgeText && badgeText.trim().length > 0)
    ? badgeText.trim()
    : (DEFAULT_BADGE_TEXT[badgeType] ?? badgeType);

  const isSmall = size === 'small';

  return (
    <Chip
      icon={style.icon}
      label={displayText}
      size={isSmall ? 'small' : 'medium'}
      className={className}
      sx={{
        height: isSmall ? 20 : 24,
        fontSize: isSmall ? '0.6rem' : '0.7rem',
        fontWeight: 700,
        background: style.background,
        color: style.color,
        border: style.border,
        '& .MuiChip-icon': {
          color: 'inherit',
          marginLeft: '4px',
        },
        '& .MuiChip-label': {
          paddingLeft: 2,
          paddingRight: 6,
          lineHeight: 1,
        },
        letterSpacing: 0.3,
        flexShrink: 0,
      }}
    />
  );
}
