/**
 * nnueBridge.ts — NNUE WASM Bridge for Nexus Gravity Chess
 *
 * Loads a compiled NNUE WebAssembly module for fast position evaluation.
 * Falls back gracefully to manual evaluation when WASM is unavailable.
 *
 * C++ bridge API (from bridge.cpp via Emscripten bindings):
 *   Module._evaluate(fenPtr)    → float  (centipawn score from side-to-move)
 *   Module._loadModel(ptr, sz)  → void   (load weights from float buffer)
 *   Module._init()              → void   (initialize engine)
 *   Module._destroy()           → void   (cleanup engine)
 *
 * Board encoding for WASM: 49-char string of piece codes
 *   0=empty, 1=WC, 2=WA, 3=WF, 5=BC, 6=BA, 7=BF
 *   Followed by space + turn char: " w" or " b"
 */

import type { BoardGrid, Color } from '../engine/types';

// ─── Singleton ────────────────────────────────────────────────────────────────

class NNUEBridge {
  /** Reference to the emscripten-generated Module (window.Module). */
  private wasmModule: Record<string, unknown> | null = null;

  /** Whether the WASM module loaded and initialized successfully. */
  private loaded: boolean = false;

  /** Pending init promise (so concurrent init() calls resolve together). */
  private initPromise: Promise<void> | null = null;

  // ─── Initialization ──────────────────────────────────────────────────────

