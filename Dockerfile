# Masters of Pwnage — site + lobby server in one container.
# Build:  docker build -t mop .
# Run:    docker run -p 8787:8787 mop
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Site served from the root of this server (not under /mop-playable/).
RUN BASE_PATH=/ npm run build

FROM node:22-bookworm-slim
# No TRUST_PROXY here: trusting X-Forwarded-For without a proxy in front lets clients pick their IP.
# Set it (or CLIENT_IP_HEADER) where a proxy exists: homelab compose, fly.toml, render.yaml.
ENV NODE_ENV=production PORT=8787 STATIC_DIR=/app/dist
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY --from=build /app/dist /app/dist
EXPOSE 8787
USER node
CMD ["node", "src/index.js"]
