#!/bin/bash
# train_pipeline.sh — End-to-End Nexus Chess NNUE Training Pipeline
# ==============================================================================
# Runs all five stages sequentially:
#   1. Self-play data generation   (~30 min)
#   2. Deep search labeling        (~60 min)
#   3. NNUE model training         (~60 min)
#   4. Model validation            (~10 min)
#   5. ONNX export                  (< 1 min)
#
# Usage:
#   chmod +x scripts/train_pipeline.sh
#   ./scripts/train_pipeline.sh
# ==============================================================================

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Tunable parameters.
GAMES=${GAMES:-20000}
WORKERS=${WORKERS:-8}
SEARCH_DEPTH=${SEARCH_DEPTH:-10}
TRAIN_EPOCHS=${TRAIN_EPOCHS:-50}
BATCH_SIZE=${BATCH_SIZE:-8192}
TOURNAMENT_GAMES=${TOURNAMENT_GAMES:-200}

DATA_DIR="data"
POSITIONS_DIR="${DATA_DIR}/positions"
CHECKPOINT_DIR="checkpoints"
ONNX_OUTPUT="model.onnx"

# ─── Path validation ──────────────────────────────────────────────────────────
echo "=== Nexus NNUE Training Pipeline ==="
echo "Working directory: $(pwd)"
echo ""

if ! command -v python &>/dev/null; then
    echo "ERROR: python not found in PATH."
    exit 1
fi

# ─── Step 1: Self-Play Data Generation ────────────────────────────────────────
echo "Step 1/5: Self-play data generation"
echo "  Games:   ${GAMES}"
echo "  Workers: ${WORKERS}"
echo "  Output:  ${POSITIONS_DIR}"
echo ""

python -m training.self_play \
    --games "${GAMES}" \
    --workers "${WORKERS}" \
    --output "${POSITIONS_DIR}"

echo ""
echo "  ✓ Self-play complete. Positions saved to ${POSITIONS_DIR}/"
echo ""

# ─── Step 2: Deep Search Labeling ─────────────────────────────────────────────
echo "Step 2/5: Deep search labeling"
echo "  Depth:   ${SEARCH_DEPTH}"
echo "  Workers: ${WORKERS}"
echo ""

python -m training.data_gen \
    --input "${POSITIONS_DIR}" \
    --output "${DATA_DIR}/train_data.h5" \
    --depth "${SEARCH_DEPTH}" \
    --workers "${WORKERS}"

echo ""
echo "  ✓ Data labeling complete. HDF5 saved to ${DATA_DIR}/train_data.h5"
echo ""

# ─── Step 3: NNUE Training ────────────────────────────────────────────────────
echo "Step 3/5: NNUE Training"
echo "  Epochs:     ${TRAIN_EPOCHS}"
echo "  Batch size: ${BATCH_SIZE}"
echo "  Device:     auto (CUDA if available)"
echo ""

python -m training.train \
    --data "${DATA_DIR}/train_data.h5" \
    --epochs "${TRAIN_EPOCHS}" \
    --batch-size "${BATCH_SIZE}" \
    --checkpoint-dir "${CHECKPOINT_DIR}"

echo ""
echo "  ✓ Training complete. Checkpoints saved to ${CHECKPOINT_DIR}/"
echo ""

# ─── Step 4: Model Validation ─────────────────────────────────────────────────
echo "Step 4/5: Model validation (tournament)"
echo "  Games: ${TOURNAMENT_GAMES}"
echo ""

python -m training.validate \
    --new "${CHECKPOINT_DIR}/model_best.pt" \
    --feature-map "${DATA_DIR}/train_data_feature_map.npy" \
    --games "${TOURNAMENT_GAMES}"

echo ""
echo "  ✓ Validation complete."
echo ""

# ─── Step 5: ONNX Export ──────────────────────────────────────────────────────
echo "Step 5/5: ONNX export"
echo "  Output: ${ONNX_OUTPUT}"
echo ""

python -m training.export_onnx \
    --checkpoint "${CHECKPOINT_DIR}/model_best.pt" \
    --output "${ONNX_OUTPUT}" \
    --export-weights "${DATA_DIR}/model_weights.bin"

echo ""
echo "  ✓ ONNX export complete."
echo ""

# ─── Summary ──────────────────────────────────────────────────────────────────
echo "=== Pipeline Complete ==="
echo ""
echo "Artifacts produced:"
echo "  Positions:       ${POSITIONS_DIR}/"
echo "  Training data:   ${DATA_DIR}/train_data.h5"
echo "  Feature map:     ${DATA_DIR}/train_data_feature_map.npy"
echo "  Checkpoints:     ${CHECKPOINT_DIR}/"
echo "  ONNX model:      ${ONNX_OUTPUT}"
echo "  Binary weights:  ${DATA_DIR}/model_weights.bin"
echo ""
echo "Next steps:"
echo "  1. Copy model.onnx to the frontend's public/wasm/ directory"
echo "  2. Build the C++ engine:  cd engine && make all"
echo "  3. Run integration tests"
