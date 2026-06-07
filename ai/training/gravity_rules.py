"""gravity_rules.py — Gravity-Lock Rule Engine (Python)

Mirrors the TypeScript ``gravity.ts`` + ``movegen.ts`` + ``rules.ts`` + ``evaluate.ts``
behaviour.  This is the single source of truth for the AI self-play pipeline.

Board encoding (identical to TypeScript ``boardToArray``):
    ``0=empty, 1=WC, 2=WA, 3=WF, 5=BC, 6=BA, 7=BF``

7×7 board, row-major (index = row * 7 + col).

Performance optimizations:
    - Transposition Table (500K-entry LRU cache)
    - Move ordering (push > d4-advance > anchor-escape > normal)
    - Null-move pruning (depth ≥ 3, R=3 reduction)
    - Vectorized ``_apply_move()`` via numpy slice assignment
"""

from __future__ import annotations

import struct
from collections import OrderedDict, Counter
from typing import Dict, List, Optional, Set, Tuple

import numpy as np

# ═══════════════════════════════════════════════════════════════════════════════
# Constants
# ═══════════════════════════════════════════════════════════════════════════════

BOARD_SIZE: int = 7
NUM_SQUARES: int = 49

# Piece codes.
EMPTY: int = 0
WC: int = 1  # White Core
WA: int = 2  # White Anchor
WF: int = 3  # White Flux
BC: int = 5  # Black Core
BA: int = 6  # Black Anchor
BF: int = 7  # Black Flux

# Colour helpers.
WHITE: int = 0
BLACK: int = 1

# d4 / centre (3,3).
CENTER_COL: int = 3
CENTER_ROW: int = 3

# Evolve row (0-indexed).
CORE_EVOLVE_ROW: int = 3

# Direction vectors.
ALL_DIRECTIONS: List[Tuple[int, int]] = [
    (0, -1), (1, -1), (1, 0), (1, 1),
    (0, 1), (-1, 1), (-1, 0), (-1, -1),
]
ORTHOGONAL_DIRECTIONS: List[Tuple[int, int]] = [
    (0, -1), (1, 0), (0, 1), (-1, 0),
]

# Evaluation weights (matching TypeScript evaluate.ts WEIGHTS).
WEIGHTS: Dict[str, float] = {
    "CONTROL_AREA": 3.0,
    "CORE_SAFETY": 25.0,
    "CORE_D4_PROXIMITY": 15.0,
    "ENEMY_CORE_LOCKED": 300.0,
    "ANCHOR_SURVIVAL": 80.0,
    "FLUX_ACTIVITY": 15.0,
    "D4_PRESSURE": 20.0,
    "D4_PRESSURE_BONUS": 25.0,
    "CORE_ON_D4": 500.0,
    "OWN_CORE_LOCKED": -400.0,
    "CORE_EVOLVED_BONUS": 80.0,
    "ANCHOR_LOCKED_PENALTY": -60.0,
    "ANCHOR_OVERLOAD_THREAT": 40.0,
}

# ═══════════════════════════════════════════════════════════════════════════════
# Transposition Table (LRU cache)
# ═══════════════════════════════════════════════════════════════════════════════

_TT_SIZE: int = 500000  # 500K entries

# TT flag constants.
_TT_EXACT: int = 0   # Exact score stored.
_TT_ALPHA: int = 1   # Lower bound (score ≥ stored).
_TT_BETA: int = 2    # Upper bound (score ≤ stored).

# Global transposition table using OrderedDict for LRU eviction.
_transposition_table: OrderedDict = OrderedDict()

# TT statistics for diagnostics.
_tt_hits: int = 0
_tt_misses: int = 0
_tt_cutoffs: int = 0
_null_move_cutoffs: int = 0


def _tt_key(board: np.ndarray, depth: int, side: int) -> bytes:
    """Build a TT lookup key from board bytes, depth, and side.

    Uses ``board.tobytes()`` (49 bytes) + packed depth + side (8 bytes) = 57 bytes.
    """
    return board.tobytes() + struct.pack('<ii', depth, side)


def _tt_store(
    board: np.ndarray,
    depth: int,
    side: int,
    score: float,
    best_move: Optional[Tuple[int, int, int, int, int]],
    flag: int,
) -> None:
    """Store an entry in the transposition table with LRU eviction.

    Args:
        board:     Board state (49-element uint8 array).
        depth:     Search depth at which this entry was computed.
        side:      Side to move.
        score:     Computed score.
        best_move: Best move tuple ``(from_sq, to_sq, from_col, from_row, move_type)`` or None.
        flag:      One of ``_TT_EXACT``, ``_TT_ALPHA``, ``_TT_BETA``.
    """
    key = _tt_key(board, depth, side)
    if key in _transposition_table:
        _transposition_table.move_to_end(key)
        _transposition_table[key] = (score, best_move, flag, depth)
        return
    if len(_transposition_table) >= _TT_SIZE:
        _transposition_table.popitem(last=False)  # LRU: evict oldest.
    _transposition_table[key] = (score, best_move, flag, depth)


def _tt_probe(
    board: np.ndarray,
    depth: int,
    side: int,
    alpha: float,
    beta: float,
) -> Optional[float]:
    """Probe the transposition table for a cutoff or usable score.

    Returns:
        A float score if a cutoff or exact match is found; ``None`` otherwise.
    """
    global _tt_hits, _tt_misses, _tt_cutoffs

    key = _tt_key(board, depth, side)
    entry = _transposition_table.get(key)
    if entry is None:
        _tt_misses += 1
        return None

    stored_score, best_move, flag, stored_depth = entry
    _transposition_table.move_to_end(key)  # Mark as recently used.

    if stored_depth >= depth:
        _tt_hits += 1
        if flag == _TT_EXACT:
            return stored_score
        if flag == _TT_ALPHA and stored_score >= beta:
            _tt_cutoffs += 1
            return stored_score
        if flag == _TT_BETA and stored_score <= alpha:
            _tt_cutoffs += 1
            return stored_score

    return None


def _tt_get_best_move(
    board: np.ndarray, side: int, max_depth: int = 10,
) -> Optional[Tuple[int, int, int, int, int]]:
    """Retrieve the best move from TT for move ordering.

    Tries multiple depth levels starting from ``max_depth`` downward.

    Args:
        board:     Board state.
        side:      Side to move.
        max_depth: Maximum depth to probe.

    Returns:
        Best move tuple or ``None``.
    """
    for d in range(max_depth, 0, -1):
        key = _tt_key(board, d, side)
        entry = _transposition_table.get(key)
        if entry is not None:
            _, best_move, _, _ = entry
            if best_move is not None:
                return best_move
    return None


