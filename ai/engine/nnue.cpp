// nnue.cpp — Nexus Chess NNUE Inference Implementation
// ============================================================================

#include "nnue.h"

#include <cmath>
#include <cstring>

namespace nexus {

// ─── Construction / Destruction ──────────────────────────────────────────────

NNUE::NNUE()
    : weights1_(static_cast<size_t>(kHiddenSize) * kInputSize, 0.0f),
      bias1_(kHiddenSize, 0.0f),
      weights2_(kHiddenSize, 0.0f),
      bias2_(0.0f),
      accumulator_(kHiddenSize, 0.0f),
      cache_valid_(false) {}

NNUE::~NNUE() = default;

// ─── Weight Loading ──────────────────────────────────────────────────────────

void NNUE::loadWeights(const float* w1, const float* b1,
                       const float* w2, const float* b2) {
  const size_t w1_size = static_cast<size_t>(kHiddenSize) * kInputSize;
  std::memcpy(weights1_.data(), w1, w1_size * sizeof(float));
  std::memcpy(bias1_.data(), b1, kHiddenSize * sizeof(float));
  std::memcpy(weights2_.data(), w2, kHiddenSize * sizeof(float));
  bias2_ = *b2;
  cache_valid_ = false;  // Invalidate cache after loading new weights.
}

// ─── Full Evaluation ─────────────────────────────────────────────────────────

float NNUE::evaluate(const int* activeFeatures, int numFeatures) {
  resetCache();

  // Accumulate feature vectors into the hidden-layer pre-activation.
  for (int i = 0; i < numFeatures; ++i) {
    int feat = activeFeatures[i];
    if (feat < 0 || feat >= kInputSize) continue;  // Guard against out-of-range.

    const float* row = weights1_.data() + static_cast<size_t>(feat) * kHiddenSize;
    // Wait — weights are stored [kHiddenSize * kInputSize], so feature f
    // occupies positions [f * kHiddenSize ... (f+1) * kHiddenSize).
    // Actually, we store weights as [hidden][input], row-major:
    //   weight(h, i) = weights1_[h * kInputSize + i]
    // To accumulate feature i: for each h, acc[h] += weights1_[h * kInputSize + i].
    // This is cache-friendly for sequential feature iteration.
    for (int h = 0; h < kHiddenSize; ++h) {
      accumulator_[h] += weights1_[static_cast<size_t>(h) * kInputSize + feat];
    }
  }

  // Add bias and apply ReLU.
  for (int h = 0; h < kHiddenSize; ++h) {
    accumulator_[h] += bias1_[h];
    accumulator_[h] = std::max(0.0f, accumulator_[h]);  // ReLU
  }

  // Second layer: dot product + bias → scalar.
  float score = bias2_;
  for (int h = 0; h < kHiddenSize; ++h) {
    score += accumulator_[h] * weights2_[h];
  }

  cache_valid_ = true;
  return score;
}

// ─── Incremental Update ──────────────────────────────────────────────────────

void NNUE::incrementalUpdate(const int* addedFeatures, int numAdded,
                             const int* removedFeatures, int numRemoved) {
  if (!cache_valid_) {
    // If the cache is invalid we cannot do an incremental update safely.
    // Caller should use evaluate() first.
    return;
  }

  // Remove deactivated features: subtract their weight rows from the
  // pre-activation accumulator, then re-apply ReLU.
  for (int i = 0; i < numRemoved; ++i) {
    int feat = removedFeatures[i];
    if (feat < 0 || feat >= kInputSize) continue;
    for (int h = 0; h < kHiddenSize; ++h) {
      accumulator_[h] -= weights1_[static_cast<size_t>(h) * kInputSize + feat];
    }
  }

  // Add newly activated features.
  for (int i = 0; i < numAdded; ++i) {
    int feat = addedFeatures[i];
    if (feat < 0 || feat >= kInputSize) continue;
    for (int h = 0; h < kHiddenSize; ++h) {
      accumulator_[h] += weights1_[static_cast<size_t>(h) * kInputSize + feat];
    }
  }

  // Re-apply bias (already included from full eval) — no need to re-add.
  // Re-apply ReLU: any activation that dropped below zero gets clipped.
  for (int h = 0; h < kHiddenSize; ++h) {
    accumulator_[h] = std::max(0.0f, accumulator_[h]);
  }
  // cache_valid_ remains true.
}

// ─── Cached Score Retrieval ──────────────────────────────────────────────────

float NNUE::getCachedScore() const {
  float score = bias2_;
  for (int h = 0; h < kHiddenSize; ++h) {
    score += accumulator_[h] * weights2_[h];
  }
  return score;
}

// ─── Cache Reset ─────────────────────────────────────────────────────────────

void NNUE::resetCache() {
  std::fill(accumulator_.begin(), accumulator_.end(), 0.0f);
  cache_valid_ = false;
}

}  // namespace nexus
