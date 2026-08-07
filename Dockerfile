# syntax=docker/dockerfile-buildx:1
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

# Python is needed for the /tierlist command (Pillow + DejaVu fonts).
RUN apk add --no-cache python3 py3-pil font-dejavu

# The tierlist script writes PNGs to this directory.
RUN mkdir -p /app/tierlists

ENV NODE_ENV=production
ENV TIERLIST_OUT_DIR=/app/tierlists

EXPOSE 3000
CMD ["node", "index.js"]
