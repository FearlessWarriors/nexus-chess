"""self_play.py — Gravity-Lock Self-Play Game Generation for Nexus Chess NNUE.

Generates board positions with associated search scores via Alpha-Beta search
using the gravity-lock rules engine (``gravity_rules.py``).  Outputs binary
position files consumed by ``data_gen.py`` for deep-search labeling.

Uses ``alpha_beta_search()`` (single-pass best move + score) with transposition
table for dramatic speedup over per-move search loops.

Usage
-----
.. code-block:: bash

    python -m training.self_play --games 5000 --workers 8 --output data/positions/

The first 3 moves of each game use biased diversity sampling (top-N weighted)
to ensure varied opening coverage while maintaining quality.
"""

from __future__ import annotations

import argparse
import os
import random
import struct
import sys
import time
from multiprocessing import Pool
from typing import List, Optional, Tuple

import numpy as np

# Allow running as script from ai/ directory.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nnue.features import BOARD_SIZE, extract_features, PIECE_CODE_MAP

from training.gravity_rules import (
    EMPTY,
    WHITE,
    BLACK,
    NUM_SQUARES,
    INITIAL_BOARD,
    get_legal_moves,
    get_control_zone,
    is_locked,
    is_sanctuary_victory,
    is_siege_victory,
    evaluate_board,
    alpha_beta_search,
    _apply_move,
    _score_move,
    sq_to_pos,
    pos_to_sq,
    _piece_color,
    _opponent,
    _find_core,
    tt_clear,
)


# ═══════════════════════════════════════════════════════════════════════════════
# Self-Play Game
# ═══════════════════════════════════════════════════════════════════════════════

def play_game(
    game_id: int,
    search_depth: int = 4,
    noise_moves: int = 3,
    max_moves: int = 120,
) -> List[Tuple[bytes, float, float]]:
    """Play a single self-play game and record positions.

    Uses ``alpha_beta_search()`` for single-pass evaluation — this returns
    both the best move and the position score in one search call, avoiding
    the wasteful per-move loop from earlier versions.

    Opening diversity: first ``noise_moves`` moves use biased weighted sampling
    from the top-3 candidate moves (higher scored = higher probability) instead
    of pure random selection, ensuring varied but quality-gated openings.

    Args:
        game_id:      Unique game identifier (for seeding).
        search_depth: Alpha-Beta search depth.
        noise_moves:  Number of opening moves with biased diversity sampling.
        max_moves:    Maximum moves before adjudicating draw.

    Returns:
        List of ``(board_bytes, search_score, game_result)`` tuples.
    """
    rng = random.Random(game_id * 31337 + int(time.time() * 1000) % 1000000)

    board = INITIAL_BOARD.copy()
    side = WHITE  # White starts.
    sanctuary_occupied = -1
    core_cooldown = False
    records: List[Tuple[bytes, float, float]] = []
    move_count = 0
    result: float = 0.0  # TBD.

    while move_count < max_moves:
        moves = get_legal_moves(board, side, core_cooldown=core_cooldown)
        if not moves:
            # No legal moves → siege loss for side to move.
            result = -1.0 if side == WHITE else 1.0
            records = [(b, s, result) for b, s, _ in records]
            return records

        # Single-pass search: score + best move via alpha_beta_search.
        search_score, best_move = alpha_beta_search(
            board, side, search_depth,
            sanctuary_occupied=sanctuary_occupied,
            core_cooldown=core_cooldown,
            use_tt=True,
        )

        # ── Move selection ────────────────────────────────────────────────
        if move_count < noise_moves and len(moves) > 1:
            # Biased diversity: use fast heuristic move scoring (TT order).
            # Score candidates via _score_move (O(1) per move, no search).
            my_zone = get_control_zone(board, side)
            enemy_zone = get_control_zone(board, _opponent(side))
            scored = []
            for move in moves:
                from_sq, to_sq, fc, fr, mt = move
                s = _score_move(board, side, from_sq, to_sq, fc, fr, mt,
                                my_zone, enemy_zone)
                scored.append((s, move))

            # Sort: higher score first for both sides (heuristic is side-aware).
            scored.sort(key=lambda x: x[0], reverse=True)

            # Weighted selection from top-k.
            top_k = min(3, len(scored))
            top_candidates = scored[:top_k]
            temperature = 500.0
            min_h = min(s for s, _ in top_candidates)
            weights = [np.exp((s - min_h) / temperature) for s, _ in top_candidates]
            total_weight = sum(weights)
            probs = [w / total_weight for w in weights]

            # Weighted random selection.
            r = rng.random()
            cumulative = 0.0
            chosen_idx = 0
            for i, p in enumerate(probs):
                cumulative += p
                if r <= cumulative:
                    chosen_idx = i
                    break
            chosen = top_candidates[chosen_idx][1]
        else:
            # Deterministic: use the best move from alpha_beta_search.
            if best_move is not None:
                chosen = best_move
            else:
                # Fallback: pick the first move (should never happen with TT).
                chosen = moves[0]

        # Record position BEFORE the move.
        board_bytes = board.tobytes()
        records.append((board_bytes, search_score, 0.0))

        # Apply the move.
        from_sq, to_sq, fc, fr, mt = chosen
        board, sanctuary_occupied, core_cooldown = _apply_move(
            board, from_sq, to_sq, side, mt, sanctuary_occupied,
        )
        side = _opponent(side)

        # Victory checks AFTER move.
        mover = _opponent(side)
        if is_sanctuary_victory(board, mover, sanctuary_occupied):
            result = 1.0 if mover == WHITE else -1.0
            records = [(b, s, result) for b, s, _ in records]
            return records
        if is_siege_victory(board, mover):
            result = 1.0 if mover == WHITE else -1.0
            records = [(b, s, result) for b, s, _ in records]
            return records

        move_count += 1

    # Max moves reached — draw.
    records = [(b, s, 0.0) for b, s, _ in records]
    return records


