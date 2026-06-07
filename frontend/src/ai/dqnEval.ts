/**
 * dqnEval.ts — Pure-JS DQN Neural Network Evaluator
 *
 * Loads a JSON-exported DQN model and performs forward pass evaluation.
 * No dependencies on onnxruntime-web or any other heavy library.
 *
 * Model architecture: 392 -> 512 -> ReLU -> 256 -> ReLU -> 128 -> ReLU -> 1 -> Tanh
 */

import type { GameState } from '../engine/types';
import { Color, PieceType } from '../engine/types';

// ─── Model Layout ───────────────────────────────────────────────────────────

interface LayerWeights {
  type: 'weight' | 'bias';
  shape: number[];
  values: number[];
}

interface DQNModel {
  architecture: number[];
  activations: string[];
  layers: LayerWeights[];
}

// ─── Layer cache (for fast inference) ──────────────────────────────────────

let cachedModel: DQNModel | null = null;
let modelLoaded = false;

// Cached as typed arrays for performance
interface CachedLayer {
  weights: Float32Array;
  bias: Float32Array;
  inDim: number;
  outDim: number;
  activation: string;
}

let cachedLayers: CachedLayer[] = [];

// ─── Activation functions ──────────────────────────────────────────────────

function relu(x: number): number { return Math.max(0, x); }
function tanh(x: number): number { return Math.tanh(x); }

function applyActivation(x: number, name: string): number {
  switch (name) {
    case 'relu': return relu(x);
    case 'tanh': return tanh(x);
    default: return x;
  }
}

// ─── Model loading ─────────────────────────────────────────────────────────

export async function loadDQNModel(url: string): Promise<boolean> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return false;
    const raw: DQNModel = await resp.json();
    cachedModel = raw;

    // Build cached layers
    const { architecture, activations, layers } = raw;
    cachedLayers = [];
    let layerIdx = 0;
    for (let i = 0; i < architecture.length - 1; i++) {
      const inDim = architecture[i];
      const outDim = architecture[i + 1];
      const w = layers[layerIdx];
      const b = layers[layerIdx + 1];

      if (w?.type !== 'weight' || b?.type !== 'bias') {
        console.warn(`[DQN] Bad layer format at index ${layerIdx}`);
        modelLoaded = false;
        return false;
      }

      cachedLayers.push({
        weights: new Float32Array(w.values),
        bias: new Float32Array(b.values),
        inDim,
        outDim,
        activation: activations[i + 1] ?? 'linear',
      });
      layerIdx += 2;
    }

    modelLoaded = true;
    console.log(`[DQN] Model loaded: ${architecture.join('→')}, ${cachedLayers.length} layers`);
    return true;
  } catch (e) {
    console.warn('[DQN] Failed to load model:', e);
    modelLoaded = false;
    return false;
  }
}

export function isDQNLoaded(): boolean {
  return modelLoaded;
}

// ─── Board encoding ────────────────────────────────────────────────────────

/**
 * Convert GameState to a 49×8 one-hot float32 array.
 *  0: WC, 1: WA, 2: WF, 3: reserved
 *  4: BC, 5: BA, 6: BF, 7: side-to-move
 */
function boardToInput(state: GameState): Float32Array {
  const input = new Float32Array(49 * 8);

  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const piece = state.board[r][c];
      if (piece === null) continue;
      const sq = r * 7 + c;
      let ch: number;
      if (piece.color === Color.WHITE) {
        ch = piece.type === PieceType.CORE ? 0 : piece.type === PieceType.ANCHOR ? 1 : 2;
      } else {
        ch = piece.type === PieceType.CORE ? 4 : piece.type === PieceType.ANCHOR ? 5 : 6;
      }
      input[sq * 8 + ch] = 1.0;
    }
  }

  // Channel 7: side to move indicator
  const sideVal = state.turn === Color.WHITE ? 1.0 : 0.0;
  for (let sq = 0; sq < 49; sq++) {
    input[sq * 8 + 7] = sideVal;
  }

  return input;
}

// ─── Forward pass ──────────────────────────────────────────────────────────

function forwardLayer(
  input: Float32Array,
  output: Float32Array,
  weights: Float32Array,
  bias: Float32Array,
  inDim: number,
  outDim: number,
  activation: string,
): void {
  for (let o = 0; o < outDim; o++) {
    let sum = bias[o];
    const wOffset = o * inDim;
    for (let i = 0; i < inDim; i++) {
      sum += input[i] * weights[wOffset + i];
    }
    output[o] = applyActivation(sum, activation);
  }
}

/**
 * Evaluate a game state using the DQN model.
 * Returns a value in [-1, 1] from the perspective of the CURRENT player.
 */
export function dqnEvaluate(state: GameState): number {
  if (!modelLoaded || cachedLayers.length === 0) {
    return 0; // fallback: neutral evaluation
  }

  const input = boardToInput(state);

  // Layer-by-layer forward pass with buffer reuse
  let current = input;
  for (let l = 0; l < cachedLayers.length; l++) {
    const layer = cachedLayers[l];
    const output = new Float32Array(layer.outDim);
    forwardLayer(current, output, layer.weights, layer.bias, layer.inDim, layer.outDim, layer.activation);
    current = output;
  }

  return current[0]; // Single scalar output
}
