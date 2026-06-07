#!/usr/bin/env python3
"""ai_move.py — Standalone AI Move Script for Nexus Gravity Chess.

Accepts a FEN string and difficulty level, runs alpha-beta search using the
gravity_rules engine, and outputs the best move as JSON to stdout.

Usage:
    python ai_move.py <fen> <difficulty>

Where:
    fen:        Nexus Gravity FEN string (7×7 board with 2-char piece codes).
    difficulty: 'beginner' | 'intermediate' | 'advanced'.

Output (JSON to stdout):
    {
        "from": "c0r6",     # Position key of source square
        "to": "c1r5",       # Position key of destination square
        "notation": "WFc0r6-c1r5",  # Human-readable move notation
        "fen": "BFBABF...",  # FEN after the move (optional)
        "score": 25.3       # Evaluation in centipawns
    }
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional, Tuple

import numpy as np

# Ensure the training module is importable.
_AI_DIR = Path(__file__).resolve().parent
if str(_AI_DIR) not in sys.path:
    sys.path.insert(0, str(_AI_DIR))

from training.gravity_rules import (
    WHITE,
    BLACK,
    EMPTY,
    WC,
    WA,
    WF,
    BC,
    BA,
    BF,
    NUM_SQUARES,
    alpha_beta_search,
    initial_board,
    sq_to_pos,
    pos_to_sq,
    tt_clear,
    zone_cache_clear,
)

# ─── Difficulty → Depth Mapping ─────────────────────────────────────────────

DIFFICULTY_DEPTH: dict[str, int] = {
    'beginner': 1,
    'intermediate': 3,
    'advanced': 5,
}


# ─── FEN Parsing ────────────────────────────────────────────────────────────

# Map 2-character piece codes to gravity_rules codes.
_PIECE_MAP: dict[str, int] = {
    'WC': WC,  # White Core
    'WA': WA,  # White Anchor
    'WF': WF,  # White Flux
    'BC': BC,  # Black Core
    'BA': BA,  # Black Anchor
    'BF': BF,  # Black Flux
}

# Reverse map for notation generation.
_CODE_TO_FEN: dict[int, str] = {
    WC: 'WC', WA: 'WA', WF: 'WF',
    BC: 'BC', BA: 'BA', BF: 'BF',
}


def fen_to_board(fen: str) -> Tuple[np.ndarray, int, int, bool]:
    """Parse a Nexus Gravity FEN string into a board array and game state.

    FEN format: "board_rows turn halfmove fullmove sanctuary"

    Returns:
        (board, side_to_move, sanctuary_occupied, core_cooldown)
        board:              49-element uint8 numpy array.
        side_to_move:       WHITE (0) or BLACK (1).
        sanctuary_occupied: -1 (none), WHITE (0), or BLACK (1).
        core_cooldown:      Always False (cooldown not encoded in FEN).
    """
    parts = fen.strip().split()
    if len(parts) < 2:
        raise ValueError(f'Invalid FEN: expected at least 2 fields, got {len(parts)}')

    board_str = parts[0]
    turn_str = parts[1]  # 'w' or 'b'
    sanctuary_str = parts[4] if len(parts) >= 5 else '-'

    side = WHITE if turn_str == 'w' else BLACK
    sanctuary = WHITE if sanctuary_str == 'w' else BLACK if sanctuary_str == 'b' else -1

    # Parse board rows.
    board = np.zeros(NUM_SQUARES, dtype=np.uint8)
    rows = board_str.split('/')
    if len(rows) != 7:
        raise ValueError(f'Invalid FEN: expected 7 board rows, got {len(rows)}')

    sq = 0
    for row in rows:
        i = 0
        while i < len(row) and sq < NUM_SQUARES:
            ch = row[i]
            if ch.isdigit():
                sq += int(ch)
                i += 1
            elif i + 1 < len(row) and row[i:i + 2] in _PIECE_MAP:
                board[sq] = _PIECE_MAP[row[i:i + 2]]
                sq += 1
                i += 2
            else:
                # Unknown character — skip (shouldn't happen with valid FEN).
                i += 1

    return board, side, sanctuary, False


def move_to_notation(
    board: np.ndarray,
    from_sq: int,
    to_sq: int,
    from_col: int,
    from_row: int,
    move_type: int,
) -> str:
    """Convert a move to human-readable notation.

    Format: "XXc{fcol}r{frow}-c{tcol}r{trow}" where XX is the piece code
    and positions are in a1..g7 notation.

    Column letters: a=0, b=1, ..., g=6
    Row numbers: 1=6 (White's back rank), 7=0 (Black's back rank)
    """
    col_labels = 'abcdefg'
    piece_code = int(board[from_sq])
    piece_fen = _CODE_TO_FEN.get(piece_code, '??')
    to_col, to_row = sq_to_pos(to_sq)

    from_pos = f'c{from_col}r{from_row}'
    to_pos = f'c{to_col}r{to_row}'

    return f'{piece_fen}{from_pos}-{to_pos}'


def format_pos_key(col: int, row: int) -> str:
    """Format a position as 'c{col}r{row}' key."""
    return f'c{col}r{row}'


# ─── Main ────────────────────────────────────────────────────────────────────


def compute_best_move(
    fen: str,
    difficulty: str = 'intermediate',
) -> dict:
    """Compute the best move for the given position.

    Args:
        fen:        Nexus Gravity FEN string.
        difficulty: 'beginner', 'intermediate', or 'advanced'.

    Returns:
        dict with keys: from, to, notation, score, fen (optional).
    """
    depth = DIFFICULTY_DEPTH.get(difficulty, 3)

    # Clear caches for a fresh search.
    tt_clear()
    zone_cache_clear()

    # Parse FEN.
    board, side, sanctuary, cooldown = fen_to_board(fen)

    # Run alpha-beta search.
    score, best_move_tuple = alpha_beta_search(
        board, side, depth,
        sanctuary_occupied=sanctuary,
        core_cooldown=cooldown,
        use_tt=True,
    )

    if best_move_tuple is None:
        # No legal moves — return a null move.
        return {
            'from': '',
            'to': '',
            'notation': '',
            'score': score,
            'fen': fen,
            'error': 'No legal moves available',
        }

    from_sq, to_sq, from_col, from_row, move_type = best_move_tuple

    # Apply the move to get the resulting FEN.
    from training.gravity_rules import _apply_move
    new_board, new_sanctuary, new_cooldown = _apply_move(
        board, from_sq, to_sq, side, move_type, sanctuary,
    )
    new_fen = board_to_fen(new_board, side, new_sanctuary)

    notation = move_to_notation(board, from_sq, to_sq, from_col, from_row, move_type)

    return {
        'from': format_pos_key(from_col, from_row),
        'to': format_pos_key(*sq_to_pos(to_sq)),
        'notation': notation,
        'score': round(score, 2),
        'fen': new_fen,
    }


def board_to_fen(board: np.ndarray, side: int, sanctuary: int) -> str:
    """Convert a board to FEN string. Inverse of fen_to_board."""
    row_strings = []
    for row_idx in range(7):
        row_str = ''
        empty_count = 0
        for col_idx in range(7):
            sq = row_idx * 7 + col_idx
            code = int(board[sq])
            if code == EMPTY:
                empty_count += 1
            else:
                if empty_count > 0:
                    row_str += str(empty_count)
                    empty_count = 0
                row_str += _CODE_TO_FEN.get(code, '??')
        if empty_count > 0:
            row_str += str(empty_count)
        row_strings.append(row_str)

    turn_char = 'w' if side == WHITE else 'b'
    sanctuary_char = 'w' if sanctuary == WHITE else 'b' if sanctuary == BLACK else '-'

    return f'{"/".join(row_strings)} {turn_char} 0 1 {sanctuary_char}'


# ─── CLI Entry Point ─────────────────────────────────────────────────────────


def main() -> None:
    """CLI entry point: read FEN + difficulty from args, output JSON to stdout."""
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'Usage: ai_move.py <fen> [difficulty]'}))
        sys.exit(1)

    fen = sys.argv[1]
    difficulty = sys.argv[2] if len(sys.argv) > 2 else 'intermediate'

    try:
        result = compute_best_move(fen, difficulty)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'error': str(exc)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == '__main__':
    main()
