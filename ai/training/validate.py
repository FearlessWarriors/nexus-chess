"""validate.py — Model Validation via Tournament Play (Gravity Rules).

Pits the newly trained model against a baseline using Alpha-Beta search
where each side uses a different evaluation function.
Computes Elo difference and win/loss/draw rates.

Usage
-----
.. code-block:: bash

    python -m training.validate --new checkpoints/model_best.pt --games 200
"""

from __future__ import annotations

import argparse
import math
import os
import random
import sys
import time
from multiprocessing import Pool
from typing import List, Optional, Tuple

import numpy as np
import torch

# Allow running as script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nnue.model import HalfKP_NNUE
from nnue.features import (
    BOARD_SIZE,
    compress_features,
    extract_features,
)

from training.gravity_rules import (
    EMPTY,
    WHITE,
    BLACK,
    INITIAL_BOARD,
    get_legal_moves,
    evaluate_board,
    is_sanctuary_victory,
    is_siege_victory,
    alpha_beta,
    _apply_move,
    _opponent,
)


# ═══════════════════════════════════════════════════════════════════════════════
# NNUE Evaluator Wrapper
# ═══════════════════════════════════════════════════════════════════════════════

class NnueEvaluator:
    """Wraps a HalfKP_NNUE model for use in Alpha-Beta search."""

    def __init__(
        self,
        model: HalfKP_NNUE,
        feature_map: dict,
        input_dim: int = 20480,
        device: str = "cpu",
    ) -> None:
        self.model = model
        self.feature_map = feature_map
        self.input_dim = input_dim
        self.device = device
        self.model.eval()

    def evaluate(self, board: np.ndarray, side: int) -> float:
        """Evaluate a board position from the perspective of `side`.

        Returns centipawn score.
        """
        raw_features = extract_features(board, side)
        vec = compress_features(raw_features, self.feature_map, self.input_dim)
        tensor = torch.from_numpy(vec).unsqueeze(0).to(self.device)
        with torch.no_grad():
            score = self.model(tensor).item()
        return score


class GravityHeuristicEvaluator:
    """Baseline gravity heuristic evaluator for comparison."""

    def evaluate(self, board: np.ndarray, side: int) -> float:
        """Gravity-lock heuristic evaluation."""
        return evaluate_board(board, side)


# ═══════════════════════════════════════════════════════════════════════════════
# Alpha-Beta with Pluggable Evaluator
# ═══════════════════════════════════════════════════════════════════════════════

def alpha_beta_eval(
    board: np.ndarray,
    side: int,
    depth: int,
    evaluator_white,
    evaluator_black,
    alpha: float = -float("inf"),
    beta: float = float("inf"),
    sanctuary_occupied: int = -1,
    core_cooldown: bool = False,
) -> float:
    """Alpha-Beta where White and Black may use different evaluators.

    Uses gravity-lock rules for move generation and victory detection.

    Args:
        board:               Current board.
        side:                Side to move.
        depth:               Remaining depth.
        evaluator_white:     Evaluator for White's perspective.
        evaluator_black:     Evaluator for Black's perspective.
        alpha, beta:         Bounds.
        sanctuary_occupied:  Sanctuary tracking.
        core_cooldown:       Core cooldown for current side.

    Returns:
        Score from perspective of `side`.
    """
    if depth == 0:
        eval_fn = evaluator_white if side == WHITE else evaluator_black
        return eval_fn.evaluate(board, side)

    moves = get_legal_moves(board, side, core_cooldown=core_cooldown)
    if not moves:
        enemy = _opponent(side)
        if is_siege_victory(board, enemy):
            return -100000.0
        return 0.0  # Draw.

    if side == WHITE:
        best = -float("inf")
        for from_sq, to_sq, fc, fr, move_type in moves:
            new_board, new_sanc, new_cd = _apply_move(
                board, from_sq, to_sq, side, move_type, sanctuary_occupied,
            )
            if is_siege_victory(new_board, side):
                return 100000.0
            if is_sanctuary_victory(new_board, side, new_sanc):
                return 100000.0
            val = alpha_beta_eval(
                new_board, BLACK, depth - 1,
                evaluator_white, evaluator_black, alpha, beta,
                sanctuary_occupied=new_sanc, core_cooldown=new_cd,
            )
            best = max(best, val)
            alpha = max(alpha, val)
            if alpha >= beta:
                break
        return best
    else:
        best = float("inf")
        for from_sq, to_sq, fc, fr, move_type in moves:
            new_board, new_sanc, new_cd = _apply_move(
                board, from_sq, to_sq, side, move_type, sanctuary_occupied,
            )
            if is_siege_victory(new_board, side):
                return -100000.0
            if is_sanctuary_victory(new_board, side, new_sanc):
                return -100000.0
            val = alpha_beta_eval(
                new_board, WHITE, depth - 1,
                evaluator_white, evaluator_black, alpha, beta,
                sanctuary_occupied=new_sanc, core_cooldown=new_cd,
            )
            best = min(best, val)
            beta = min(beta, val)
            if alpha >= beta:
                break
        return best


