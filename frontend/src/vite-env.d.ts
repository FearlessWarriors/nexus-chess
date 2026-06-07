/// <reference types="vite/client" />

// Enable WASM module imports for AI engine integration
declare module '*.wasm' {
  const url: string;
  export default url;
}
