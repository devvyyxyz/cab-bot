# syntax=docker/dockerfile-buildx:1
FROM node:22-alpine AS base

# Install runtime deps + build tools in one layer.
# build-base gives us gcc/g++/make/musl-dev for better-sqlite3.
RUN apk add --no-cache \
    python3 \
    build-base \
    py3-pil \
    ttf-dejavu

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