# ═══════════════════════════════════════════════════════════════════════════════
# Tournament Play
# ═══════════════════════════════════════════════════════════════════════════════

def play_tournament_game(
    args: Tuple[int, object, object, object, object, int],
) -> float:
    """Play a single tournament game and return the result.

    Args:
        args: ``(game_id, eval_new_white, eval_new_black,
                 eval_base_white, eval_base_black, depth)``.

    Returns:
        1.0 if new model wins, 0.0 for draw, -1.0 if new model loses.
    """
    game_id, eval_nw, eval_nb, eval_bw, eval_bb, depth = args

    board = INITIAL_BOARD.copy()
    side = WHITE
    sanctuary_occupied = -1
    core_cooldown = False
    move_count = 0
    max_moves = 200

    while move_count < max_moves:
        moves = get_legal_moves(board, side, core_cooldown=core_cooldown)
        if not moves:
            # Side to move has no legal moves — siege loss.
            if game_id % 2 == 0:  # New = White.
                return -1.0 if side == WHITE else 1.0
            else:  # New = Black.
                return 1.0 if side == WHITE else -1.0

        # Choose evaluators based on game_id parity.
        if game_id % 2 == 0:
            ew, eb = eval_nw, eval_bb  # New=White, Base=Black
        else:
            ew, eb = eval_bw, eval_nb  # Base=White, New=Black

        # Search for best move.
        best_score = -float("inf") if side == WHITE else float("inf")
        best_move = moves[0]

        for from_sq, to_sq, fc, fr, mt in moves:
            new_board, new_sanc, new_cd = _apply_move(
                board, from_sq, to_sq, side, mt, sanctuary_occupied,
            )
            # Immediate victory.
            if is_siege_victory(new_board, side):
                best_move = (from_sq, to_sq, fc, fr, mt)
                break
            if is_sanctuary_victory(new_board, side, new_sanc):
                best_move = (from_sq, to_sq, fc, fr, mt)
                break

            enemy = _opponent(side)
            score = alpha_beta_eval(
                new_board, enemy, depth - 1, ew, eb,
                sanctuary_occupied=new_sanc, core_cooldown=new_cd,
            )
            if side == WHITE and score > best_score:
                best_score, best_move = score, (from_sq, to_sq, fc, fr, mt)
            elif side == BLACK and score < best_score:
                best_score, best_move = score, (from_sq, to_sq, fc, fr, mt)

        # Apply move.
        from_sq, to_sq, fc, fr, mt = best_move
        board, sanctuary_occupied, core_cooldown = _apply_move(
            board, from_sq, to_sq, side, mt, sanctuary_occupied,
        )
        next_side = _opponent(side)
        mover = side  # Side that just moved.

        # Victory checks.
        if is_sanctuary_victory(board, mover, sanctuary_occupied):
            if game_id % 2 == 0:  # New = White.
                return 1.0 if mover == WHITE else -1.0
            else:
                return -1.0 if mover == WHITE else 1.0

        if is_siege_victory(board, mover):
            if game_id % 2 == 0:
                return 1.0 if mover == WHITE else -1.0
            else:
                return -1.0 if mover == WHITE else 1.0

        side = next_side
        move_count += 1

    # Draw (max moves reached).
    return 0.0


# ═══════════════════════════════════════════════════════════════════════════════

