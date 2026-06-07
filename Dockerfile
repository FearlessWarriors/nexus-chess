# ─── Stage 1: Build ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src/ ./src/
RUN npm run build

# ─── Stage 2: Runtime ───────────────────────────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# Runtime dependencies only
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev

# Built JS + data directory
COPY --from=builder /app/dist/ ./dist/
RUN mkdir -p data

EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