# ═══════════════════════════════════════════════════════════════════════════════
# Parallel Game Worker
# ═══════════════════════════════════════════════════════════════════════════════

def _worker(args: Tuple[int, int, str]) -> Tuple[int, int]:
    """Worker function for multiprocessing pool.

    Each worker clears its TT at the start to avoid cross-game contamination.

    Args:
        args: ``(start_id, num_games, output_dir)``.

    Returns:
        ``(positions_written, games_completed)``.
    """
    start_id, num_games, output_dir = args
    total_positions = 0

    # Clear TT for this worker to start fresh.
    tt_clear()

    for g in range(num_games):
        game_id = start_id + g
        records = play_game(game_id)
        total_positions += len(records)

        out_path = os.path.join(output_dir, f"game_{game_id:06d}.bin")
        with open(out_path, "wb") as f:
            f.write(struct.pack("<I", len(records)))
            for board_bytes, score, result in records:
                f.write(board_bytes)
                f.write(struct.pack("<f", score))
                f.write(struct.pack("<f", result))

    return total_positions, num_games


# ═══════════════════════════════════════════════════════════════════════════════
# Main Entry Point
# ═══════════════════════════════════════════════════════════════════════════════

def main() -> None:
    """Self-play data generation entry point."""
    parser = argparse.ArgumentParser(
        description="Nexus Chess Self-Play Data Generation (Gravity-Lock Rules)"
    )
    parser.add_argument(
        "--games", type=int, default=5000,
        help="Total number of self-play games to generate (default: 5000)."
    )
    parser.add_argument(
        "--workers", type=int, default=8,
        help="Number of parallel worker processes (default: 8)."
    )
    parser.add_argument(
        "--output", type=str, default="data/positions/",
        help="Output directory for binary position files."
    )
    parser.add_argument(
        "--depth", type=int, default=4,
        help="Alpha-Beta search depth (default: 4)."
    )
    parser.add_argument(
        "--noise", type=int, default=3,
        help="Number of opening noise moves with biased diversity (default: 3)."
    )
    args = parser.parse_args()

    os.makedirs(args.output, exist_ok=True)

    print(f"=== Nexus Self-Play Data Generation (Gravity-Lock) ===")
    print(f"  Games:       {args.games}")
    print(f"  Workers:     {args.workers}")
    print(f"  Output:      {args.output}")
    print(f"  Depth:       {args.depth}")
    print(f"  Noise moves: {args.noise}")
    print(f"  TT:          enabled (500K entries)")
    print()

    games_per_worker = args.games // args.workers
    remainder = args.games % args.workers

    worker_args: List[Tuple[int, int, str]] = []
    start = 0
    for w in range(args.workers):
        n = games_per_worker + (1 if w < remainder else 0)
        if n > 0:
            worker_args.append((start, n, args.output))
            start += n

    print(f"Launching {len(worker_args)} workers...")
    t0 = time.time()

    with Pool(processes=min(args.workers, len(worker_args))) as pool:
        results = pool.map(_worker, worker_args)

    total_positions = sum(r[0] for r in results)
    total_games = sum(r[1] for r in results)
    elapsed = time.time() - t0

    print(f"\n=== Complete ===")
    print(f"  Games:         {total_games}")
    print(f"  Positions:     {total_positions}")
    print(f"  Time:          {elapsed:.1f}s")
    print(f"  Pos/sec:       {total_positions / max(elapsed, 0.001):.1f}")
    print(f"  Avg pos/game:  {total_positions / max(total_games, 1):.1f}")


if __name__ == "__main__":
    main()
