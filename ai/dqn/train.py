"""DQN Training — Nexus Gravity Chess.

Trains a DQN evaluation network via self-play reinforcement learning.
Target: beat >80% of human players after ~50K self-play games.

Usage: python -m dqn.train --games 50000
"""

import sys
import os
import random
import time
from collections import deque

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dqn.model import GravityDQN
from dqn.self_play import play_game

# ─── Hyperparameters ────────────────────────────────────────────────────────

GAMES = 50000
REPLAY_SIZE = 100000
BATCH_SIZE = 256
GAMMA = 0.95
LR = 1e-3
TARGET_UPDATE = 1000
EPSILON_START = 1.0
EPSILON_END = 0.05
EPSILON_DECAY = 30000
SAVE_INTERVAL = 5000
EVAL_GAMES = 100


class ReplayBuffer:
    def __init__(self, capacity: int):
        self.buffer = deque(maxlen=capacity)

    def push(self, exp):
        self.buffer.append(exp)

    def sample(self, batch_size: int):
        batch = random.sample(self.buffer, min(batch_size, len(self.buffer)))
        states, actions_from, actions_to, sides, rewards, next_states, dones = zip(*batch)

        states_t = torch.cat([torch.from_numpy(s) for s in states], dim=0)
        next_t = torch.cat([torch.from_numpy(s) for s in next_states], dim=0)
        rewards_t = torch.tensor(rewards, dtype=torch.float32).unsqueeze(1)
        dones_t = torch.tensor(dones, dtype=torch.float32).unsqueeze(1)

        return states_t, rewards_t, next_t, dones_t

    def __len__(self):
        return len(self.buffer)


def evaluate_vs_random(dqn, device, games: int = 100) -> float:
    """Quick evaluation: DQN vs random moves."""
    from training.gravity_rules import INITIAL_BOARD, WHITE, BLACK, get_legal_moves, _apply_move, is_sanctuary_victory, is_siege_victory, _opponent

    wins = 0
    for g in range(games):
        board = INITIAL_BOARD.copy()
        side = WHITE
        sanctuary = -1
        dqn_side = WHITE if g % 2 == 0 else BLACK
        move_count = 0

        while move_count < 200:
            moves = get_legal_moves(board, side)
            if not moves:
                break

            if side == dqn_side:
                # DQN picks best move
                best_move = moves[0]
                best_val = -float('inf')
                with torch.no_grad():
                    for m in moves:
                        nb = _apply_move(board.copy(), m)
                        t = __import__('dqn.model', fromlist=['board_to_tensor']).board_to_tensor(nb, _opponent(side)).to(device)
                        v = dqn(t).item()
                        if v > best_val:
                            best_val = v
                            best_move = m
                move = best_move
            else:
                move = random.choice(moves)

            new_board = _apply_move(board.copy(), move)
            if is_sanctuary_victory(new_board, side, sanctuary) or is_siege_victory(new_board, side):
                if side == dqn_side:
                    wins += 1
                break

            board = new_board
            side = _opponent(side)
            move_count += 1

    return wins / games


def main():
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f'Device: {device}')

    dqn = GravityDQN().to(device)
    target = GravityDQN().to(device)
    target.load_state_dict(dqn.state_dict())

    optimizer = optim.Adam(dqn.parameters(), lr=LR)
    criterion = nn.MSELoss()
    replay = ReplayBuffer(REPLAY_SIZE)

    epsilon = EPSILON_START
    steps = 0
    total_experiences = 0
    best_winrate = 0.0
    start_time = time.time()

    for game in range(1, GAMES + 1):
        epsilon = max(EPSILON_END, EPSILON_START - (EPSILON_START - EPSILON_END) * game / EPSILON_DECAY)

        experiences = play_game(dqn, epsilon, device)
        for exp in experiences:
            replay.push(exp)
            steps += 1
            total_experiences += 1

        # Training step
        if len(replay) >= BATCH_SIZE and game % 2 == 0:
            states, rewards, next_states, dones = replay.sample(BATCH_SIZE)
            states, rewards, next_states, dones = (
                states.to(device), rewards.to(device), next_states.to(device), dones.to(device)
            )

            with torch.no_grad():
                next_q = target(next_states)
                target_q = rewards + GAMMA * next_q * (1 - dones)

            current_q = dqn(states)
            loss = criterion(current_q, target_q)

            optimizer.zero_grad()
            loss.backward()
            optimizer.step()

        # Sync target network
        if steps % TARGET_UPDATE == 0:
            target.load_state_dict(dqn.state_dict())

        # Progress
        if game % 500 == 0:
            elapsed = time.time() - start_time
            winrate = evaluate_vs_random(dqn, device, EVAL_GAMES)
            print(f'Game {game:6d}/{GAMES} | eps={epsilon:.3f} | '
                  f'buffer={len(replay):6d} | winrate={winrate:.2%} | '
                  f'time={elapsed:.0f}s | exp/s={total_experiences / elapsed:.0f}')

            if winrate > best_winrate:
                best_winrate = winrate
                torch.save(dqn.state_dict(), 'dqn_best.pth')
                print(f'  -> Best model saved (winrate={winrate:.2%})')

        # Periodic save
        if game % SAVE_INTERVAL == 0:
            torch.save({
                'model': dqn.state_dict(),
                'target': target.state_dict(),
                'optimizer': optimizer.state_dict(),
                'game': game,
                'epsilon': epsilon,
            }, 'dqn_checkpoint.pth')

    # Final save
    torch.save(dqn.state_dict(), 'dqn_final.pth')
    elapsed = time.time() - start_time
    print(f'\n=== Training Complete ===')
    print(f'Games: {GAMES}, Time: {elapsed:.0f}s, Best winrate: {best_winrate:.2%}')


if __name__ == '__main__':
    main()