  /**
   * Initialize the NNUE WASM bridge.
   *
   * Attempts to load the Emscripten-compiled nexus_engine.js from
   * `/wasm/nexus_engine.js`.  If the file is missing or the WASM fails
   * to instantiate, the bridge stays in fallback mode (isAvailable() → false).
   *
   * Safe to call multiple times — subsequent calls return the same promise.
   */
  async init(): Promise<void> {
    if (this.initPromise !== null) {
      return this.initPromise;
    }

    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    try {
      // 1. Fetch the emscripten JS glue
      const response = await fetch('/wasm/nexus_engine.js');
      if (!response.ok) {
        throw new Error(
          `[NNUEBridge] Failed to fetch nexus_engine.js: HTTP ${response.status}`,
        );
      }

      const jsCode = await response.text();

      // 2. Inject the script — emscripten's JS glue sets up window.Module
      //    and auto-fetches the .wasm file from the same directory.
      const script = document.createElement('script');
      script.textContent = jsCode;
      document.head.appendChild(script);

      // 3. Poll until Module.calledRun becomes true (emscripten convention).
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('[NNUEBridge] WASM module initialization timed out (10 s)'));
        }, 10000);

        const maxPolls = 200; // 200 × 50 ms = 10 s
        let polls = 0;
        const interval = setInterval(() => {
          polls++;
          const w = window as unknown as Record<string, unknown>;
          if (w.Module && (w.Module as Record<string, unknown>).calledRun) {
            clearTimeout(timeout);
            clearInterval(interval);
            resolve();
            return;
          }
          if (polls >= maxPolls) {
            clearTimeout(timeout);
            clearInterval(interval);
            reject(new Error('[NNUEBridge] WASM module polling exhausted'));
          }
        }, 50);
      });

      // 4. Grab the module reference.
      const w = window as unknown as Record<string, unknown>;
      if (w.Module) {
        this.wasmModule = w.Module as Record<string, unknown>;

        // Call engine init if available
        const initFn = this.wasmModule['init'] as (() => void) | undefined;
        if (typeof initFn === 'function') {
          initFn();
        }

        this.loaded = true;
        console.log('[NNUEBridge] ✅ WASM NNUE engine loaded and initialized');
      } else {
        throw new Error('[NNUEBridge] Module not found on window after script injection');
      }
    } catch (err) {
      console.warn(
        '[NNUEBridge] ⚠️  WASM loading failed — falling back to manual evaluation.',
        err,
      );
      this.loaded = false;
      this.wasmModule = null;
    }
  }

  // ─── Evaluation ──────────────────────────────────────────────────────────

  /**
   * Evaluate a board position via the NNUE WASM engine.
   *
   * @param board  Current 7×7 board grid.
   * @param color  Perspective to evaluate from.
   * @returns Centipawn-like score (positive = better for `color`).
   * @throws If WASM is not available (caller should check isAvailable() first).
   */
  evaluate(board: BoardGrid, color: Color): number {
    if (!this.loaded || this.wasmModule === null) {
      throw new Error('[NNUEBridge] WASM engine not available — call isAvailable() first');
    }

    // Encode board as 49-digit piece-code string + turn char
    const encoded = this._encodeBoardForWasm(board, color);

    try {
      // Bridge.cpp expose: float evaluate(const std::string& fen)
      const evalFn = this.wasmModule['evaluate'] as ((fen: string) => number) | undefined;
      if (typeof evalFn !== 'function') {
        throw new Error('[NNUEBridge] Module.evaluate is not a function');
      }
      const rawScore = evalFn(encoded);
      return rawScore;
    } catch (err) {
      throw new Error(`[NNUEBridge] WASM evaluate failed: ${String(err)}`);
    }
  }

  // ─── Weight Loading ──────────────────────────────────────────────────────

  /**
   * Load trained NNUE weights into the WASM engine.
   *
   * @param buffer  Raw weight data as an ArrayBuffer containing float32 values.
   *                Layout expected by bridge.cpp:
   *                [weights1 (kHiddenSize*kInputSize)] [bias1 (kHiddenSize)]
   *                [weights2 (kHiddenSize)] [bias2 (1)]
   */
  async loadWeights(buffer: ArrayBuffer): Promise<void> {
    if (!this.loaded || this.wasmModule === null) {
      console.warn('[NNUEBridge] Cannot load weights — WASM engine not available');
      return;
    }

    try {
      const floatArray = new Float32Array(buffer);
      const numBytes = floatArray.byteLength;
      const mallocFn = this.wasmModule['_malloc'] as ((size: number) => number) | undefined;
      const freeFn = this.wasmModule['_free'] as ((ptr: number) => void) | undefined;
      const loadModelFn = this.wasmModule['loadModel'] as
        | ((ptr: number, size: number) => void)
        | undefined;

      if (typeof mallocFn !== 'function' || typeof loadModelFn !== 'function') {
        throw new Error('[NNUEBridge] Required WASM exports (_malloc / loadModel) not found');
      }

      // Allocate memory inside WASM heap
      const ptr: number = mallocFn(numBytes);
      if (ptr === 0) {
        throw new Error('[NNUEBridge] _malloc returned null pointer');
      }

      // Copy our float data into the WASM heap
      const heapU8 = new Uint8Array(
        (this.wasmModule['HEAPU8'] as ArrayBufferLike),
      );
      heapU8.set(new Uint8Array(buffer), ptr);

      // Call the bridge's loadModel(intptr_t buffer_ptr, int size)
      loadModelFn(ptr, floatArray.length);

      // Free the temporary allocation
      if (typeof freeFn === 'function') {
        freeFn(ptr);
      }

      console.log(
        `[NNUEBridge] ✅ Weights loaded (${floatArray.length} floats, ${numBytes} bytes)`,
      );
    } catch (err) {
      console.warn('[NNUEBridge] Failed to load weights:', err);
    }
  }

  // ─── Status ──────────────────────────────────────────────────────────────

  /** Returns true if the WASM engine is ready for evaluation. */
  isAvailable(): boolean {
    return this.loaded && this.wasmModule !== null;
  }

  /** Tear down the engine and release WASM resources. */
  destroy(): void {
    if (this.wasmModule !== null) {
      const destroyFn = this.wasmModule['destroy'] as (() => void) | undefined;
      if (typeof destroyFn === 'function') {
        try {
          destroyFn();
        } catch {
          // Best-effort cleanup
        }
      }
    }
    this.wasmModule = null;
    this.loaded = false;
    this.initPromise = null;
  }

  // ─── Internal Helpers ────────────────────────────────────────────────────

  /**
   * Encode the board for the C++ NNUE evaluator.
   *
   * Format: 49 consecutive piece codes (row-major, row 0 to row 6),
   * followed by a space and the side-to-move character ('w' or 'b').
   *
   * Piece codes:
   *   0 = empty
   *   1 = White Core   (WC)
   *   2 = White Anchor (WA)
   *   3 = White Flux   (WF)
   *   5 = Black Core   (BC)
   *   6 = Black Anchor (BA)
   *   7 = Black Flux   (BF)
   */
  private _encodeBoardForWasm(board: BoardGrid, turn: Color): string {
    let encoded = '';
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 7; col++) {
        const piece = board[row][col];
        if (piece === null) {
          encoded += '0';
        } else {
          const base: number = piece.color === ('white' as Color) ? 0 : 4;
          let typeCode: number;
          switch (piece.type) {
            case 'core':
              typeCode = 1;
              break;
            case 'anchor':
              typeCode = 2;
              break;
            case 'flux':
              typeCode = 3;
              break;
            default:
              typeCode = 0;
          }
          encoded += String(base + typeCode);
        }
      }
    }
    // Append side to move
    encoded += ' ' + (turn === ('white' as Color) ? 'w' : 'b');
    return encoded;
  }
}

// ─── Module Export ────────────────────────────────────────────────────────────

export const nnueBridge = new NNUEBridge();
