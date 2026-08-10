# syntax=docker/dockerfile-buildx:1
FROM node:22-alpine AS base

# Install build deps + runtime deps in one layer to keep image small.
# Build deps are needed for better-sqlite3 (node-gyp).
# Pillow/font-dejavu are needed for the /tierlist Python script.
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    musl-dev \
    py3-pil \
    font-dejavu

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# The tierlist script writes PNGs to this directory.
RUN mkdir -p /app/tierlists

ENV NODE_ENV=production
ENV TIERLIST_OUT_DIR=/app/tierlists

EXPOSE 3000
CMD ["node", "index.js"]
