/**
 * config.ts — Centralized API Configuration
 *
 * Single source of truth for backend URLs.
 * Update API_HOST when deploying to a different server.
 */

// Cloud tunnel URL (temporary)
// For permanent deployment, change to your Render.com / cloud URL
// e.g. 'https://nexus-chess-api.onrender.com'
const API_HOST_CLOUD = 'https://0482d8a810b211.lhr.life';

// Use cloud URL when deployed, localhost when dev
const isProduction = typeof window !== 'undefined' && !window.location.hostname.includes('localhost');
export const API_HOST = isProduction ? API_HOST_CLOUD : 'http://localhost:3001';

export const API_BASE = API_HOST;
export const WS_URL = API_HOST.replace(/^http/, 'ws') + '/ws';
