# Estagio 1: Build das dependencias nativas (better-sqlite3, argon2)
FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

# Estagio 2: Imagem final de producao
FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init wget curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/database/database.sqlite
ENV LD_LIBRARY_PATH=/app/bin/piper:$LD_LIBRARY_PATH

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY database ./database
COPY database ./database_template
COPY public ./public
COPY src ./src
COPY bin ./bin
COPY data ./data

RUN chmod +x /app/bin/piper/piper && \
    mkdir -p /app/database/backups /app/public/uploads /app/uploads /app/scratch/audio_cache && \
    chown -R node:node /app

USER node

EXPOSE 3000

CMD ["dumb-init", "sh", "-c", "mkdir -p /app/database/migrations && cp -u /app/database_template/migrations/*.sql /app/database/migrations/ 2>/dev/null || true; node database/migrate.js && node src/server.js"]
