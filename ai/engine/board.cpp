// board.cpp — Nexus Chess 7×7 Board Implementation
// ============================================================================

#include "board.h"

#include <cstring>

namespace nexus {

// ─── Static Member Initialisation ────────────────────────────────────────────

uint64_t Board::zobrist_table_[49][8] = {};
bool     Board::zobrist_initialized_   = false;

// Simple splitmix64 PRNG for deterministic Zobrist key generation.
namespace {
uint64_t splitmix64(uint64_t& state) {
  uint64_t z = (state += 0x9E3779B97F4A7C15ULL);
  z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ULL;
  z = (z ^ (z >> 27)) * 0x94D049BB133111EBULL;
  return z ^ (z >> 31);
}
}  // namespace

void Board::initZobristTable() {
  if (zobrist_initialized_) return;
  uint64_t seed = 0x123456789ABCDEF0ULL;
  for (int sq = 0; sq < 49; ++sq) {
    for (int pc = 0; pc < 8; ++pc) {
      zobrist_table_[sq][pc] = splitmix64(seed);
    }
  }
  zobrist_initialized_ = true;
}

// ─── Construction ────────────────────────────────────────────────────────────

Board::Board() {
  initZobristTable();
  reset();
}

// ─── Reset ───────────────────────────────────────────────────────────────────

void Board::reset() {
  // Clear the board.
  std::memset(grid_, 0, sizeof(grid_));

  // Row 0 — Black back rank (3 Scouts, 3 Sentinels, 1 Core):
  //   col: 0    1    2    3    4    5    6
  //   pc:  BT   BS   BS   BC   BT   BS   BT
  grid_[0][0] = PieceCode::BT;
  grid_[0][1] = PieceCode::BS;
  grid_[0][2] = PieceCode::BS;
  grid_[0][3] = PieceCode::BC;
  grid_[0][4] = PieceCode::BT;
  grid_[0][5] = PieceCode::BS;
  grid_[0][6] = PieceCode::BT;

  // Row 6 — White back rank (3 Scouts, 3 Sentinels, 1 Core):
  //   col: 0    1    2    3    4    5    6
  //   pc:  WT   WS   WS   WC   WT   WS   WT
  grid_[6][0] = PieceCode::WT;
  grid_[6][1] = PieceCode::WS;
  grid_[6][2] = PieceCode::WS;
  grid_[6][3] = PieceCode::WC;
  grid_[6][4] = PieceCode::WT;
  grid_[6][5] = PieceCode::WS;
  grid_[6][6] = PieceCode::WT;

  side_to_move_    = Color::WHITE;
  fullmove_number_ = 1;
  history_.clear();

  // Compute initial Zobrist hash.
  zobrist_hash_ = 0ULL;
  for (int row = 0; row < kSize; ++row) {
    for (int col = 0; col < kSize; ++col) {
      uint8_t pc = grid_[row][col];
      if (pc != PieceCode::EMPTY) {
        int sq = squareIndex(col, row);
        zobrist_hash_ ^= zobrist_table_[sq][pc];
      }
    }
  }
  // White to move → no side-to-move key XOR.
}

// ─── Accessors ───────────────────────────────────────────────────────────────

uint8_t Board::getPieceAt(int col, int row) const {
  if (col < 0 || col >= kSize || row < 0 || row >= kSize) return 0;
  return grid_[row][col];
}

// ─── Move Execution ──────────────────────────────────────────────────────────

bool Board::makeMove(int fromCol, int fromRow, int toCol, int toRow) {
  // Bounds check.
  if (fromCol < 0 || fromCol >= kSize || fromRow < 0 || fromRow >= kSize) return false;
  if (toCol   < 0 || toCol   >= kSize || toRow   < 0 || toRow   >= kSize) return false;

  uint8_t piece = grid_[fromRow][fromCol];
  if (piece == PieceCode::EMPTY) return false;

  Color pieceColor = PieceCode::colorOf(piece);
  if (pieceColor != side_to_move_) return false;

  uint8_t captured = grid_[toRow][toCol];
  // Cannot capture own piece (handled as a rule; simple check).
  if (captured != PieceCode::EMPTY && PieceCode::colorOf(captured) == pieceColor) {
    return false;
  }

  // Save history entry.
  HistoryEntry entry;
  entry.move       = {fromCol, fromRow, toCol, toRow};
  entry.captured   = captured;
  entry.prev_hash  = zobrist_hash_;
  entry.prev_side  = side_to_move_;
  history_.push_back(entry);

  // Update Zobrist hash: remove moving piece from source.
  int fromSq = squareIndex(fromCol, fromRow);
  zobrist_hash_ ^= zobrist_table_[fromSq][piece];

  // Remove captured piece from destination if any.
  if (captured != PieceCode::EMPTY) {
    int toSq = squareIndex(toCol, toRow);
    zobrist_hash_ ^= zobrist_table_[toSq][captured];
  }

  // Place piece on destination.
  grid_[toRow][toCol]   = piece;
  grid_[fromRow][fromCol] = PieceCode::EMPTY;

  // Add moving piece at destination.
  int toSq = squareIndex(toCol, toRow);
  zobrist_hash_ ^= zobrist_table_[toSq][piece];

  // Toggle side to move.
  side_to_move_ = (side_to_move_ == Color::WHITE) ? Color::BLACK : Color::WHITE;
  zobrist_hash_ ^= kZobristBlackToMove;  // XOR toggles side-to-move key.

  if (side_to_move_ == Color::WHITE) {
    ++fullmove_number_;
  }

  return true;
}

bool Board::undoMove() {
  if (history_.empty()) return false;

  const HistoryEntry& entry = history_.back();

  uint8_t piece = grid_[entry.move.to_row][entry.move.to_col];

  // Remove piece from destination.
  grid_[entry.move.to_row][entry.move.to_col] = PieceCode::EMPTY;

  // Restore captured piece if any.
  if (entry.captured != PieceCode::EMPTY) {
    grid_[entry.move.to_row][entry.move.to_col] = entry.captured;
  }

  // Restore piece to source.
  grid_[entry.move.from_row][entry.move.from_col] = piece;

  // Restore state.
  zobrist_hash_   = entry.prev_hash;
  side_to_move_   = entry.prev_side;
  fullmove_number_ = (side_to_move_ == Color::BLACK)
                         ? fullmove_number_
                         : fullmove_number_ - 1;

  history_.pop_back();
  return true;
}

// ─── Feature Extraction ──────────────────────────────────────────────────────

int Board::getActiveFeatures(int* buffer, int maxFeatures) const {
  int count = 0;

  // Determine king (Core piece) squares.
  int ownKingSq  = getKingSquare(side_to_move_);
  int oppKingSq  = getKingSquare((side_to_move_ == Color::WHITE)
                                     ? Color::BLACK
                                     : Color::WHITE);

  if (ownKingSq < 0 || oppKingSq < 0) return 0;  // No king on board.

  // Iterate over all squares; for each non-empty square emit a feature index.
  for (int row = 0; row < kSize; ++row) {
    for (int col = 0; col < kSize; ++col) {
      uint8_t pc = grid_[row][col];
      if (pc == PieceCode::EMPTY) continue;

      int pieceSq = squareIndex(col, row);
      int feat = featureIndex(ownKingSq, oppKingSq, pieceSq, pc);
      if (feat >= 0 && count < maxFeatures) {
        buffer[count++] = feat;
      }
    }
  }

  return count;
}

// ─── Serialisation ───────────────────────────────────────────────────────────

void Board::toArray(uint8_t out[49]) const {
  for (int row = 0; row < kSize; ++row) {
    for (int col = 0; col < kSize; ++col) {
      out[row * kSize + col] = grid_[row][col];
    }
  }
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

int Board::squareIndex(int col, int row) const {
  return row * kSize + col;
}

void Board::updateZobristPiece(int col, int row, uint8_t oldCode, uint8_t newCode) {
  int sq = squareIndex(col, row);
  if (oldCode != PieceCode::EMPTY) zobrist_hash_ ^= zobrist_table_[sq][oldCode];
  if (newCode != PieceCode::EMPTY) zobrist_hash_ ^= zobrist_table_[sq][newCode];
}

int Board::getKingSquare(Color color) const {
  uint8_t target = (color == Color::WHITE) ? PieceCode::WC : PieceCode::BC;
  for (int row = 0; row < kSize; ++row) {
    for (int col = 0; col < kSize; ++col) {
      if (grid_[row][col] == target) {
        return squareIndex(col, row);
      }
    }
  }
  return -1;  // King not found.
}

int Board::featureIndex(int ownKingSq, int oppKingSq, int pieceSq,
                        uint8_t pieceCode) const {
  // feature_index = ownKingSq * 49 * 8 + oppKingSq * 8 + piece_type
  //   where piece_type = pieceCode - 1 (maps 1-3,5-7 → 0-2,4-6).
  //   Actually we map: WC=0, WS=1, WT=2, BC=4, BS=5, BT=6
  //   That gives 7 distinct values 0-6 (skipping 3).
  int ptype;
  switch (pieceCode) {
    case PieceCode::WC: ptype = 0; break;
    case PieceCode::WS: ptype = 1; break;
    case PieceCode::WT: ptype = 2; break;
    case PieceCode::BC: ptype = 4; break;
    case PieceCode::BS: ptype = 5; break;
    case PieceCode::BT: ptype = 6; break;
    default:            ptype = 3; break;  // Should not happen.
  }
  // feature_index = ownKingSq * (49 * 8) + oppKingSq * 8 + ptype
  //                = ownKingSq * 392 + oppKingSq * 8 + ptype
  // Max = 48*392 + 48*8 + 6 = 18816 + 384 + 6 = 19206
  return ownKingSq * 392 + oppKingSq * 8 + ptype;
}

}  // namespace nexus
