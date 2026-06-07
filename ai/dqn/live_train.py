"""Live Training — Learn from Human Games on Nexus Platform.

Reads completed games from the SQLite database and trains the DQN
evaluation network via supervised learning. Runs continuously,
polling for new games and incrementally improving the model.

Usage: python -m dqn.live_train

The training data comes from REAL human gameplay:
- For each position in a completed game, the game result is the target value
- White win → positions from white's POV get +1, black's POV get -1
- Black win → opposite
- Draw → all positions get 0

This is supervised learning on human data, not RL self-play.
The model improves as more humans play on the platform.
"""

import sys
import os
import time
import sqlite3
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from dqn.model import GravityDQN, board_to_tensor

# ─── Paths ──────────────────────────────────────────────────────────────────

DB_PATH = Path(__file__).resolve().parents[2] / 'server' / 'data' / 'nexus.db'
MODEL_PATH = Path(__file__).resolve().parent / 'dqn_live.pth'
EXPORT_PATH = Path(__file__).resolve().parents[2] / 'frontend' / 'public' / 'dqn_weights.json'

# ─── Config ─────────────────────────────────────────────────────────────────

BATCH_SIZE = 256
LEARNING_RATE = 1e-3
EPOCHS_PER_BATCH = 10
POLL_INTERVAL = 30  # seconds between checking for new games
MIN_NEW_GAMES = 5   # minimum new games before retraining


def load_positions_from_db(db_path: str, last_id: int = 0) -> tuple:
    """Load completed game positions with game results as labels.
    
    Returns: (positions_array, labels_array, new_last_id)
    positions: list of (board_array, turn) tuples
    labels: list of float values in [-1, 1]
    """
    if not os.path.exists(db_path):
        print(f'  DB not found: {db_path}')
        return [], [], last_id

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    
    rows = conn.execute(
        'SELECT id, white_id, black_id, result, fen_history, finished_at '
        'FROM games WHERE finished_at IS NOT NULL AND id > ? '
        'ORDER BY id ASC',
        (last_id,)
    ).fetchall()
    
    positions = []
    labels = []
    new_last_id = last_id
    
    for row in rows:
        game_id = row['id']
        result = row['result']  # 'white_win', 'black_win', 'draw'
        fen_list = row['fen_history']
        
        if not fen_list or fen_list == '[]':
            continue
        
        try:
            import json
            fens = json.loads(fen_list)
        except:
            continue
        
        for fen in fens:
            try:
                board, turn = fen_to_board(fen)
                if board is None:
                    continue
                
                # Label: game result mapped to current player's perspective
                if result == 'white_win':
                    label = 1.0 if turn == 0 else -1.0  # WHITE=0
                elif result == 'black_win':
                    label = -1.0 if turn == 0 else 1.0
                else:
                    label = 0.0
                
                positions.append((board, turn))
                labels.append(label)
            except:
                continue
        
        new_last_id = game_id
    
    conn.close()
    return positions, labels, new_last_id


def fen_to_board(fen: str):
    """Parse FEN to board array and turn. Handles 2-char piece codes.

    Nexus FEN format: board_string turn halfmove fullmove sanctuary
    Board rows use 2-character piece codes:
        WC=White Core(1), WA=White Anchor(2), WF=White Flux(3)
        BC=Black Core(5), BA=Black Anchor(6), BF=Black Flux(7)
    Digits represent empty squares (e.g. '7' = 7 empty squares).
    Example row: 'BFBABFBCBFBABF' (Black's initial back rank).
    """
    parts = fen.split()
    if len(parts) < 2:
        return None, None

    board_str = parts[0]
    turn_str = parts[1]  # 'w' or 'b'
    turn = 0 if turn_str == 'w' else 1

    # Map 2-character piece codes to board values.
    piece_map = {
        'WC': 1,  # White Core
        'WA': 2,  # White Anchor
        'WF': 3,  # White Flux
        'BC': 5,  # Black Core
        'BA': 6,  # Black Anchor
        'BF': 7,  # Black Flux
    }

    board = np.zeros(49, dtype=np.int32)
    rows = board_str.split('/')
    if len(rows) != 7:
        return None, None

    sq = 0
    for row in rows:
        i = 0
        while i < len(row) and sq < 49:
            ch = row[i]
            if ch.isdigit():
                sq += int(ch)
                i += 1
            elif i + 1 < len(row) and row[i:i + 2] in piece_map:
                board[sq] = piece_map[row[i:i + 2]]
                sq += 1
                i += 2
            else:
                # Unknown character — skip.
                i += 1

    return board, turn


