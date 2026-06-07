"""dataset.py — HDF5-based Training Dataset for Nexus Chess NNUE.

Provides a PyTorch Dataset that streams (feature_vector, score) pairs from
HDF5 files produced by the data generation pipeline.
"""

from __future__ import annotations

from typing import Optional, Tuple

import h5py
import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset


class HDF5NnueDataset(Dataset):
    """HDF5-backed dataset for NNUE training.

    Expects an HDF5 file with datasets:
      - ``features`` : shape ``(N, input_dim)``, dtype float32
      - ``scores``   : shape ``(N, 1)``, dtype float32
    """

    def __init__(
        self,
        h5_path: str,
        split: str = "train",
        transform: Optional[callable] = None,
    ) -> None:
        """Initialise the dataset.

        Args:
            h5_path:   Path to the HDF5 file.
            split:     Which data split to load (``'train'`` or ``'val'``).
            transform: Optional transform applied to feature vectors.
        """
        self.h5_path = h5_path
        self.split = split
        self.transform = transform

        self._file: Optional[h5py.File] = None
        self._features: Optional[h5py.Dataset] = None
        self._scores: Optional[h5py.Dataset] = None
        self._length: int = 0

        self._open()

    def _open(self) -> None:
        """Open the HDF5 file and locate the split datasets."""
        self._file = h5py.File(self.h5_path, "r")

        feat_key = f"{self.split}/features"
        score_key = f"{self.split}/scores"

        if feat_key not in self._file:
            raise KeyError(
                f"Dataset '{feat_key}' not found in {self.h5_path}. "
                f"Available keys: {list(self._file.keys())}"
            )

        self._features = self._file[feat_key]
        self._scores = self._file[score_key]
        self._length = self._features.shape[0]

    def __len__(self) -> int:
        """Return the number of samples in this split."""
        return self._length

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        """Retrieve a single (features, score) pair.

        Args:
            idx: Sample index.

        Returns:
            Tuple of ``(feature_tensor, score_tensor)``.
        """
        features = self._features[idx]  # type: ignore[index]
        score = self._scores[idx]        # type: ignore[index]

        # Convert to PyTorch tensors.
        feat_tensor = torch.from_numpy(np.array(features, dtype=np.float32))
        score_tensor = torch.tensor(float(score), dtype=torch.float32)

        if self.transform is not None:
            feat_tensor = self.transform(feat_tensor)

        return feat_tensor, score_tensor

    def close(self) -> None:
        """Close the underlying HDF5 file."""
        if self._file is not None:
            self._file.close()
            self._file = None

    def __del__(self) -> None:
        """Cleanup on deletion."""
        self.close()


class InMemoryNnueDataset(Dataset):
    """In-memory dataset for NNUE training (loads entire HDF5 split into RAM).

    Use this for faster training when the dataset fits in memory (~500K × 20K
    floats ≈ 40 GB — adjust target_dim or use HDF5NnueDataset for larger sets).
    For compressed features (sparse multi-hot), memory usage is much lower.
    """

    def __init__(
        self,
        h5_path: str,
        split: str = "train",
        device: str = "cpu",
    ) -> None:
        """Load the dataset into memory.

        Args:
            h5_path: Path to the HDF5 file.
            split:   Which split to load.
            device:  Torch device to place tensors on.
        """
        self.device = device

        with h5py.File(h5_path, "r") as f:
            feat_key = f"{split}/features"
            score_key = f"{split}/scores"

            if feat_key not in f:
                raise KeyError(f"Dataset '{feat_key}' not found in {h5_path}")

            self.features = torch.from_numpy(f[feat_key][:].astype(np.float32))
            self.scores = torch.from_numpy(f[score_key][:].astype(np.float32)).squeeze(-1)

        if device != "cpu":
            self.features = self.features.to(device)
            self.scores = self.scores.to(device)

    def __len__(self) -> int:
        return self.features.shape[0]

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        return self.features[idx], self.scores[idx]


def create_dataloader(
    h5_path: str,
    batch_size: int = 8192,
    split: str = "train",
    shuffle: bool = True,
    num_workers: int = 0,
    in_memory: bool = False,
    device: str = "cpu",
) -> DataLoader:
    """Create a DataLoader for NNUE training data.

    Args:
        h5_path:     Path to the HDF5 data file.
        batch_size:  Mini-batch size (default 8192).
        split:       ``'train'`` or ``'val'``.
        shuffle:     Whether to shuffle the data.
        num_workers: Number of data-loading subprocesses.
        in_memory:   If True, load all data into RAM.
        device:      Torch device for in-memory mode.

    Returns:
        Configured DataLoader instance.
    """
    if in_memory:
        dataset: Dataset = InMemoryNnueDataset(h5_path, split=split, device=device)
    else:
        dataset = HDF5NnueDataset(h5_path, split=split)

    return DataLoader(
        dataset,
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=num_workers,
        pin_memory=(device != "cpu"),
        drop_last=False,
    )
