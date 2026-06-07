# Nexus Chess — AI Inference Engine Build Configuration
# ==============================================================================
# This Makefile provides build targets for both native (x86_64) and WebAssembly
# (Emscripten) compilation of the C++ neural network inference engine.
#
# Prerequisites:
#   - Native:   GCC/Clang with C++17 support
#   - WASM:     Emscripten SDK (emcc) installed and activated
#               See https://emscripten.org/docs/getting_started/downloads.html
# ==============================================================================

# ─── Variables ────────────────────────────────────────────────────────────────
CXX       ?= g++
EMCXX     ?= emcc
CXXFLAGS  := -std=c++17 -O3 -Wall -Wextra
EMFLAGS   := -O3 -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s EXPORTED_FUNCTIONS='["_infer","_malloc","_free"]'
SRC_DIR   := .
BUILD_DIR := build
DIST_DIR  := ../../frontend/public/wasm

# Source files (bridge.cpp is Emscripten-only; excluded from native build).
NATIVE_SRCS := $(SRC_DIR)/board.cpp $(SRC_DIR)/nnue.cpp
WASM_SRCS   := $(SRC_DIR)/board.cpp $(SRC_DIR)/nnue.cpp $(SRC_DIR)/bridge.cpp
HEADERS     := $(SRC_DIR)/board.h $(SRC_DIR)/nnue.h

# ─── Targets ──────────────────────────────────────────────────────────────────

.PHONY: all native wasm clean

all: native wasm

# Native build (for training & validation — excludes bridge.cpp)
native: $(BUILD_DIR)/native/nexus_native

$(BUILD_DIR)/native/nexus_native: $(NATIVE_SRCS) $(HEADERS)
	@mkdir -p $(BUILD_DIR)/native
	$(CXX) $(CXXFLAGS) $(NATIVE_SRCS) -o $@

# Emscripten WASM build (for browser inference — includes bridge.cpp)
wasm: $(DIST_DIR)/nexus_engine.js

$(DIST_DIR)/nexus_engine.js: $(WASM_SRCS) $(HEADERS)
	@mkdir -p $(DIST_DIR)
	$(EMCXX) $(CXXFLAGS) $(EMFLAGS) \
		--bind \
		$(WASM_SRCS) \
		-o $(DIST_DIR)/nexus_engine.js

# Clean build artifacts
clean:
	rm -rf $(BUILD_DIR)
	rm -rf $(DIST_DIR)

# Quick help
help:
	@echo "Nexus Chess AI Engine Build"
	@echo "  make native  - Build native binary (requires GCC/Clang)"
	@echo "  make wasm    - Build WASM bundle (requires Emscripten SDK)"
	@echo "  make all     - Build both targets"
	@echo "  make clean   - Remove all build artifacts"
	@echo "  make help    - Show this message"
