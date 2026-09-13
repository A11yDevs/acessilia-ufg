# Estagio 1: Build das dependencias nativas (better-sqlite3, argon2)
FROM node:22-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci

# Estagio 2: Imagem final de producao
FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache dumb-init

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV DATABASE_PATH=/app/database/database.sqlite

COPY --from=builder /app/node_modules ./node_modules
COPY package*.json ./
COPY database ./database
COPY public ./public
COPY src ./src

RUN mkdir -p /app/database/backups /app/public/uploads && \
    chown -R node:node /app

USER node

EXPOSE 3000

CMD ["dumb-init", "sh", "-c", "node database/migrate.js && node src/server.js"]
