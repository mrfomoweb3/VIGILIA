# Vigilia — production image.
# Host-agnostic: works on Railway, Fly.io, Render, Cloud Run, or any Docker host.

FROM node:22-slim AS build
WORKDIR /app

# Install deps first so this layer caches across source changes.
COPY package.json package-lock.json* ./
RUN npm ci

# Build TypeScript -> dist/
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime image ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Compiled server + the static landing page.
COPY --from=build /app/dist ./dist
COPY public ./public

# The app reads PORT from the environment; hosts inject their own.
ENV PORT=3000
EXPOSE 3000

# Run as the non-root user that the node image already provides.
USER node

CMD ["node", "dist/server.js"]
