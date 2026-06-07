// bridge.cpp — Emscripten / WebAssembly Bindings for Nexus Chess Engine
// ============================================================================
// Exposes the C++ NNUE evaluator and Board to JavaScript via Embind.
// Build with: emcc --bind bridge.cpp nnue.cpp board.cpp -o nexus_engine.js
// ============================================================================

#include <emscripten/bind.h>

#include <cstring>
#include <string>
#include <vector>

#include "board.h"
#include "nnue.h"

namespace {

// ─── Global Engine State ─────────────────────────────────────────────────────

/// Singleton NNUE evaluator instance (lazily created).
nexus::NNUE* g_nnue = nullptr;

/// Current board state.
nexus::Board* g_board = nullptr;

/// Temporary buffer for feature extraction.
std::vector<int> g_feature_buffer;

// ─── Module-level Initialisation / Teardown ──────────────────────────────────

/// Initialise the engine: create the NNUE evaluator and board.
void init() {
  if (g_nnue == nullptr) {
    g_nnue = new nexus::NNUE();
  }
  if (g_board == nullptr) {
    g_board = new nexus::Board();
  }
  g_feature_buffer.resize(256);  // Plenty of room for 49 features max.
}

/// Destroy the engine and release all resources.
void destroy() {
  delete g_nnue;  g_nnue = nullptr;
  delete g_board; g_board = nullptr;
  g_feature_buffer.clear();
}

/// Load model weights from a JavaScript ArrayBuffer / TypedArray.
///
/// \param buffer_ptr  Pointer to raw float data (as integer from JS).
/// \param size        Number of floats in the buffer.
///
/// Layout expected:
///   [weights1 (256*20480)] [bias1 (256)] [weights2 (256)] [bias2 (1)]
void loadModel(intptr_t buffer_ptr, int size) {
  if (g_nnue == nullptr) init();

  const float* data = reinterpret_cast<const float*>(buffer_ptr);

  // Expected sizes.
  constexpr int w1_size = nexus::kHiddenSize * nexus::kInputSize;  // 5,242,880
  constexpr int b1_size = nexus::kHiddenSize;                       // 256
  constexpr int w2_size = nexus::kHiddenSize;                       // 256
  constexpr int b2_size = 1;
  constexpr int expected = w1_size + b1_size + w2_size + b2_size;   // 5,243,393

  if (size < expected) return;  // Buffer too small.

  const float* w1 = data;
  const float* b1 = w1 + w1_size;
  const float* w2 = b1 + b1_size;
  const float* b2 = w2 + w2_size;

  g_nnue->loadWeights(w1, b1, w2, b2);
}

/// Evaluate a position given as a FEN-like string or board array.
///
/// \param fen  Board state encoded as a string of 49 piece codes
///             (e.g., "706050007060500000000...1020300010203000").
/// \return Centipawn evaluation score from the perspective of the side
///         encoded in the position.
float evaluate(const std::string& fen) {
  if (g_nnue == nullptr || g_board == nullptr) init();

  // Parse the FEN-like string: 49 digits, each 0–7.
  if (fen.length() < 49) return 0.0f;

  // Load the board from the string.
  g_board->reset();
  // We set up the board by making moves from the encoded position.
  // For simplicity we reconstruct the board array directly.
  // (The Board class doesn't expose setPiece directly, so we build
  //  features from the raw string.)
  //
  // Actually, for pure evaluation we just need the feature indices.
  // We'll extract them from the encoded position directly.

  // Decode the position: find own king and opponent king squares.
  // Determine side to move from the fen suffix (if present) or assume White.
  // FEN format: <49 piece codes> <w|b>
  char sideChar = 'w';
  if (fen.length() >= 51 && (fen[50] == 'w' || fen[50] == 'b')) {
    sideChar = fen[50];
  }

  bool whiteToMove = (sideChar == 'w');
  int ownKingSq = -1, oppKingSq = -1;
  uint8_t ownKingCode = whiteToMove ? nexus::PieceCode::WC : nexus::PieceCode::BC;
  uint8_t oppKingCode = whiteToMove ? nexus::PieceCode::BC : nexus::PieceCode::WC;

  // Scan for kings.
  for (int i = 0; i < 49; ++i) {
    char c = fen[i];
    uint8_t code = static_cast<uint8_t>(c - '0');
    if (code == ownKingCode) ownKingSq = i;
    if (code == oppKingCode) oppKingSq = i;
  }

  if (ownKingSq < 0 || oppKingSq < 0) return 0.0f;

  // Extract active features.
  int featCount = 0;
  for (int i = 0; i < 49; ++i) {
    char c = fen[i];
    uint8_t code = static_cast<uint8_t>(c - '0');
    if (code == 0) continue;

    // Map piece code to piece type index.
    int ptype;
    switch (code) {
      case nexus::PieceCode::WC: ptype = 0; break;
      case nexus::PieceCode::WS: ptype = 1; break;
      case nexus::PieceCode::WT: ptype = 2; break;
      case nexus::PieceCode::BC: ptype = 4; break;
      case nexus::PieceCode::BS: ptype = 5; break;
      case nexus::PieceCode::BT: ptype = 6; break;
      default:                   ptype = 3; break;
    }
    int feat = ownKingSq * 392 + oppKingSq * 8 + ptype;
    if (feat >= 0 && feat < nexus::kInputSize &&
        featCount < static_cast<int>(g_feature_buffer.size())) {
      g_feature_buffer[featCount++] = feat;
    }
  }

  float score = g_nnue->evaluate(g_feature_buffer.data(), featCount);
  return whiteToMove ? score : -score;
}

/// Reset the board to the starting position.
void resetBoard() {
  if (g_board == nullptr) init();
  g_board->reset();
}

/// Make a move on the internal board.
/// \return true if the move was legal and executed.
bool makeMove(int fromCol, int fromRow, int toCol, int toRow) {
  if (g_board == nullptr) init();
  return g_board->makeMove(fromCol, fromRow, toCol, toRow);
}

/// Evaluate the current internal board position.
/// \return Centipawn score from the perspective of the side to move.
float evaluateBoard() {
  if (g_nnue == nullptr || g_board == nullptr) init();

  int numFeat = g_board->getActiveFeatures(
      g_feature_buffer.data(),
      static_cast<int>(g_feature_buffer.size()));

  return g_nnue->evaluate(g_feature_buffer.data(), numFeat);
}

}  // namespace

// ─── Emscripten Bindings ─────────────────────────────────────────────────────

EMSCRIPTEN_BINDINGS(nexus_engine) {
  emscripten::function("init",          &init);
  emscripten::function("loadModel",     &loadModel);
  emscripten::function("evaluate",      &evaluate);
  emscripten::function("evaluateBoard", &evaluateBoard);
  emscripten::function("resetBoard",    &resetBoard);
  emscripten::function("makeMove",      &makeMove);
  emscripten::function("destroy",       &destroy);
}
