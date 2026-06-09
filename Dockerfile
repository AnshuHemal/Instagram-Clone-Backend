# ── Build Stage ───────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files and install ALL dependencies (including devDeps for build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run prisma:generate
RUN npm run build

# ── Production Stage ──────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built artifacts from builder
COPY --from=builder /app/dist        ./dist
COPY --from=builder /app/prisma      ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", "dist/main"]
