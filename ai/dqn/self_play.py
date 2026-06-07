"""DQN Self-Play for Nexus Gravity Chess.

Generates training experience by having the DQN play against itself.
Uses epsilon-greedy exploration with the DQN as evaluation function.
"""

import sys
import os
import random
import struct
from collections import deque
from typing import List, Tuple

import numpy as np
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from training.gravity_rules import (
    INITIAL_BOARD, WHITE, BLACK, get_legal_moves, _apply_move,
    is_sanctuary_victory, is_siege_victory, _opponent,
)
from dqn.model import GravityDQN, board_to_tensor

Experience = Tuple[np.ndarray, int, int, int, float, np.ndarray, bool]


def choose_move(board, side, moves, dqn, epsilon, device):
    """Choose a move using epsilon-greedy DQN policy."""
    if random.random() < epsilon:
        return random.choice(moves)

    best_move = moves[0]
    best_val = -float('inf')
    with torch.no_grad():
        for move in moves:
            new_board = _apply_move(board.copy(), move)
            next_side = _opponent(side)
            t = board_to_tensor(new_board, next_side).to(device)
            val = dqn(t).item()
            if val > best_val:
                best_val = val
                best_move = move

    return best_move


def play_game(dqn, epsilon: float, device) -> List[Experience]:
    """Play one self-play game, return list of experiences."""
    board = INITIAL_BOARD.copy()
    side = WHITE
    history: list = []
    move_count = 0
    sanctuary_occupied = -1

    while move_count < 200:
        my_zone = None  # computed inside get_legal_moves
        enemy_zone = None
        moves = get_legal_moves(board, side)

        if not moves:
            break

        move = choose_move(board, side, moves, dqn, epsilon, device)
        state_tensor = board_to_tensor(board, side)
        new_board = _apply_move(board.copy(), move)
        next_side = _opponent(side)
        next_tensor = board_to_tensor(new_board, next_side)

        # Check victory
        if is_sanctuary_victory(new_board, side, sanctuary_occupied):
            reward = 1.0
            done = True
        elif is_siege_victory(new_board, side):
            reward = 1.0
            done = True
        elif is_siege_victory(new_board, next_side):
            reward = -1.0
            done = True
        else:
            reward = 0.0
            done = False

        history.append((state_tensor.numpy(), move[0], move[1], side, reward, next_tensor.numpy(), done))

        if done:
            break

        board = new_board
        side = next_side
        move_count += 1

    return history
