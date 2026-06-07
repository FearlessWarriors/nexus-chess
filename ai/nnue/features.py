"""features.py — HalfKP Feature Extraction for Nexus Chess (Gravity Rules).

Feature Space
-------------
Raw HalfKP features are indexed as::

    feature_index = own_king_sq * 49 * 8 + opp_king_sq * 8 + piece_type

where:
  - own_king_sq  ∈ [0, 48]  — square of friendly Core piece
  - opp_king_sq  ∈ [0, 48]  — square of enemy Core piece
  - piece_type   ∈ {0,1,2,4,5,6} — mapped from piece code:
      WC→0, WA→1, WF→2, BC→4, BA→5, BF→6

This yields up to 49 * 49 * 7 = 16,807 raw indices — far fewer than the
theoretical 49³×7 space because each position has exactly one friendly and
one enemy Core, so only one (own_king, opp_king) pair is active.

During training, only features that actually appear in the dataset are
retained, resulting in a compressed feature space (~20,480).

Board encoding (consistent with TypeScript frontend):
    0=empty, 1=WC (White Core),  2=WA (White Anchor),  3=WF (White Flux),
    5=BC (Black Core), 6=BA (Black Anchor), 7=BF (Black Flux)
"""

from __future__ import annotations

from collections import OrderedDict
from typing import Dict, List, Optional

import numpy as np


# ─── Piece Mapping ────────────────────────────────────────────────────────────

# Piece codes (consistent with TypeScript engine):
#   0 = empty,  1 = White Core,   2 = White Anchor,  3 = White Flux,
#   5 = Black Core, 6 = Black Anchor, 7 = Black Flux.
_PIECE_CODE_TO_TYPE: Dict[int, int] = {
    1: 0,  # White Core
    2: 1,  # White Anchor
    3: 2,  # White Flux
    5: 4,  # Black Core
    6: 5,  # Black Anchor
    7: 6,  # Black Flux
}

# Reverse mapping: feature type index → piece code.
_TYPE_TO_PIECE_CODE: Dict[int, int] = {v: k for k, v in _PIECE_CODE_TO_TYPE.items()}

# Legacy alias for the piece code table.
PIECE_CODE_MAP: Dict[int, int] = _PIECE_CODE_TO_TYPE.copy()

# ─── Board Constants ──────────────────────────────────────────────────────────

BOARD_SIZE: int = 7
NUM_SQUARES: int = BOARD_SIZE * BOARD_SIZE  # 49

# Raw feature space size: 49 king squares × 49 opp king squares × 8 type slots.
RAW_FEATURE_DIM: int = NUM_SQUARES * 8 * NUM_SQUARES  # 19,208
# NOTE: max index = 48*49*8 + 48*8 + 6 = 18,822 + 384 + 6 = 19,212.
# We round up for input margin.


def piece_code_to_type(code: int) -> int:
    """Map a piece code (0-7) to a feature type index.

    Args:
        code: Piece code (1=WC, 2=WA, 3=WF, 5=BC, 6=BA, 7=BF).

    Returns:
        Feature type index (0-6), or -1 for empty/invalid.
    """
    return _PIECE_CODE_TO_TYPE.get(code, -1)


def feature_index(
    own_king_sq: int, opp_king_sq: int, piece_sq: int, piece_code: int
) -> int:
    """Compute the raw HalfKP feature index.

    Args:
        own_king_sq: Square index of the friendly Core piece [0, 48].
        opp_king_sq: Square index of the enemy Core piece [0, 48].
        piece_sq:    Square index of the piece [0, 48].
        piece_code:  Piece code (1-3 for White, 5-7 for Black).

    Returns:
        Raw feature index in [0, RAW_FEATURE_DIM).
    """
    ptype = _PIECE_CODE_TO_TYPE.get(piece_code, 0)
    return own_king_sq * 49 * 8 + opp_king_sq * 8 + ptype


def extract_features(
    board_array: np.ndarray,
    side_to_move: int = 0,
) -> List[int]:
    """Extract active HalfKP feature indices from a board state.

    Args:
        board_array:  Flat array of 49 piece codes (0-7), row-major.
                      Index i = row * 7 + col.
        side_to_move: 0 = White, 1 = Black.

    Returns:
        List of active raw feature indices.
    """
    assert board_array.shape == (49,), f"Expected (49,) got {board_array.shape}"

    # Locate Core pieces.
    own_king_code = 1 if side_to_move == 0 else 5  # WC or BC
    opp_king_code = 5 if side_to_move == 0 else 1  # BC or WC

    own_king_positions = np.where(board_array == own_king_code)[0]
    opp_king_positions = np.where(board_array == opp_king_code)[0]

    if len(own_king_positions) == 0 or len(opp_king_positions) == 0:
        return []  # Missing Core — invalid position.

    own_king_sq = int(own_king_positions[0])
    opp_king_sq = int(opp_king_positions[0])

    features: List[int] = []
    for sq in range(49):
        code = int(board_array[sq])
        if code == 0:
            continue
        ptype = _PIECE_CODE_TO_TYPE.get(code)
        if ptype is None:
            continue
        feat = own_king_sq * 49 * 8 + opp_king_sq * 8 + ptype
        features.append(feat)

    return features


def build_feature_map(
    all_features: List[List[int]],
    target_dim: int = 20480,
) -> Dict[int, int]:
    """Build a mapping from raw feature indices to compressed indices.

    Only features that appear in the training data are retained.
    The most frequent features get the lowest compressed indices.

    Args:
        all_features: List of feature lists, one per training position.
        target_dim:   Desired compressed dimension (default 20,480).

    Returns:
        Dict mapping ``raw_index → compressed_index``.
    """
    from collections import Counter

    counter: Counter = Counter()
    for feats in all_features:
        counter.update(feats)

    most_common = counter.most_common(target_dim)
    feature_map: Dict[int, int] = OrderedDict()
    for compressed_idx, (raw_idx, _count) in enumerate(most_common):
        feature_map[raw_idx] = compressed_idx

    return feature_map


def compress_features(
    raw_features: List[int],
    feature_map: Dict[int, int],
    input_dim: int = 20480,
    dtype: type = np.float32,
) -> np.ndarray:
    """Convert a list of raw feature indices to a compressed dense vector.

    Args:
        raw_features: List of raw HalfKP feature indices.
        feature_map:  Mapping from raw index → compressed index.
        input_dim:    Size of the output vector.
        dtype:        NumPy dtype for the output.

    Returns:
        Dense array of shape ``(input_dim,)`` with 1.0 at active positions.
    """
    vec = np.zeros(input_dim, dtype=dtype)
    for raw in raw_features:
        compressed = feature_map.get(raw)
        if compressed is not None and compressed < input_dim:
            vec[compressed] = 1.0
    return vec


def compute_raw_dimension() -> int:
    """Return the maximum possible raw feature index + 1."""
    max_own = 48
    max_opp = 48
    max_type = 6
    return max_own * 49 * 8 + max_opp * 8 + max_type + 1
