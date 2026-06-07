// board.h — Nexus Chess 7×7 Board Representation
// ============================================================================
// Compact board encoding with move history, Zobrist hashing, and HalfKP
// feature extraction.  Piece codes are kept consistent with the TypeScript
// engine:  0=empty, 1=WC, 2=WS, 3=WT, 5=BC, 6=BS, 7=BT.
// ============================================================================

#pragma once

#include <cstdint>
#include <vector>

namespace nexus {

// ─── Enumerations ────────────────────────────────────────────────────────────

/// Player colour.
enum class Color : uint8_t { WHITE = 0, BLACK = 1 };

/// Piece type (ignoring colour).
enum class PieceType : uint8_t { CORE = 0, SENTINEL = 1, SCOUT = 2 };

// ─── Piece Code Helpers ──────────────────────────────────────────────────────

/// Piece codes as used in the 7×7 grid:
///   0 = empty, 1=WC, 2=WS, 3=WT, 5=BC, 6=BS, 7=BT.
namespace PieceCode {
  constexpr uint8_t EMPTY    = 0;
  constexpr uint8_t WC       = 1;   // White Core
  constexpr uint8_t WS       = 2;   // White Sentinel
  constexpr uint8_t WT       = 3;   // White Scout
  constexpr uint8_t BC       = 5;   // Black Core
  constexpr uint8_t BS       = 6;   // Black Sentinel
  constexpr uint8_t BT       = 7;   // Black Scout

  /// Return the colour of a piece code (WHITE if empty).
  inline Color colorOf(uint8_t code) {
    if (code == EMPTY) return Color::WHITE;
    return (code <= WT) ? Color::WHITE : Color::BLACK;
  }

  /// Return the piece type of a piece code (CORE if empty).
  inline PieceType typeOf(uint8_t code) {
    switch (code) {
      case WC: case BC: return PieceType::CORE;
      case WS: case BS: return PieceType::SENTINEL;
      case WT: case BT: return PieceType::SCOUT;
      default:          return PieceType::CORE;
    }
  }
}  // namespace PieceCode

// ─── Move Representation ─────────────────────────────────────────────────────

/// A single move on the 7×7 board.
struct Move {
  int from_col;
  int from_row;
  int to_col;
  int to_row;
};

// ─── Board ───────────────────────────────────────────────────────────────────

/// Compact 7×7 board with undo support and Zobrist hashing.
///
/// Board layout (initial):
///   Row 0 (BLACK back rank): [BT, BS, BS, BC, BT, BS, BT]  (3 Scouts, 3 Sentinels, 1 Core)
///   Rows 1–5:                empty
///   Row 6 (WHITE back rank): [WT, WS, WS, WC, WT, WS, WT]  (3 Scouts, 3 Sentinels, 1 Core)
class Board {
 public:
  static constexpr int kSize = 7;
  static constexpr int kNumSquares = kSize * kSize;  // 49

  Board();

  /// Reset to the standard starting position.
  void reset();

  // ─── Accessors ─────────────────────────────────────────────────────────

  /// Return the piece code at (col, row).  0 = empty.
  uint8_t getPieceAt(int col, int row) const;

  /// Return whose turn it is.
  Color sideToMove() const { return side_to_move_; }

  /// Return the current full-move number (starts at 1).
  int fullMoveNumber() const { return fullmove_number_; }

  // ─── Move Execution ────────────────────────────────────────────────────

  /// Execute a move on the board.  Returns true on success.
  bool makeMove(int fromCol, int fromRow, int toCol, int toRow);

  /// Undo the last move.  Returns true on success.
  bool undoMove();

  // ─── Feature Extraction ────────────────────────────────────────────────

  /// Extract active HalfKP feature indices for the current position.
  ///
  /// \param buffer      Output buffer to write feature indices into.
  /// \param maxFeatures Maximum capacity of the buffer.
  /// \return Number of features written (may be less than maxFeatures).
  int getActiveFeatures(int* buffer, int maxFeatures) const;

  // ─── Hashing ───────────────────────────────────────────────────────────

  /// 64-bit Zobrist hash of the current position.
  uint64_t hash() const { return zobrist_hash_; }

  // ─── Utility ───────────────────────────────────────────────────────────

  /// Return the 7×7 grid as a flat array of 49 piece codes, row-major.
  void toArray(uint8_t out[49]) const;

 private:
  /// Internal grid: [row][col], each cell is a piece code (0–7).
  uint8_t grid_[kSize][kSize];

  /// Whose turn it is.
  Color side_to_move_;

  /// Full-move counter (incremented after Black's move).
  int fullmove_number_;

  /// Zobrist hash of the current position.
  uint64_t zobrist_hash_;

  /// Move history for undo support.
  struct HistoryEntry {
    Move move;
    uint8_t captured;         // Piece code of the captured piece (0 if none).
    uint64_t prev_hash;
    Color prev_side;
  };
  std::vector<HistoryEntry> history_;

  // ─── Zobrist table ─────────────────────────────────────────────────────

  /// 49 squares × 8 piece codes = 392 random 64-bit keys.
  static uint64_t zobrist_table_[49][8];

  /// Side-to-move key (XORed when it's Black's turn).
  static constexpr uint64_t kZobristBlackToMove = 0x9E3779B97F4A7C15ULL;

  /// Initialise the Zobrist table with deterministic pseudo-random values.
  static void initZobristTable();

  /// Whether the Zobrist table has been seeded.
  static bool zobrist_initialized_;

  // ─── Internal helpers ──────────────────────────────────────────────────

  int squareIndex(int col, int row) const;
  void updateZobristPiece(int col, int row, uint8_t oldCode, uint8_t newCode);
  int getKingSquare(Color color) const;
  int featureIndex(int ownKingSq, int oppKingSq, int pieceSq,
                   uint8_t pieceCode) const;
};

}  // namespace nexus
