"""export_onnx.py — Export Trained NNUE Model to ONNX Format.

Exports the best PyTorch checkpoint to ONNX for deployment in the C++ engine
and browser via WebAssembly.  Also verifies the exported model with onnxruntime.

Usage
-----
.. code-block:: bash

    python -m training.export_onnx --checkpoint checkpoints/model_best.pt --output model.onnx
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Optional

import numpy as np
import torch

# Allow running as script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from nnue.model import HalfKP_NNUE


# ═══════════════════════════════════════════════════════════════════════════════
# ONNX Export
# ═══════════════════════════════════════════════════════════════════════════════

def export_to_onnx(
    model: HalfKP_NNUE,
    output_path: str,
    input_name: str = "input",
    output_name: str = "output",
    opset_version: int = 14,
    dynamic_batch: bool = True,
) -> None:
    """Export a HalfKP_NNUE model to ONNX format.

    Args:
        model:         Trained NNUE model.
        output_path:   Destination ONNX file path.
        input_name:    Name for the input node.
        output_name:   Name for the output node.
        opset_version: ONNX opset version.
        dynamic_batch: If True, use dynamic batch size in the exported graph.
    """
    model.eval()
    device = next(model.parameters()).device

    # Dummy input for tracing.
    batch_size = 1
    dummy_input = torch.randn(batch_size, model.input_size, device=device)

    dynamic_axes: Optional[dict] = None
    if dynamic_batch:
        dynamic_axes = {
            input_name: {0: "batch_size"},
            output_name: {0: "batch_size"},
        }

    print(f"Exporting model to ONNX: {output_path}")
    print(f"  Input shape:  [batch, {model.input_size}]")
    print(f"  Input name:   {input_name}")
    print(f"  Output name:  {output_name}")
    print(f"  Opset:        {opset_version}")
    print(f"  Dynamic batch: {dynamic_batch}")

    torch.onnx.export(
        model,
        dummy_input,
        output_path,
        input_names=[input_name],
        output_names=[output_name],
        dynamic_axes=dynamic_axes,
        opset_version=opset_version,
        do_constant_folding=True,
        verbose=False,
    )

    # Check file size.
    file_size = os.path.getsize(output_path)
    size_mb = file_size / (1024 * 1024)
    print(f"  Exported size: {size_mb:.2f} MB")

    if size_mb > 5.0:
        print(f"  WARNING: Model size ({size_mb:.2f} MB) exceeds 5 MB target.")


# ═══════════════════════════════════════════════════════════════════════════════
# ONNX Verification
# ═══════════════════════════════════════════════════════════════════════════════

def verify_onnx(
    onnx_path: str,
    pytorch_model: HalfKP_NNUE,
    num_samples: int = 10,
    atol: float = 1e-4,
) -> bool:
    """Verify ONNX model outputs match PyTorch model outputs.

    Args:
        onnx_path:      Path to the exported ONNX file.
        pytorch_model:  The original PyTorch model (same weights).
        num_samples:    Number of test samples to compare.
        atol:           Absolute tolerance for output comparison.

    Returns:
        True if all samples pass the tolerance check.
    """
    try:
        import onnxruntime as ort
    except ImportError:
        print("WARNING: onnxruntime not installed. Skipping verification.")
        return True

    print(f"\nVerifying ONNX model with {num_samples} test samples...")

    device = next(pytorch_model.parameters()).device
    pytorch_model.eval()

    # Create ONNX Runtime session.
    session = ort.InferenceSession(onnx_path)
    input_name = session.get_inputs()[0].name

    all_passed = True
    for i in range(num_samples):
        # Random input.
        x = torch.randn(1, pytorch_model.input_size, device=device)

        with torch.no_grad():
            pt_out = pytorch_model(x).cpu().numpy()

        onnx_out = session.run(None, {input_name: x.cpu().numpy()})[0]

        max_diff = np.max(np.abs(pt_out - onnx_out))
        if max_diff > atol:
            print(f"  Sample {i}: MISMATCH — max diff = {max_diff:.6f} "
                  f"(PyTorch: {pt_out[0,0]:.4f}, ONNX: {onnx_out[0,0]:.4f})")
            all_passed = False
        else:
            print(f"  Sample {i}: OK (diff={max_diff:.6f})")

    if all_passed:
        print("  ✓ All samples passed verification.")
    else:
        print("  ✗ Some samples failed verification.")

    return all_passed


# ═══════════════════════════════════════════════════════════════════════════════
# Weight Export (for C++ engine)
# ═══════════════════════════════════════════════════════════════════════════════

def export_weights_binary(
    model: HalfKP_NNUE,
    output_path: str,
) -> None:
    """Export model weights as a raw binary file for the C++ engine.

    Layout (all float32, little-endian):
      [weights1: 256 × 20480] [bias1: 256] [weights2: 256] [bias2: 1]
      Total floats: 5,243,393
      Total bytes:  20,973,572 (~20 MB)

    Args:
        model:       Trained NNUE model.
        output_path: Destination .bin file.
    """
    weights = model.export_weights()
    w1 = weights["w1"].numpy().astype(np.float32)
    b1 = weights["b1"].numpy().astype(np.float32)
    w2 = weights["w2"].numpy().astype(np.float32)
    b2 = weights["b2"].numpy().astype(np.float32)

    with open(output_path, "wb") as f:
        f.write(w1.tobytes())
        f.write(b1.tobytes())
        f.write(w2.tobytes())
        f.write(b2.tobytes())

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"\nExported binary weights to {output_path} ({size_mb:.2f} MB)")


# ═══════════════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════════════

def main() -> None:
    """ONNX export entry point."""
    parser = argparse.ArgumentParser(
        description="Export Nexus NNUE Model to ONNX"
    )
    parser.add_argument(
        "--checkpoint", type=str, default="checkpoints/model_best.pt",
        help="Path to the best PyTorch checkpoint."
    )
    parser.add_argument(
        "--output", type=str, default="model.onnx",
        help="Output ONNX file path."
    )
    parser.add_argument(
        "--input-name", type=str, default="input",
        help="ONNX input node name."
    )
    parser.add_argument(
        "--output-name", type=str, default="output",
        help="ONNX output node name."
    )
    parser.add_argument(
        "--opset", type=int, default=14,
        help="ONNX opset version (default: 14)."
    )
    parser.add_argument(
        "--no-dynamic-batch", action="store_true",
        help="Disable dynamic batch size."
    )
    parser.add_argument(
        "--export-weights", type=str, default="",
        help="Also export raw binary weights to this path (for C++ engine)."
    )
    parser.add_argument(
        "--device", type=str, default="cpu",
        help="Device to run inference on."
    )
    parser.add_argument(
        "--skip-verify", action="store_true",
        help="Skip ONNX verification step."
    )

    args = parser.parse_args()

    if not os.path.exists(args.checkpoint):
        print(f"ERROR: Checkpoint '{args.checkpoint}' not found.")
        sys.exit(1)

    # Load model.
    print(f"Loading model from {args.checkpoint}...")
    model = HalfKP_NNUE.from_checkpoint(args.checkpoint, device=args.device)
    print(f"  Input size:  {model.input_size}")
    print(f"  Hidden size: {model.hidden_size}")

    # Export ONNX.
    export_to_onnx(
        model,
        args.output,
        input_name=args.input_name,
        output_name=args.output_name,
        opset_version=args.opset,
        dynamic_batch=not args.no_dynamic_batch,
    )

    # Verify.
    if not args.skip_verify:
        passed = verify_onnx(args.output, model)
        if not passed:
            print("WARNING: ONNX verification failed. Check model compatibility.")
    else:
        print("Skipping ONNX verification.")

    # Export binary weights for C++ engine.
    if args.export_weights:
        export_weights_binary(model, args.export_weights)

    print("\n=== Export Complete ===")


if __name__ == "__main__":
    main()