def run_tournament(
    evaluator_new: NnueEvaluator,
    evaluator_base: GravityHeuristicEvaluator,
    num_games: int = 200,
    depth: int = 4,
    num_workers: int = 4,
) -> dict:
    """Run a tournament between the new model and baseline.

    Args:
        evaluator_new:  NNUE evaluator for the new model.
        evaluator_base: Gravity-heuristic baseline evaluator.
        num_games:      Total games (half with new as White, half as Black).
        depth:          Alpha-Beta search depth.
        num_workers:    Parallel worker count.

    Returns:
        Dict with 'elo_diff', 'win_rate', 'wins', 'losses', 'draws'.
    """
    work_items = []
    for g in range(num_games):
        work_items.append((
            g,
            evaluator_new, evaluator_new,
            evaluator_base, evaluator_base,
            depth,
        ))

    print(f"Running {num_games} tournament games at depth {depth}...")
    t0 = time.time()

    with Pool(processes=num_workers) as pool:
        results = pool.map(play_tournament_game, work_items)

    elapsed = time.time() - t0

    wins = sum(1 for r in results if r > 0.5)
    draws = sum(1 for r in results if -0.5 < r < 0.5)
    losses = sum(1 for r in results if r < -0.5)

    win_rate = wins / max(num_games, 1)
    draw_rate = draws / max(num_games, 1)
    loss_rate = losses / max(num_games, 1)

    effective_score = (wins + 0.5 * draws) / max(num_games, 1)
    if effective_score > 0 and effective_score < 1:
        elo_diff = -400.0 * math.log10(1.0 / effective_score - 1.0)
    elif effective_score >= 1:
        elo_diff = 800.0
    else:
        elo_diff = -800.0

    print(f"\n=== Tournament Results ===")
    print(f"  Games:       {num_games}")
    print(f"  New wins:    {wins}")
    print(f"  Draws:       {draws}")
    print(f"  New losses:  {losses}")
    print(f"  Win rate:    {win_rate:.1%}")
    print(f"  Elo diff:    {elo_diff:+.1f}")
    print(f"  Time:        {elapsed:.1f}s")
    print(f"  Games/sec:   {num_games / max(elapsed, 0.001):.1f}")

    return {
        "elo_diff": round(elo_diff, 1),
        "win_rate": round(win_rate, 4),
        "wins": wins,
        "losses": losses,
        "draws": draws,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def main() -> None:
    """Validation script entry point."""
    parser = argparse.ArgumentParser(
        description="Nexus Chess Model Validation — Tournament (Gravity Rules)"
    )
    parser.add_argument(
        "--new", type=str, default="checkpoints/model_best.pt",
        help="Path to the new model checkpoint."
    )
    parser.add_argument(
        "--feature-map", type=str, default="data/train_data_feature_map.npy",
        help="Path to the feature map .npy file."
    )
    parser.add_argument(
        "--games", type=int, default=200,
        help="Number of tournament games (default: 200)."
    )
    parser.add_argument(
        "--depth", type=int, default=4,
        help="Alpha-Beta search depth (default: 4)."
    )
    parser.add_argument(
        "--workers", type=int, default=4,
        help="Number of parallel workers (default: 4)."
    )
    parser.add_argument(
        "--device", type=str, default="cpu",
        help="Device for NNUE inference."
    )
    args = parser.parse_args()

    # Load new model.
    if not os.path.exists(args.new):
        print(f"ERROR: Model checkpoint '{args.new}' not found.")
        sys.exit(1)

    print(f"Loading model from {args.new}...")
    model = HalfKP_NNUE.from_checkpoint(args.new, device=args.device)

    # Load feature map.
    feature_map: dict = {}
    if os.path.exists(args.feature_map):
        feature_map = np.load(args.feature_map, allow_pickle=True).item()
        print(f"Loaded feature map with {len(feature_map)} entries")
    else:
        print(f"WARNING: Feature map '{args.feature_map}' not found. "
              f"Using empty map (NNUE may underperform).")

    evaluator_new = NnueEvaluator(
        model, feature_map, input_dim=model.input_size, device=args.device
    )
    evaluator_base = GravityHeuristicEvaluator()

    run_tournament(
        evaluator_new,
        evaluator_base,
        num_games=args.games,
        depth=args.depth,
        num_workers=args.workers,
    )


if __name__ == "__main__":
    main()