def tt_clear() -> None:
    """Clear the transposition table and reset statistics."""
    global _tt_hits, _tt_misses, _tt_cutoffs, _null_move_cutoffs
    _transposition_table.clear()
    _zone_cache.clear()
    _tt_hits = 0
    _tt_misses = 0
    _tt_cutoffs = 0
    _null_move_cutoffs = 0


def tt_stats() -> Dict[str, int]:
    """Return TT diagnostic statistics."""
    return {
        "size": len(_transposition_table),
        "hits": _tt_hits,
        "misses": _tt_misses,
        "cutoffs": _tt_cutoffs,
        "null_move_cutoffs": _null_move_cutoffs,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Initial Board
# ═══════════════════════════════════════════════════════════════════════════════

INITIAL_BOARD = np.array([
    BF, BA, BF, BC, BF, BA, BF,
    0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0,
    WF, WA, WF, WC, WF, WA, WF,
], dtype=np.uint8)


def initial_board() -> np.ndarray:
    """Return a fresh copy of the initial board."""
    return INITIAL_BOARD.copy()


# ═══════════════════════════════════════════════════════════════════════════════
# Pre-computed lookup tables (avoid expensive per-call computation)
# ═══════════════════════════════════════════════════════════════════════════════

# Map square index → (col, row).  Indices 0..48.
_SQ_TO_COL: np.ndarray = np.array([i % 7 for i in range(49)], dtype=np.int8)
_SQ_TO_ROW: np.ndarray = np.array([i // 7 for i in range(49)], dtype=np.int8)

# Map square index → pre-formatted position key string.
_POS_KEYS: List[str] = [f"c{c}r{r}" for c, r in
                        ((i % 7, i // 7) for i in range(49))]

# Anchor ray maps: for each square, all squares in each orthogonal direction.
# _ANCHOR_RAYS[from_sq][dir_idx] = list of (to_sq, col, row).
_ANCHOR_RAYS: List[List[List[Tuple[int, int, int]]]] = []
for _sq in range(49):
    _c, _r = _sq % 7, _sq // 7
    _dirs: List[List[Tuple[int, int, int]]] = []
    for _di, (_dc, _dr) in enumerate(ORTHOGONAL_DIRECTIONS):
        _ray: List[Tuple[int, int, int]] = []
        _step = 1
        while True:
            _nc, _nr = _c + _dc * _step, _r + _dr * _step
            if 0 <= _nc < 7 and 0 <= _nr < 7:
                _ray.append((_nr * 7 + _nc, _nc, _nr))
                _step += 1
            else:
                break
        _dirs.append(_ray)
    _ANCHOR_RAYS.append(_dirs)

# Flux jump destinations: for each square, list of (to_sq, col, row).
_FLUX_JUMPS: List[List[Tuple[int, int, int]]] = []
for _sq in range(49):
    _c, _r = _sq % 7, _sq // 7
    _jumps: List[Tuple[int, int, int]] = []
    for _dc, _dr in ALL_DIRECTIONS:
        _nc, _nr = _c + _dc * 2, _r + _dr * 2
        if 0 <= _nc < 7 and 0 <= _nr < 7:
            _jumps.append((_nr * 7 + _nc, _nc, _nr))
    _FLUX_JUMPS.append(_jumps)

# Core 8-neighbour offsets: for each square, list of (to_sq, col, row).
_CORE_NEIGHBOURS: List[List[Tuple[int, int, int]]] = []
for _sq in range(49):
    _c, _r = _sq % 7, _sq // 7
    _nbrs: List[Tuple[int, int, int]] = []
    for _dc, _dr in ALL_DIRECTIONS:
        _nc, _nr = _c + _dc, _r + _dr
        if 0 <= _nc < 7 and 0 <= _nr < 7:
            _nbrs.append((_nr * 7 + _nc, _nc, _nr))
    _CORE_NEIGHBOURS.append(_nbrs)

# Core evolved (row 3) orthogonal range-2 squares.
_CORE_EVOLVED_EXTRA: List[List[Tuple[int, int, int]]] = []
for _sq in range(49):
    _c, _r = _sq % 7, _sq // 7
    _extra: List[Tuple[int, int, int]] = []
    for _dc, _dr in [(0, -2), (0, 2), (-2, 0), (2, 0)]:
        _nc, _nr = _c + _dc, _r + _dr
        if 0 <= _nc < 7 and 0 <= _nr < 7:
            _extra.append((_nr * 7 + _nc, _nc, _nr))
    _CORE_EVOLVED_EXTRA.append(_extra)

# Zone LRU cache: (board_hash, color) -> frozenset of position keys.
_zone_cache: OrderedDict = OrderedDict()
_ZONE_CACHE_SIZE: int = 20000  # Cache up to 20K unique board states.


# ═══════════════════════════════════════════════════════════════════════════════
# Board Utilities (vectorized)
# ═══════════════════════════════════════════════════════════════════════════════

def _in_bounds(col: int, row: int) -> bool:
    """Check if a coordinate is within the 7×7 board."""
    return 0 <= col < BOARD_SIZE and 0 <= row < BOARD_SIZE


def _piece_color(code: int) -> int:
    """Return WHITE (0) or BLACK (1).  Returns -1 for empty."""
    if code == EMPTY:
        return -1
    return WHITE if code <= 3 else BLACK


def _is_white(code: int) -> bool:
    """True if piece code belongs to White."""
    return 1 <= code <= 3


def _opponent(side: int) -> int:
    """Return the opposite side."""
    return BLACK if side == WHITE else WHITE


def sq_to_pos(sq: int) -> Tuple[int, int]:
    """Convert flat square index to (col, row).  Uses pre-computed lookup."""
    return int(_SQ_TO_COL[sq]), int(_SQ_TO_ROW[sq])


def pos_to_sq(col: int, row: int) -> int:
    """Convert (col, row) to flat square index."""
    return row * BOARD_SIZE + col


def _pos_key(col: int, row: int) -> str:
    """Return pre-computed position key string."""
    return _POS_KEYS[row * 7 + col]


def _find_pieces(board: np.ndarray, side: int) -> List[Tuple[int, int, int, int]]:
    """Return list of (square_index, col, row, piece_code) for all pieces of `side`.

    Uses numpy boolean indexing for O(49) vectorized filtering.
    """
    if side == WHITE:
        mask = (board >= WC) & (board <= WF)
    else:
        mask = (board >= BC) & (board <= BF)
    indices: np.ndarray = np.where(mask)[0]
    if len(indices) == 0:
        return []
    # Build result list efficiently using pre-computed lookup tables.
    result: List[Tuple[int, int, int, int]] = [
        (int(sq), int(_SQ_TO_COL[sq]), int(_SQ_TO_ROW[sq]), int(board[sq]))
        for sq in indices
    ]
    return result


def _find_core(board: np.ndarray, side: int) -> int:
    """Return the square index of `side`'s Core.  Returns -1 if not found.

    Uses numpy argwhere for vectorized search.
    """
    target = WC if side == WHITE else BC
    indices = np.where(board == target)[0]
    return int(indices[0]) if len(indices) > 0 else -1


# ═══════════════════════════════════════════════════════════════════════════════
# Control Zone Computation
# ═══════════════════════════════════════════════════════════════════════════════

def get_control_zone(board: np.ndarray, color: int) -> Set[str]:
    """Compute the full gravity control zone for `color`.

    Uses zone cache keyed by ``board_hash + color``.
    Returns a set of position keys (``'c{col}r{row}'``).
    """
    # ── Zone cache lookup ─────────────────────────────────────────────────
    cache_key = board.tobytes() + (b'\x00' if color == WHITE else b'\x01')
    cached = _zone_cache.get(cache_key)
    if cached is not None:
        _zone_cache.move_to_end(cache_key)
        return cached  # type: ignore[return-value]

    zone: Set[str] = set()

    # Vectorized piece finding.
    pieces = _find_pieces(board, color)
    for sq, col, row, code in pieces:
        ptype = (code - 1) % 4
        if ptype == 0:
            _add_core_control_fast(sq, col, row, zone)
        elif ptype == 1:
            _add_anchor_control_fast(sq, zone)
        elif ptype == 2:
            _add_flux_control_fast(sq, zone)

    # 1. Remove d4 (Sanctuary).
    zone.discard(_POS_KEYS[CENTER_SQ])

    # 2. Remove squares controlled by enemy Anchors.
    enemy = _opponent(color)
    for _, ec, er, ecode in _find_pieces(board, enemy):
        if (ecode - 1) % 4 == 1:  # Anchor
            _remove_anchor_from_zone_fast(pos_to_sq(ec, er), zone)

    # ── Store in cache (LRU) ─────────────────────────────────────────────
    if len(_zone_cache) >= _ZONE_CACHE_SIZE:
        _zone_cache.popitem(last=False)
    frozen = zone  # Mutable set is fine as long as we don't modify cached copies.
    _zone_cache[cache_key] = frozen
    _zone_cache.move_to_end(cache_key)

    return zone


# d4 square index for fast access.
CENTER_SQ: int = pos_to_sq(CENTER_COL, CENTER_ROW)


def zone_cache_clear() -> None:
    """Clear the zone cache and the transposition table."""
    _zone_cache.clear()
    tt_clear()


def _add_core_control_fast(sq: int, col: int, row: int, zone: Set[str]) -> None:
    """Core: own square + 8-neighbourhood. Evolved on row 3 adds range-2 orthogonal."""
    zone.add(_POS_KEYS[sq])
    for to_sq, tc, tr in _CORE_NEIGHBOURS[sq]:
        zone.add(_POS_KEYS[to_sq])
    if row == CORE_EVOLVE_ROW:
        for to_sq, tc, tr in _CORE_EVOLVED_EXTRA[sq]:
            zone.add(_POS_KEYS[to_sq])


def _add_anchor_control_fast(sq: int, zone: Set[str]) -> None:
    """Anchor: orthogonal infinite lines (using pre-computed rays)."""
    for ray in _ANCHOR_RAYS[sq]:
        for to_sq, tc, tr in ray:
            zone.add(_POS_KEYS[to_sq])


def _add_flux_control_fast(sq: int, zone: Set[str]) -> None:
    """Flux: 8 squares at range 2 (using pre-computed destinations)."""
    for to_sq, tc, tr in _FLUX_JUMPS[sq]:
        zone.add(_POS_KEYS[to_sq])


def _remove_anchor_from_zone_fast(sq: int, zone: Set[str]) -> None:
    """Remove Anchor's orthogonal lines from a zone (using pre-computed rays)."""
    for ray in _ANCHOR_RAYS[sq]:
        for to_sq, tc, tr in ray:
            zone.discard(_POS_KEYS[to_sq])


# ═══════════════════════════════════════════════════════════════════════════════
# Lock Detection
# ═══════════════════════════════════════════════════════════════════════════════

def is_locked(
    piece_sq: int,
    board: np.ndarray,
    my_zone: Optional[Set[str]] = None,
    enemy_zone: Optional[Set[str]] = None,
) -> bool:
    """Determine whether the piece at `piece_sq` is locked.

    - Flux: NEVER locked.
    - Core: locked only if isolated (not in own control zone).
    - Anchor: locked if in enemy control zone.
    """
    code = int(board[piece_sq])
    if code == EMPTY:
        return False
    ptype = (code - 1) % 4
    if ptype == 2:  # Flux — immune
        return False

    col, row = sq_to_pos(piece_sq)
    side = _piece_color(code)
    key = _pos_key(col, row)

    if my_zone is None:
        my_zone = get_control_zone(board, side)
    if enemy_zone is None:
        enemy_zone = get_control_zone(board, _opponent(side))

    if ptype == 0:  # Core
        return key not in my_zone  # isolated
    # Anchor
    return key in enemy_zone


# ═══════════════════════════════════════════════════════════════════════════════
# Move Generation
# ═══════════════════════════════════════════════════════════════════════════════

def get_legal_moves(
    board: np.ndarray,
    side: int,
    core_cooldown: bool = False,
    my_zone: Optional[Set[str]] = None,
    enemy_zone: Optional[Set[str]] = None,
) -> List[Tuple[int, int, int, int, int]]:
    """Generate all legal moves for `side`.

    Returns:
        List of ``(from_sq, to_sq, from_col, from_row, move_type)`` tuples.
        ``move_type``: 0=normal, 1=push.
    """
    if my_zone is None:
        my_zone = get_control_zone(board, side)
    if enemy_zone is None:
        enemy_zone = get_control_zone(board, _opponent(side))

    moves: List[Tuple[int, int, int, int, int]] = []

    for sq, col, row, code in _find_pieces(board, side):
        # Skip locked pieces.
        if is_locked(sq, board, my_zone, enemy_zone):
            continue

        ptype = (code - 1) % 4

        if ptype == 0:  # Core
            if core_cooldown:
                continue
            _gen_core_moves(col, row, board, side, moves)
        elif ptype == 1:  # Anchor
            _gen_anchor_moves(col, row, board, side, moves)
        elif ptype == 2:  # Flux
            _gen_flux_moves(col, row, board, side, moves)

    # Push moves.
    moves.extend(_gen_push_moves(board, side, my_zone))

    return moves


def _gen_core_moves(
    col: int, row: int, board: np.ndarray, side: int,
    moves: List[Tuple[int, int, int, int, int]],
) -> None:
    """Core: one step in any of 8 directions to an empty square, no capture."""
    from_sq = pos_to_sq(col, row)
    for dc, dr in ALL_DIRECTIONS:
        nc, nr = col + dc, row + dr
        if not _in_bounds(nc, nr):
            continue
        if int(board[pos_to_sq(nc, nr)]) == EMPTY:
            moves.append((from_sq, pos_to_sq(nc, nr), col, row, 0))


def _gen_anchor_moves(
    col: int, row: int, board: np.ndarray, side: int,
    moves: List[Tuple[int, int, int, int, int]],
) -> None:
    """Anchor: slides in 4 orthogonal directions. Stops before any piece."""
    from_sq = pos_to_sq(col, row)
    for dc, dr in ORTHOGONAL_DIRECTIONS:
        step = 1
        while True:
            nc, nr = col + dc * step, row + dr * step
            if not _in_bounds(nc, nr):
                break
            if int(board[pos_to_sq(nc, nr)]) != EMPTY:
                break  # blocked
            moves.append((from_sq, pos_to_sq(nc, nr), col, row, 0))
            step += 1


def _gen_flux_moves(
    col: int, row: int, board: np.ndarray, side: int,
    moves: List[Tuple[int, int, int, int, int]],
) -> None:
    """Flux: jumps exactly 2 squares in any of 8 directions. Must land empty."""
    from_sq = pos_to_sq(col, row)
    for dc, dr in ALL_DIRECTIONS:
        nc, nr = col + dc * 2, row + dr * 2
        if not _in_bounds(nc, nr):
            continue
        if int(board[pos_to_sq(nc, nr)]) == EMPTY:
            moves.append((from_sq, pos_to_sq(nc, nr), col, row, 0))


def _gen_push_moves(
    board: np.ndarray, side: int, my_zone: Set[str],
) -> List[Tuple[int, int, int, int, int]]:
    """Generate push moves: displace enemy core to an adjacent empty square.

    Conditions:
        - Enemy core is in our control zone.
        - At least 6 of enemy core's 8 neighbours are in our control zone.
        - Enemy core is NOT on d4.
    """
    enemy = _opponent(side)
    core_sq = _find_core(board, enemy)
    if core_sq == -1:
        return []

    core_col, core_row = sq_to_pos(core_sq)

    # Condition: not on d4.
    if core_col == CENTER_COL and core_row == CENTER_ROW:
        return []

    # Condition: in our zone.
    if _pos_key(core_col, core_row) not in my_zone:
        return []

    # Count controlled neighbours and collect empty push destinations.
    controlled = 0
    empty_dests: List[Tuple[int, int]] = []
    for dc, dr in ALL_DIRECTIONS:
        nc, nr = core_col + dc, core_row + dr
        if not _in_bounds(nc, nr):
            continue
        if _pos_key(nc, nr) in my_zone:
            controlled += 1
        if int(board[pos_to_sq(nc, nr)]) == EMPTY:
            empty_dests.append((nc, nr))

    if controlled < 6:
        return []

    # Sort destinations: further from pusher's back rank first.
    my_back_rank = 6 if side == WHITE else 0
    empty_dests.sort(key=lambda p: abs(p[1] - my_back_rank), reverse=True)

    moves: List[Tuple[int, int, int, int, int]] = []
    for dest_col, dest_row in empty_dests:
        moves.append((core_sq, pos_to_sq(dest_col, dest_row), core_col, core_row, 1))

    return moves


# ═══════════════════════════════════════════════════════════════════════════════
# Victory Detection
# ═══════════════════════════════════════════════════════════════════════════════

def is_sanctuary_victory(board: np.ndarray, side: int, sanctuary_occupied: int) -> bool:
    """Sanctuary victory: `side`'s Core has been on d4 for one full turn.

    Args:
        board:               Current board.
        side:                Side to test.
        sanctuary_occupied:  Side whose Core occupied d4 at previous turn start.
                             (-1 = none, WHITE/BLACK).
    """
    if sanctuary_occupied != side:
        return False
    core_sq = _find_core(board, side)
    if core_sq == -1:
        return False
    core_col, core_row = sq_to_pos(core_sq)
    return core_col == CENTER_COL and core_row == CENTER_ROW


def is_siege_victory(board: np.ndarray, side: int) -> bool:
    """Siege victory: enemy Core is trapped.

    Conditions:
        1. All 8 neighbours of enemy Core are in our control zone or occupied by our pieces.
        2. Enemy Core is locked.
    """
    enemy = _opponent(side)
    core_sq = _find_core(board, enemy)
    if core_sq == -1:
        return False

    core_col, core_row = sq_to_pos(core_sq)
    my_zone = get_control_zone(board, side)
    enemy_zone = get_control_zone(board, enemy)

    # Condition 1: all neighbours controlled.
    for dc, dr in ALL_DIRECTIONS:
        nc, nr = core_col + dc, core_row + dr
        if not _in_bounds(nc, nr):
            continue
        dst_sq = pos_to_sq(nc, nr)
        dst_code = int(board[dst_sq])
        if dst_code != EMPTY and _piece_color(dst_code) == side:
            continue  # occupied by us
        if _pos_key(nc, nr) in my_zone:
            continue
        return False  # this neighbour not controlled

    # Condition 2: enemy Core locked.
    return is_locked(core_sq, board, enemy_zone, my_zone)


def can_push_enemy_core(board: np.ndarray, side: int, my_zone: Optional[Set[str]] = None) -> bool:
    """True if `side` can push the enemy Core this turn."""
    if my_zone is None:
        my_zone = get_control_zone(board, side)
    enemy = _opponent(side)
    core_sq = _find_core(board, enemy)
    if core_sq == -1:
        return False
    core_col, core_row = sq_to_pos(core_sq)
    if core_col == CENTER_COL and core_row == CENTER_ROW:
        return False
    if _pos_key(core_col, core_row) not in my_zone:
        return False
    controlled = sum(
        1 for dc, dr in ALL_DIRECTIONS
        if _in_bounds(core_col + dc, core_row + dr)
        and _pos_key(core_col + dc, core_row + dr) in my_zone
    )
    return controlled >= 6


# ═══════════════════════════════════════════════════════════════════════════════
# Board Evaluation (matching TypeScript evaluate.ts)
# ═══════════════════════════════════════════════════════════════════════════════

def evaluate_board(board: np.ndarray, side: int) -> float:
    """Score the board from `side`'s perspective.

    Returns centipawn-like score.  Higher = better for `side`.
    """
    enemy = _opponent(side)
    my_zone = get_control_zone(board, side)
    enemy_zone = get_control_zone(board, enemy)

    score = 0.0

    # 1. Control zone area.
    score += len(my_zone) * WEIGHTS["CONTROL_AREA"]
    score -= len(enemy_zone) * WEIGHTS["CONTROL_AREA"]

    # 2. Own Core evaluation.
    core_sq = _find_core(board, side)
    if core_sq == -1:
        score -= 10000.0
    else:
        score += _eval_core_safety(core_sq, my_zone, enemy_zone, board, side)

    # 3. Enemy Core evaluation.
    enemy_core_sq = _find_core(board, enemy)
    if enemy_core_sq == -1:
        score += 10000.0
    else:
        score += _eval_enemy_core_status(enemy_core_sq, my_zone, enemy_zone, board, side)

    # 4. Anchor status.
    score += _eval_anchor_status(board, side, my_zone, enemy_zone)

    # 5. Flux activity.
    score += _eval_flux_activity(board, side)

    # 6. d4 pressure.
    score += _eval_d4_pressure(my_zone, enemy_zone)

    return score


def _manhattan_dist(col1: int, row1: int, col2: int, row2: int) -> int:
    return abs(col1 - col2) + abs(row1 - row2)


def _eval_core_safety(
    core_sq: int, my_zone: Set[str], enemy_zone: Set[str],
    board: np.ndarray, side: int,
) -> float:
    score = 0.0
    col, row = sq_to_pos(core_sq)

    # Controlled neighbours.
    controlled = sum(
        1 for dc, dr in ALL_DIRECTIONS
        if _in_bounds(col + dc, row + dr)
        and _pos_key(col + dc, row + dr) in my_zone
    )
    score += controlled * WEIGHTS["CORE_SAFETY"]

    # d4 proximity.
    dist = _manhattan_dist(col, row, CENTER_COL, CENTER_ROW)
    score += (6 - dist) * WEIGHTS["CORE_D4_PROXIMITY"]

    # On d4.
    if col == CENTER_COL and row == CENTER_ROW:
        score += WEIGHTS["CORE_ON_D4"]

    # Evolved bonus.
    if row == CORE_EVOLVE_ROW:
        score += WEIGHTS["CORE_EVOLVED_BONUS"]

    # d4 pressure bonus: neighbours that touch d4.
    d4_pressure = sum(
        1 for dc, dr in ALL_DIRECTIONS
        if _in_bounds(col + dc, row + dr)
        and _manhattan_dist(col + dc, row + dr, CENTER_COL, CENTER_ROW) == 1
    )
    score += d4_pressure * WEIGHTS["D4_PRESSURE_BONUS"]

    # Lock penalty.
    if is_locked(core_sq, board, my_zone, enemy_zone):
        score += WEIGHTS["OWN_CORE_LOCKED"]

    return score


def _eval_enemy_core_status(
    enemy_core_sq: int, my_zone: Set[str], enemy_zone: Set[str],
    board: np.ndarray, side: int,
) -> float:
    score = 0.0
    col, row = sq_to_pos(enemy_core_sq)

    # Enemy core locked.
    if is_locked(enemy_core_sq, board, enemy_zone, my_zone):
        score += WEIGHTS["ENEMY_CORE_LOCKED"]

    # Enemy d4 proximity (penalty).
    dist = _manhattan_dist(col, row, CENTER_COL, CENTER_ROW)
    score -= (6 - dist) * WEIGHTS["CORE_D4_PROXIMITY"] * 0.5

    # Enemy evolved.
    if row == CORE_EVOLVE_ROW:
        score -= WEIGHTS["CORE_EVOLVED_BONUS"] * 0.5

    # Enemy controlled neighbours (penalty).
    enemy_controlled = sum(
        1 for dc, dr in ALL_DIRECTIONS
        if _in_bounds(col + dc, row + dr)
        and _pos_key(col + dc, row + dr) in enemy_zone
    )
    score -= enemy_controlled * WEIGHTS["CORE_SAFETY"]

    # Siege pressure (our control of enemy core neighbours).
    siege = sum(
        1 for dc, dr in ALL_DIRECTIONS
        if _in_bounds(col + dc, row + dr)
        and _pos_key(col + dc, row + dr) in my_zone
    )
    score += siege * WEIGHTS["CORE_SAFETY"] * 0.8

    return score


def _eval_anchor_status(
    board: np.ndarray, side: int,
    my_zone: Set[str], enemy_zone: Set[str],
) -> float:
    score = 0.0
    enemy = _opponent(side)

    len_my = sum(1 for _, _, _, code in _find_pieces(board, side) if (code - 1) % 4 == 1)
    len_enemy = sum(1 for _, _, _, code in _find_pieces(board, enemy) if (code - 1) % 4 == 1)

    score += len_my * WEIGHTS["ANCHOR_SURVIVAL"]
    score -= len_enemy * WEIGHTS["ANCHOR_SURVIVAL"]

    # Own anchors in enemy zone (locked).
    for sq, col, row, code in _find_pieces(board, side):
        if (code - 1) % 4 == 1 and _pos_key(col, row) in enemy_zone:
            score += WEIGHTS["ANCHOR_LOCKED_PENALTY"]

    # Enemy anchors in our zone.
    for sq, col, row, code in _find_pieces(board, enemy):
        if (code - 1) % 4 == 1 and _pos_key(col, row) in my_zone:
            score -= WEIGHTS["ANCHOR_LOCKED_PENALTY"]

    return score


def _eval_flux_activity(board: np.ndarray, side: int) -> float:
    score = 0.0
    enemy = _opponent(side)

    for sq, col, row, code in _find_pieces(board, side):
        if (code - 1) % 4 == 2:
            landings = sum(
                1 for dc, dr in ALL_DIRECTIONS
                if _in_bounds(col + dc * 2, row + dr * 2)
                and int(board[pos_to_sq(col + dc * 2, row + dr * 2)]) == EMPTY
            )
            score += landings * WEIGHTS["FLUX_ACTIVITY"]

    for sq, col, row, code in _find_pieces(board, enemy):
        if (code - 1) % 4 == 2:
            landings = sum(
                1 for dc, dr in ALL_DIRECTIONS
                if _in_bounds(col + dc * 2, row + dr * 2)
                and int(board[pos_to_sq(col + dc * 2, row + dr * 2)]) == EMPTY
            )
            score -= landings * WEIGHTS["FLUX_ACTIVITY"]

    return score


def _eval_d4_pressure(my_zone: Set[str], enemy_zone: Set[str]) -> float:
    score = 0.0
    for dc, dr in ALL_DIRECTIONS:
        nc, nr = CENTER_COL + dc, CENTER_ROW + dr
        if not _in_bounds(nc, nr):
            continue
        key = _pos_key(nc, nr)
        if key in my_zone:
            score += WEIGHTS["D4_PRESSURE"]
        if key in enemy_zone:
            score -= WEIGHTS["D4_PRESSURE"]
    return score


# ═══════════════════════════════════════════════════════════════════════════════
# Alpha-Beta Search (Optimized with TT, Move Ordering, Null-Move Pruning)
# ═══════════════════════════════════════════════════════════════════════════════

_MATE_SCORE: float = 100000.0
_DRAW_SCORE: float = 0.0
_NULL_MOVE_R: int = 3  # Null-move reduction depth.


def _score_move(
    board: np.ndarray,
    side: int,
    from_sq: int,
    to_sq: int,
    from_col: int,
    from_row: int,
    move_type: int,
    my_zone: Set[str],
    enemy_zone: Set[str],
) -> int:
    """Score a move for ordering — higher scores are searched first.

    Priority hierarchy:
        1. Push moves (displace enemy Core) — highest.
        2. Core advancing toward d4 centre.
        3. Anchor escaping enemy control zone.
        4. Flux hopping toward centre.
        5. Default/normal moves.

    Returns:
        Integer score (higher = search earlier = better pruning).
    """
    score = 0
    to_col, to_row = sq_to_pos(to_sq)
    piece_code = int(board[from_sq])
    ptype = (piece_code - 1) % 4

    # Tier 1: Push moves are always best (winning tactic).
    if move_type == 1:
        score += 10000
        # Prefer pushing further from enemy back rank.
        enemy_back_rank = 0 if side == WHITE else 6
        score += abs(to_row - enemy_back_rank) * 100
        return score

    # Distance to centre (for tie-breaking).
    to_centre = _manhattan_dist(to_col, to_row, CENTER_COL, CENTER_ROW)
    from_centre = _manhattan_dist(from_col, from_row, CENTER_COL, CENTER_ROW)

    if ptype == 0:  # Core
        # Tier 2: Core advancing toward d4.
        d4_gain = from_centre - to_centre  # positive = getting closer to d4.
        score += 5000 + d4_gain * 500
        # Bonus for landing on evolved row.
        if to_row == CORE_EVOLVE_ROW:
            score += 300
    elif ptype == 1:  # Anchor
        # Tier 3: Anchor escaping enemy zone.
        from_key = _pos_key(from_col, from_row)
        to_key = _pos_key(to_col, to_row)
        if from_key in enemy_zone and to_key not in enemy_zone:
            score += 3000  # Escaping.
        elif from_key in enemy_zone:
            score += 1000  # Moving while in danger (still better than staying).
        # Prefer anchors that advance toward centre.
        score += (from_centre - to_centre) * 200
    elif ptype == 2:  # Flux
        # Tier 4: Flux moving toward centre.
        score += 500 + (from_centre - to_centre) * 100

    # General: prefer moves toward centre.
    score += max(0, 6 - to_centre) * 10

    return score


def _order_moves(
    moves: List[Tuple[int, int, int, int, int]],
    board: np.ndarray,
    side: int,
    my_zone: Set[str],
    enemy_zone: Set[str],
    tt_best_move: Optional[Tuple[int, int, int, int, int]] = None,
) -> List[Tuple[int, int, int, int, int]]:
    """Sort moves for optimal alpha-beta pruning.

    Moves are scored and sorted in descending order (best first).
    The TT best move is always placed first if present.

    Args:
        moves:         List of ``(from_sq, to_sq, from_col, from_row, move_type)``.
        board:         Current board state.
        side:          Side to move.
        my_zone:       Current side's control zone.
        enemy_zone:    Enemy's control zone.
        tt_best_move:  Best move from transposition table (searched first).

    Returns:
        Ordered list of moves (best first).
    """
    if len(moves) <= 1:
        return moves

    # Score each move.
    scored = []
    for move in moves:
        from_sq, to_sq, from_col, from_row, move_type = move
        move_order_score = _score_move(
            board, side, from_sq, to_sq, from_col, from_row,
            move_type, my_zone, enemy_zone,
        )
        scored.append((move_order_score, move))

    # Sort by score descending.
    scored.sort(key=lambda x: x[0], reverse=True)

    ordered = [m for _, m in scored]

    # Place TT best move at front if it exists in the list.
    if tt_best_move is not None:
        try:
            idx = ordered.index(tt_best_move)
            if idx > 0:
                ordered.pop(idx)
                ordered.insert(0, tt_best_move)
        except ValueError:
            pass  # TT move not in current move list (stale).

    return ordered


def alpha_beta(
    board: np.ndarray,
    side: int,
    depth: int,
    alpha: float = -float("inf"),
    beta: float = float("inf"),
    sanctuary_occupied: int = -1,
    core_cooldown: bool = False,
    use_tt: bool = True,
) -> float:
    """Alpha-Beta search with gravity-lock evaluation.

    Optimizations enabled when ``use_tt=True``:
        - Transposition table lookup (500K-entry LRU cache).
        - Move ordering (push > d4-advance > escape > normal).
        - Null-move pruning (depth ≥ 3, R=3 reduction).

    Args:
        board:               Current board (49-element flat array).
        side:                Side to move (WHITE=0, BLACK=1).
        depth:               Remaining search depth.
        alpha, beta:         Bounds.
        sanctuary_occupied:  Side whose Core was on d4 at previous turn start (-1=none).
        core_cooldown:       True if current side's Core is in cooldown.
        use_tt:              Enable transposition table and associated optimizations.

    Returns:
        Centipawn-like score from the perspective of `side`.
    """
    # ── TT probe ──────────────────────────────────────────────────────────
    if use_tt:
        tt_result = _tt_probe(board, depth, side, alpha, beta)
        if tt_result is not None:
            return tt_result

    if depth == 0:
        eval_score = evaluate_board(board, side)
        if use_tt:
            _tt_store(board, 0, side, eval_score, None, _TT_EXACT)
        return eval_score

    moves = get_legal_moves(board, side, core_cooldown=core_cooldown)
    if not moves:
        enemy = _opponent(side)
        if is_siege_victory(board, enemy):
            result = -_MATE_SCORE
            if use_tt:
                _tt_store(board, depth, side, result, None, _TT_EXACT)
            return result
        if use_tt:
            _tt_store(board, depth, side, _DRAW_SCORE, None, _TT_EXACT)
        return _DRAW_SCORE

    # ── Null-move pruning ─────────────────────────────────────────────────
    if use_tt and depth >= _NULL_MOVE_R:
        global _null_move_cutoffs
        enemy = _opponent(side)
        # Null move: skip current side's turn, search with reduced depth.
        # Use a zero-width window around beta for testing cutoff.
        if side == WHITE:
            # WHITE is maximizing. Skip WHITE's turn, let BLACK move.
            # alpha_beta returns score from BLACK's perspective.
            null_score_black = alpha_beta(
                board, enemy, depth - _NULL_MOVE_R,
                -beta, -(beta - 1),
                sanctuary_occupied=sanctuary_occupied,
                core_cooldown=False, use_tt=use_tt,
            )
            # Convert to WHITE's perspective: if -null_score >= beta, prune.
            if -null_score_black >= beta:
                _null_move_cutoffs += 1
                return beta
        else:
            # BLACK is minimizing. Skip BLACK's turn, let WHITE move.
            null_score_white = alpha_beta(
                board, enemy, depth - _NULL_MOVE_R,
                alpha, alpha + 1,
                sanctuary_occupied=sanctuary_occupied,
                core_cooldown=False, use_tt=use_tt,
            )
            # Convert to BLACK's perspective: if -null_score <= alpha, prune.
            if -null_score_white <= alpha:
                _null_move_cutoffs += 1
                return alpha

    # ── Move ordering ─────────────────────────────────────────────────────
    if use_tt:
        my_zone = get_control_zone(board, side)
        enemy_zone = get_control_zone(board, _opponent(side))
        tt_best = _tt_get_best_move(board, side)
        moves = _order_moves(moves, board, side, my_zone, enemy_zone, tt_best)
    else:
        my_zone = get_control_zone(board, side)
        enemy_zone = get_control_zone(board, _opponent(side))

    # ── Search ────────────────────────────────────────────────────────────
    best_move_tuple: Optional[Tuple[int, int, int, int, int]] = None
    enemy = _opponent(side)

    if side == WHITE:
        best = -float("inf")
        for from_sq, to_sq, fc, fr, move_type in moves:
            new_board, new_sanctuary, new_cooldown = _apply_move(
                board, from_sq, to_sq, side, move_type, sanctuary_occupied,
            )
            # Immediate victory checks.
            if is_siege_victory(new_board, side):
                if use_tt:
                    _tt_store(board, depth, side, _MATE_SCORE,
                             (from_sq, to_sq, fc, fr, move_type), _TT_EXACT)
                return _MATE_SCORE
            if is_sanctuary_victory(new_board, side, new_sanctuary):
                if use_tt:
                    _tt_store(board, depth, side, _MATE_SCORE,
                             (from_sq, to_sq, fc, fr, move_type), _TT_EXACT)
                return _MATE_SCORE
            val = alpha_beta(
                new_board, enemy, depth - 1, alpha, beta,
                sanctuary_occupied=new_sanctuary, core_cooldown=new_cooldown,
                use_tt=use_tt,
            )
            if val > best:
                best = val
                best_move_tuple = (from_sq, to_sq, fc, fr, move_type)
            alpha = max(alpha, val)
            if alpha >= beta:
                break
        flag = _TT_EXACT if best > alpha else _TT_ALPHA
    else:
        best = float("inf")
        for from_sq, to_sq, fc, fr, move_type in moves:
            new_board, new_sanctuary, new_cooldown = _apply_move(
                board, from_sq, to_sq, side, move_type, sanctuary_occupied,
            )
            if is_siege_victory(new_board, side):
                if use_tt:
                    _tt_store(board, depth, side, -_MATE_SCORE,
                             (from_sq, to_sq, fc, fr, move_type), _TT_EXACT)
                return -_MATE_SCORE
            if is_sanctuary_victory(new_board, side, new_sanctuary):
                if use_tt:
                    _tt_store(board, depth, side, -_MATE_SCORE,
                             (from_sq, to_sq, fc, fr, move_type), _TT_EXACT)
                return -_MATE_SCORE
            val = alpha_beta(
                new_board, enemy, depth - 1, alpha, beta,
                sanctuary_occupied=new_sanctuary, core_cooldown=new_cooldown,
                use_tt=use_tt,
            )
            if val < best:
                best = val
                best_move_tuple = (from_sq, to_sq, fc, fr, move_type)
            beta = min(beta, val)
            if alpha >= beta:
                break
        flag = _TT_EXACT if best < beta else _TT_BETA

    # ── TT store ──────────────────────────────────────────────────────────
    if use_tt:
        _tt_store(board, depth, side, best, best_move_tuple, flag)

    return best


def alpha_beta_search(
    board: np.ndarray,
    side: int,
    depth: int,
    sanctuary_occupied: int = -1,
    core_cooldown: bool = False,
    use_tt: bool = True,
) -> Tuple[float, Optional[Tuple[int, int, int, int, int]]]:
    """Alpha-Beta search returning both score and best move.

    This is a convenience wrapper around ``alpha_beta()`` that retrieves
    the best move from the transposition table after the search completes.

    Args:
        board:               Current board (49-element flat array).
        side:                Side to move (WHITE=0, BLACK=1).
        depth:               Search depth.
        sanctuary_occupied:  Sanctuary tracking.
        core_cooldown:       Core cooldown flag.
        use_tt:              Enable transposition table optimizations.

    Returns:
        ``(score, best_move)`` where ``best_move`` is
        ``(from_sq, to_sq, from_col, from_row, move_type)`` or ``None``.
    """
    score = alpha_beta(
        board, side, depth,
        -float("inf"), float("inf"),
        sanctuary_occupied=sanctuary_occupied,
        core_cooldown=core_cooldown,
        use_tt=use_tt,
    )

    # Retrieve best move from TT if available.
    best_move: Optional[Tuple[int, int, int, int, int]] = None
    if use_tt:
        best_move = _tt_get_best_move(board, side, max_depth=depth)
    return score, best_move


# ═══════════════════════════════════════════════════════════════════════════════
# Move Application (Vectorized)
# ═══════════════════════════════════════════════════════════════════════════════

def _apply_move(
    board: np.ndarray,
    from_sq: int,
    to_sq: int,
    side: int,
    move_type: int,
    sanctuary_occupied: int,
) -> Tuple[np.ndarray, int, bool]:
    """Apply a move, returning (new_board, new_sanctuary_occupied, new_core_cooldown).

    Uses efficient numpy array copy (C-level memcpy for the 49-element board)
    followed by direct index assignment — optimal for boards of this size.

    Args:
        board:               Current board.
        from_sq, to_sq:      Source and destination square indices.
        side:                Side making the move.
        move_type:           0=normal, 1=push.
        sanctuary_occupied:  Current sanctuary tracking.
    """
    # Vectorized copy via numpy (C-level memcpy, ~50ns for 49 bytes).
    new_board = board.copy()
    new_board[to_sq] = new_board[from_sq]
    new_board[from_sq] = EMPTY

    if move_type == 1:  # Push — enemy Core was just displaced.
        new_cooldown = True
    else:
        new_cooldown = False

    core_sq = _find_core(new_board, side)
    new_sanctuary = -1
    if core_sq != -1:
        col, row = sq_to_pos(core_sq)
        if col == CENTER_COL and row == CENTER_ROW:
            new_sanctuary = side

    return new_board, new_sanctuary, new_cooldown


# ═══════════════════════════════════════════════════════════════════════════════
# Self-Test (run when executed directly)
# ═══════════════════════════════════════════════════════════════════════════════

def _run_self_test() -> bool:
    """Quick consistency checks on the gravity rules engine."""
    passed = True

    board = initial_board()

    # 1. Initial control zones are symmetric (area only, minus Anchor override).
    w_zone = get_control_zone(board, WHITE)
    b_zone = get_control_zone(board, BLACK)
    if abs(len(w_zone) - len(b_zone)) > 2:
        print(f"  ❌  Test 1 FAIL: Zone asymmetry — W={len(w_zone)}, B={len(b_zone)}")
        passed = False
    else:
        print(f"  ✅  Test 1 PASS: Zones W={len(w_zone)}, B={len(b_zone)}")

    # 2. Initial evaluation is near zero.
    score = evaluate_board(board, WHITE)
    if abs(score) > 50:
        print(f"  ❌  Test 2 FAIL: Initial eval {score} not near zero")
        passed = False
    else:
        print(f"  ✅  Test 2 PASS: Initial eval = {score}")

    # 3. Legal moves exist for both sides.
    w_moves = get_legal_moves(board, WHITE)
    b_moves = get_legal_moves(board, BLACK)
    if len(w_moves) == 0 or len(b_moves) == 0:
        print(f"  ❌  Test 3 FAIL: No legal moves W={len(w_moves)} B={len(b_moves)}")
        passed = False
    else:
        print(f"  ✅  Test 3 PASS: Legal moves W={len(w_moves)} B={len(b_moves)}")

    # 4. No piece is locked in initial position.
    for sq in range(NUM_SQUARES):
        code = int(board[sq])
        if code != EMPTY:
            if is_locked(sq, board):
                print(f"  ❌  Test 4 FAIL: Piece locked in initial position (sq={sq})")
                passed = False
                break
    else:
        print(f"  ✅  Test 4 PASS: No locked pieces in initial position")

    # 5. Core moving toward d4 increases eval.
    core_sq = _find_core(board, WHITE)
    col, row = sq_to_pos(core_sq)
    before = evaluate_board(board, WHITE)
    best_after = before
    for dc, dr in ALL_DIRECTIONS:
        nc, nr = col + dc, row + dr
        if _in_bounds(nc, nr) and int(board[pos_to_sq(nc, nr)]) == EMPTY:
            nb = board.copy()
            nb[core_sq] = EMPTY
            nb[pos_to_sq(nc, nr)] = WC
            after = evaluate_board(nb, WHITE)
            if after > best_after:
                best_after = after
    if best_after <= before:
        print(f"  ❌  Test 5 FAIL: Core toward d4 did not improve eval ({before} → {best_after})")
        passed = False
    else:
        print(f"  ✅  Test 5 PASS: Core toward d4 improves eval ({before} → {best_after})")

    # 6. Core on d4 gets high eval.
    nb = board.copy()
    nb[core_sq] = EMPTY
    d4_sq = pos_to_sq(CENTER_COL, CENTER_ROW)
    if int(nb[d4_sq]) != EMPTY:
        nb[d4_sq] = EMPTY
    nb[d4_sq] = WC
    d4_eval = evaluate_board(nb, WHITE)
    if d4_eval <= 500:
        print(f"  ❌  Test 6 FAIL: Core on d4 eval {d4_eval} <= 500")
        passed = False
    else:
        print(f"  ✅  Test 6 PASS: Core on d4 eval = {d4_eval} (> 500)")

    # 7. TT consistency: depth=3 with and without TT should produce same sign.
    print("  ⏳  Test 7: TT consistency (depth=3)...", end=" ", flush=True)
    tt_clear()
    score_with_tt = alpha_beta(initial_board(), WHITE, depth=3, use_tt=True)
    tt_clear()
    score_no_tt = alpha_beta(initial_board(), WHITE, depth=3, use_tt=False)
    if abs(score_with_tt - score_no_tt) > 1.0:
        print(f"FAIL: TT={score_with_tt:.1f} noTT={score_no_tt:.1f}")
        passed = False
    else:
        print(f"PASS: TT={score_with_tt:.1f} noTT={score_no_tt:.1f}")

    if passed:
        print("  ✅  ALL gravity_rules self-tests PASSED")
    else:
        print("  ❌  Some self-tests FAILED")
    return passed


if __name__ == "__main__":
    print("=== gravity_rules.py Self-Test ===")
    _run_self_test()
