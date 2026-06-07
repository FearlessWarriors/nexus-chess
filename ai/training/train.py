"""train.py — NNUE Training Script for Nexus Chess.

Trains the HalfKP_NNUE model using MSE loss against deep-search target scores.
Supports checkpointing, learning rate scheduling, gradient clipping, and
mixed-precision training on CUDA.

Optimized for RTX 3060 12GB with ``pin_memory=True`` and ``num_workers=4``
in the DataLoader to minimize CPU-GPU transfer latency.

Usage
-----
.. code-block:: bash

    python -m training.train --data data/train_data.h5 --epochs 30 --batch-size 8192
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from typing import Optional

import torch
import torch.nn as nn
from torch.optim.lr_scheduler import CosineAnnealingLR, LinearLR, SequentialLR

# Allow running as script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nnue.model import HalfKP_NNUE
from nnue.dataset import create_dataloader


# ═══════════════════════════════════════════════════════════════════════════════
# Training Utilities
# ═══════════════════════════════════════════════════════════════════════════════

class WarmupCosineLR:
    """Learning rate schedule: linear warmup → cosine annealing.

    This is a drop-in wrapper around PyTorch's SequentialLR combining a
    LinearLR warmup phase with a CosineAnnealingLR decay phase.
    """

    def __init__(
        self,
        optimizer: torch.optim.Optimizer,
        warmup_epochs: int,
        total_epochs: int,
        min_lr: float = 1e-6,
    ) -> None:
        warmup = LinearLR(
            optimizer,
            start_factor=0.01,
            end_factor=1.0,
            total_iters=warmup_epochs,
        )
        cosine = CosineAnnealingLR(
            optimizer,
            T_max=total_epochs - warmup_epochs,
            eta_min=min_lr,
        )
        self.scheduler = SequentialLR(
            optimizer,
            schedulers=[warmup, cosine],
            milestones=[warmup_epochs],
        )

    def step(self) -> None:
        self.scheduler.step()

    def get_last_lr(self) -> list[float]:
        return self.scheduler.get_last_lr()


def compute_loss(
    model: HalfKP_NNUE,
    features: torch.Tensor,
    targets: torch.Tensor,
    criterion: nn.Module,
) -> torch.Tensor:
    """Compute MSE loss between model predictions and targets.

    Args:
        model:     The NNUE model.
        features:  Input feature tensor [batch, input_dim].
        targets:   Target score tensor [batch].
        criterion: Loss function.

    Returns:
        Scalar loss tensor.
    """
    preds = model(features).squeeze(-1)
    return criterion(preds, targets)


def evaluate_model(
    model: HalfKP_NNUE,
    val_loader: torch.utils.data.DataLoader,
    device: torch.device,
) -> float:
    """Compute validation loss.

    Args:
        model:      The NNUE model (in eval mode).
        val_loader: Validation data loader.
        device:     Torch device.

    Returns:
        Average validation MSE loss.
    """
    model.eval()
    total_loss = 0.0
    total_samples = 0
    criterion = nn.MSELoss()

    with torch.no_grad():
        for features, targets in val_loader:
            features = features.to(device, non_blocking=True)
            targets = targets.to(device, non_blocking=True)
            loss = compute_loss(model, features, targets, criterion)
            total_loss += loss.item() * features.size(0)
            total_samples += features.size(0)

    model.train()
    return total_loss / max(total_samples, 1)


# ═══════════════════════════════════════════════════════════════════════════════
# Training Loop
# ═══════════════════════════════════════════════════════════════════════════════

def train(
    data_path: str,
    epochs: int = 30,
    batch_size: int = 8192,
    lr: float = 1e-3,
    weight_decay: float = 1e-4,
    warmup_epochs: int = 5,
    grad_clip: float = 1.0,
    device_str: str = "cuda",
    checkpoint_dir: str = "checkpoints/",
    log_file: str = "training_log.json",
    input_size: int = 20480,
    hidden_size: int = 256,
    dataloader_workers: int = 4,
) -> HalfKP_NNUE:
    """Run the full training loop.

    Args:
        data_path:          Path to HDF5 training data.
        epochs:             Number of training epochs (default: 30).
        batch_size:         Mini-batch size (default: 8192).
        lr:                 Peak learning rate.
        weight_decay:       AdamW weight decay.
        warmup_epochs:      LR warmup epochs.
        grad_clip:          Max gradient norm.
        device_str:         ``'cuda'`` or ``'cpu'``.
        checkpoint_dir:     Directory for model checkpoints.
        log_file:           Path for training log (JSON lines).
        input_size:         NNUE input dimension.
        hidden_size:        NNUE hidden layer size.
        dataloader_workers: Number of DataLoader workers (default: 4).

    Returns:
        Trained HalfKP_NNUE model.
    """
    device = torch.device(device_str if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    os.makedirs(checkpoint_dir, exist_ok=True)

    # ── Data ──────────────────────────────────────────────────────────────
    print("Loading data...")
    train_loader = create_dataloader(
        data_path, batch_size=batch_size, split="train",
        shuffle=True,
        num_workers=dataloader_workers,
        pin_memory=(device_str == "cuda"),
    )
    val_loader = create_dataloader(
        data_path, batch_size=batch_size, split="val",
        shuffle=False,
        num_workers=dataloader_workers,
        pin_memory=(device_str == "cuda"),
    )
    print(f"  Train batches: {len(train_loader)}, Val batches: {len(val_loader)}")
    print(f"  DataLoader workers: {dataloader_workers}, pin_memory: {device_str == 'cuda'}")

    # ── Model ─────────────────────────────────────────────────────────────
    model = HalfKP_NNUE(input_size=input_size, hidden_size=hidden_size)
    model.to(device)
    model.train()

    total_params = sum(p.numel() for p in model.parameters())
    print(f"  Model parameters: {total_params:,}")

    # ── Optimizer & Scheduler ─────────────────────────────────────────────
    optimizer = torch.optim.AdamW(
        model.parameters(),
        lr=lr,
        weight_decay=weight_decay,
    )
    lr_schedule = WarmupCosineLR(
        optimizer,
        warmup_epochs=warmup_epochs,
        total_epochs=epochs,
    )
    criterion = nn.MSELoss()

    # ── Training loop ─────────────────────────────────────────────────────
    log_entries: list[dict] = []
    best_val_loss = float("inf")
    start_time = time.time()

    for epoch in range(1, epochs + 1):
        model.train()
        epoch_loss = 0.0
        epoch_samples = 0
        t0 = time.time()

        for batch_idx, (features, targets) in enumerate(train_loader):
            features = features.to(device, non_blocking=True)
            targets = targets.to(device, non_blocking=True)

            optimizer.zero_grad()
            loss = compute_loss(model, features, targets, criterion)
            loss.backward()

            # Gradient clipping.
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=grad_clip)

            optimizer.step()

            epoch_loss += loss.item() * features.size(0)
            epoch_samples += features.size(0)

            if batch_idx % 50 == 0:
                current_lr = lr_schedule.get_last_lr()[0]
                print(f"  Epoch {epoch:3d} | Batch {batch_idx:5d} | "
                      f"Loss {loss.item():.4f} | LR {current_lr:.2e}")

        lr_schedule.step()
        train_loss = epoch_loss / max(epoch_samples, 1)
        epoch_time = time.time() - t0

        # Validation.
        val_loss = evaluate_model(model, val_loader, device)

        # Logging.
        log_entry = {
            "epoch": epoch,
            "train_loss": round(train_loss, 6),
            "val_loss": round(val_loss, 6),
            "lr": lr_schedule.get_last_lr()[0],
            "time_s": round(epoch_time, 1),
        }
        log_entries.append(log_entry)

        print(f"  === Epoch {epoch:3d} | Train Loss: {train_loss:.4f} | "
              f"Val Loss: {val_loss:.4f} | Time: {epoch_time:.1f}s ===")

        # Save checkpoint.
        ckpt_path = os.path.join(checkpoint_dir, f"model_{epoch:03d}.pt")
        model.save_checkpoint(ckpt_path, epoch=epoch, optimizer=optimizer,
                              loss=train_loss)

        # Save best model.
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_path = os.path.join(checkpoint_dir, "model_best.pt")
            model.save_checkpoint(best_path, epoch=epoch, optimizer=optimizer,
                                  loss=train_loss)
            print(f"  >>> New best model saved (val_loss={val_loss:.4f})")

    total_time = time.time() - start_time
    print(f"\nTraining complete in {total_time:.1f}s ({total_time / 60:.1f} min)")

    # Write training log.
    with open(log_file, "w") as f:
        json.dump(log_entries, f, indent=2)
    print(f"Training log saved to {log_file}")

    return model


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def main() -> None:
    """Training script entry point."""
    parser = argparse.ArgumentParser(
        description="Nexus Chess NNUE Training"
    )
    parser.add_argument(
        "--data", type=str, default="data/train_data.h5",
        help="Path to HDF5 training data."
    )
    parser.add_argument(
        "--epochs", type=int, default=30,
        help="Number of training epochs (default: 30)."
    )
    parser.add_argument(
        "--batch-size", type=int, default=8192,
        help="Mini-batch size (default: 8192)."
    )
    parser.add_argument(
        "--lr", type=float, default=1e-3,
        help="Peak learning rate (default: 1e-3)."
    )
    parser.add_argument(
        "--weight-decay", type=float, default=1e-4,
        help="Weight decay for AdamW (default: 1e-4)."
    )
    parser.add_argument(
        "--warmup", type=int, default=5,
        help="LR warmup epochs (default: 5)."
    )
    parser.add_argument(
        "--grad-clip", type=float, default=1.0,
        help="Max gradient norm (default: 1.0)."
    )
    parser.add_argument(
        "--device", type=str, default="cuda",
        help="Device: 'cuda' or 'cpu' (default: 'cuda')."
    )
    parser.add_argument(
        "--checkpoint-dir", type=str, default="checkpoints/",
        help="Directory for model checkpoints."
    )
    parser.add_argument(
        "--input-size", type=int, default=20480,
        help="NNUE input dimension."
    )
    parser.add_argument(
        "--hidden-size", type=int, default=256,
        help="NNUE hidden layer size."
    )
    parser.add_argument(
        "--num-workers", type=int, default=4,
        help="DataLoader workers (default: 4)."
    )

    args = parser.parse_args()

    if not os.path.exists(args.data):
        print(f"ERROR: Data file '{args.data}' not found. Run data_gen.py first.")
        sys.exit(1)

    train(
        data_path=args.data,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        weight_decay=args.weight_decay,
        warmup_epochs=args.warmup,
        grad_clip=args.grad_clip,
        device_str=args.device,
        checkpoint_dir=args.checkpoint_dir,
        input_size=args.input_size,
        hidden_size=args.hidden_size,
        dataloader_workers=args.num_workers,
    )


if __name__ == "__main__":
    main()
