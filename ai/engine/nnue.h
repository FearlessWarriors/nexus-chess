// nnue.h — Nexus Chess NNUE Inference Header
// ============================================================================
// Efficiently updatable neural network evaluator for 7×7 Nexus chess.
// Architecture: HalfKP feature set → 256-unit hidden layer (ReLU) → scalar.
//
// Feature input dimension is 20,480 (compressed from raw HalfKP space).
// Weights are stored as flat float arrays for efficient SIMD-friendly access.
// ============================================================================

#pragma once

#include <algorithm>
#include <cstdint>
#include <vector>

namespace nexus {

// ─── Network Architecture Constants ──────────────────────────────────────────

/// Number of input features (compressed HalfKP feature space).
constexpr int kInputSize = 20480;

/// Hidden layer size (single fully-connected layer with ReLU).
constexpr int kHiddenSize = 256;

/// Output size (single scalar centipawn evaluation).
constexpr int kOutputSize = 1;

// ─── NNUE Evaluator ──────────────────────────────────────────────────────────

/// Efficiently Updatable Neural Network (NNUE) evaluator.
///
/// Maintains a feature-accumulator cache so that after a board move only
/// the changed features need to be added / removed, avoiding full recomputation
/// of the hidden-layer activation vector.
class NNUE {
 public:
  NNUE();
  ~NNUE();

  /// Load all network weights from external float arrays.
  ///
  /// \param w1  Flattened weights for layer 1, size [kHiddenSize * kInputSize].
  /// \param b1  Bias for layer 1, size [kHiddenSize].
  /// \param w2  Weights for layer 2, size [kHiddenSize].
  /// \param b2  Bias for layer 2 (single scalar).
  void loadWeights(const float* w1, const float* b1,
                   const float* w2, const float* b2);

  /// Full (cold) evaluation from a list of active feature indices.
  ///
  /// \param activeFeatures  Array of feature indices in [0, kInputSize).
  /// \param numFeatures     Number of active features.
  /// \return Centipawn evaluation score (positive favours side to move).
  float evaluate(const int* activeFeatures, int numFeatures);

  /// Incremental update: add and remove features from the cached accumulator.
  ///
  /// After calling this, the cached evaluation is updated and subsequent
  /// calls to getCachedScore() return the new value without full recomputation.
  ///
  /// \param addedFeatures    Features that became active after the move.
  /// \param numAdded         Number of added features.
  /// \param removedFeatures  Features that became inactive after the move.
  /// \param numRemoved       Number of removed features.
  void incrementalUpdate(const int* addedFeatures, int numAdded,
                         const int* removedFeatures, int numRemoved);

  /// Retrieve the score from the current accumulator cache.
  ///
  /// \return Centipawn score computed from the cached hidden-layer activations.
  float getCachedScore() const;

  /// Reset the feature accumulator cache to all-zero.
  /// Call this when starting evaluation of a fresh position.
  void resetCache();

 private:
  // ─── Weight storage ────────────────────────────────────────────────────

  /// Layer-1 weights, flattened row-major: [kHiddenSize * kInputSize].
  std::vector<float> weights1_;

  /// Layer-1 biases: [kHiddenSize].
  std::vector<float> bias1_;

  /// Layer-2 weights: [kHiddenSize].
  std::vector<float> weights2_;

  /// Layer-2 bias (single scalar).
  float bias2_;

  // ─── Accumulator cache ─────────────────────────────────────────────────

  /// Accumulator: sum of input-feature weight rows for currently active
  /// features.  Shape: [kHiddenSize].
  std::vector<float> accumulator_;

  /// Whether the accumulator currently holds valid data.
  bool cache_valid_;
};

}  // namespace nexus
