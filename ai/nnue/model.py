"""model.py — PyTorch NNUE (HalfKP) Network Definition.

Architecture
------------
Input (20,480-dim sparse multi-hot feature vector)
  → FC₁ (20,480 → 256) + ReLU clamping
  → FC₂ (256 → 1)
  → scalar centipawn evaluation

This network is designed to be exported to ONNX and consumed by the
C++ inference engine via the Emscripten bridge.

References
----------
- NNUE (Efficiently Updatable Neural Network): Yu Nasu, 2018
- HalfKP feature set: Standard shogi/chess NNUE practice
"""

from __future__ import annotations

import torch
import torch.nn as nn


class HalfKP_NNUE(nn.Module):
    """HalfKP NNUE evaluation network for Nexus chess.

    The input is a sparse binary vector where each active element corresponds
    to a specific (own_king_square, opponent_king_square, piece_square, piece_type)
    combination.
    """

    def __init__(self, input_size: int = 20480, hidden_size: int = 256) -> None:
        """Initialise the HalfKP NNUE network.

        Args:
            input_size:  Number of input features (compressed feature space).
            hidden_size: Hidden layer width (default 256).
        """
        super().__init__()

        self.input_size = input_size
        self.hidden_size = hidden_size

        # Layer 1: sparse input → hidden (with ReLU clamping)
        self.fc1 = nn.Linear(input_size, hidden_size, bias=True)

        # Layer 2: hidden → scalar output (centipawns)
        self.fc2 = nn.Linear(hidden_size, 1, bias=True)

        self._init_weights()

    def _init_weights(self) -> None:
        """Initialise weights using Xavier-uniform for FC₁ and small random for FC₂."""
        nn.init.xavier_uniform_(self.fc1.weight)
        nn.init.zeros_(self.fc1.bias)

        nn.init.normal_(self.fc2.weight, mean=0.0, std=0.01)
        nn.init.zeros_(self.fc2.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """Forward pass.

        Args:
            x: Input tensor of shape ``[batch_size, input_size]``.
               Expected to be float (multi-hot encoded sparse features).

        Returns:
            Tensor of shape ``[batch_size, 1]`` — centipawn evaluation scores.
        """
        # FC₁ → ReLU (clamp at 0, instead of max(0,x) for ONNX compatibility)
        h = torch.clamp(self.fc1(x), min=0.0)
        # FC₂ → scalar output
        return self.fc2(h)

    def export_weights(self) -> dict[str, torch.Tensor]:
        """Export weights as a flat dictionary for the C++ engine.

        Returns:
            Dict with keys 'w1', 'b1', 'w2', 'b2' mapping to 1-D float tensors.
        """
        return {
            "w1": self.fc1.weight.data.flatten().cpu(),
            "b1": self.fc1.bias.data.flatten().cpu(),
            "w2": self.fc2.weight.data.flatten().cpu(),
            "b2": self.fc2.bias.data.flatten().cpu(),
        }

    @classmethod
    def from_checkpoint(cls, path: str, device: str = "cpu") -> "HalfKP_NNUE":
        """Load a model from a PyTorch checkpoint.

        Args:
            path:   Path to the .pt checkpoint file.
            device: Torch device string.

        Returns:
            Instantiated HalfKP_NNUE with loaded weights.
        """
        checkpoint = torch.load(path, map_location=device)
        input_size = checkpoint.get("input_size", 20480)
        hidden_size = checkpoint.get("hidden_size", 256)

        model = cls(input_size=input_size, hidden_size=hidden_size)
        model.load_state_dict(checkpoint["model_state_dict"])
        model.to(device)
        return model

    def save_checkpoint(
        self, path: str, epoch: int, optimizer: torch.optim.Optimizer | None = None,
        loss: float | None = None
    ) -> None:
        """Save a training checkpoint.

        Args:
            path:       Output file path.
            epoch:      Current epoch number.
            optimizer:  Optional optimizer for resuming training.
            loss:       Current training loss.
        """
        data: dict = {
            "epoch": epoch,
            "input_size": self.input_size,
            "hidden_size": self.hidden_size,
            "model_state_dict": self.state_dict(),
        }
        if optimizer is not None:
            data["optimizer_state_dict"] = optimizer.state_dict()
        if loss is not None:
            data["loss"] = loss
        torch.save(data, path)