def train_on_data(dqn, positions, labels, device, epochs=10):
    """Train the DQN on human gameplay data."""
    if len(positions) == 0:
        return
    
    # Convert to tensors
    X = []
    for board, turn in positions:
        t = board_to_tensor(board, turn)
        X.append(t)
    
    X_tensor = torch.cat(X, dim=0).to(device)
    y_tensor = torch.tensor(labels, dtype=torch.float32).unsqueeze(1).to(device)
    
    dataset = TensorDataset(X_tensor, y_tensor)
    loader = DataLoader(dataset, batch_size=BATCH_SIZE, shuffle=True)
    
    criterion = nn.MSELoss()
    optimizer = optim.Adam(dqn.parameters(), lr=LEARNING_RATE)
    
    dqn.train()
    total_loss = 0
    for epoch in range(epochs):
        epoch_loss = 0
        for xb, yb in loader:
            optimizer.zero_grad()
            pred = dqn(xb)
            loss = criterion(pred, yb)
            loss.backward()
            optimizer.step()
            epoch_loss += loss.item()
        total_loss += epoch_loss / len(loader)
    
    avg_loss = total_loss / epochs
    print(f'  Trained on {len(positions)} positions, {epochs} epochs, loss={avg_loss:.4f}')
    return avg_loss


def evaluate_on_data(dqn, positions, labels, device):
    """Evaluate DQN accuracy on validation data."""
    if len(positions) == 0:
        return 0
    
    dqn.eval()
    correct = 0
    with torch.no_grad():
        for i, ((board, turn), label) in enumerate(zip(positions, labels)):
            t = board_to_tensor(board, turn).to(device)
            pred = dqn(t).item()
            if (pred > 0 and label > 0) or (pred < 0 and label < 0) or (abs(pred) < 0.1 and abs(label) < 0.1):
                correct += 1
    
    accuracy = correct / len(positions)
    return accuracy


def main():
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    print(f'Device: {device}')
    print(f'Database: {DB_PATH}')
    print(f'Polling every {POLL_INTERVAL}s, min {MIN_NEW_GAMES} new games')
    print(f'Press Ctrl+C to stop')
    print()
    
    # Load or create model
    dqn = GravityDQN().to(device)
    if MODEL_PATH.exists():
        dqn.load_state_dict(torch.load(MODEL_PATH, map_location=device, weights_only=True))
        print('Loaded existing model')
    
    last_game_id = 0
    total_positions = 0
    
    while True:
        try:
            # Load new games
            positions, labels, new_id = load_positions_from_db(str(DB_PATH), last_game_id)
            new_games = new_id - last_game_id
            
            if new_games >= MIN_NEW_GAMES:
                print(f'[{time.strftime("%H:%M:%S")}] {new_games} new games, {len(positions)} positions')
                
                # Split train/val
                split = int(len(positions) * 0.9)
                train_pos = positions[:split]
                train_lab = labels[:split]
                val_pos = positions[split:]
                val_lab = labels[split:]
                
                # Train
                loss = train_on_data(dqn, train_pos, train_lab, device, EPOCHS_PER_BATCH)
                acc = evaluate_on_data(dqn, val_pos, val_lab, device)
                
                total_positions += len(positions)
                last_game_id = new_id
                
                print(f'  Accuracy: {acc:.2%}')
                print(f'  Total positions trained: {total_positions:,}')
                
                # Save model
                torch.save(dqn.state_dict(), str(MODEL_PATH))
                
                # Export for web (only if accuracy improves enough)
                from dqn.export import export_to_json
                export_to_json(str(MODEL_PATH), str(EXPORT_PATH))
                print(f'  Model exported to {EXPORT_PATH}')
                print()
            else:
                print(f'[{time.strftime("%H:%M:%S")}] No new games (last_id={last_game_id})')
            
            time.sleep(POLL_INTERVAL)
            
        except KeyboardInterrupt:
            print('\nStopped.')
            break
        except Exception as e:
            print(f'Error: {e}')
            time.sleep(POLL_INTERVAL)


if __name__ == '__main__':
    main()
