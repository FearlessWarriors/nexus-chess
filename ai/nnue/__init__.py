"""nnue -- Nexus Chess NNUE Network Definition Package.

Submodules:
- model: PyTorch HalfKP network (requires torch)
- features: Feature extraction (numpy only, no torch dependency)
- dataset: HDF5/InMemory datasets (requires torch for DataLoader)

Import directly from submodules to avoid triggering heavy dependencies:
    from nnue.features import extract_features, BOARD_SIZE
    from nnue.model import HalfKP_NNUE  # needs torch
"""
