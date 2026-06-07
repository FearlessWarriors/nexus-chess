"""DQN Model for Nexus Gravity Chess.

Input: 7×7 board encoded as 8-channel one-hot (49 * 8 = 392 inputs)
  0: empty
  1: white core (WC)
  2: white anchor (WA)
  3: white flux (WF)
  4: black core (BC)
  5: black anchor (BA)
  6: black flux (BF)
  7: side to move (1=white, 0=black)

Output: scalar value [-1, 1] representing position quality for current player.
"""

import torch
import torch.nn as nn


class GravityDQN(nn.Module):
    """DQN for Nexus Gravity Chess evaluation."""

    def __init__(self, input_dim: int = 392, hidden_dim: int = 512):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
            nn.Linear(hidden_dim // 2, hidden_dim // 4),
            nn.ReLU(),
            nn.Linear(hidden_dim // 4, 1),
            nn.Tanh(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def board_to_tensor(board, side_to_move: int) -> torch.Tensor:
    """Convert numpy board (49,) to 49×8 one-hot tensor.

    board values: 0=empty, 1=WC, 2=WA, 3=WF, 5=BC, 6=BA, 7=BF
    Returns: tensor of shape (1, 392)
    """
    import numpy as np

    tensor = np.zeros((1, 49, 8), dtype=np.float32)
    for sq in range(49):
        code = int(board[sq])
        if 0 <= code <= 7 and code != 4:  # skip 4 (gap in encoding)
            actual_ch = code if code < 4 else code - 1  # map 5,6,7 -> 4,5,6
            tensor[0, sq, actual_ch] = 1.0

    # Channel 7: side to move
    tensor[0, :, 7] = float(side_to_move)

    return torch.from_numpy(tensor.reshape(1, -1))
