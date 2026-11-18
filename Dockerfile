FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_FILE=/data/state.json
COPY package*.json .npmrc ./
RUN npm ci --omit=dev
COPY --chown=node:node tsconfig.json ./
COPY --chown=node:node shared ./shared
COPY --chown=node:node server ./server
COPY --chown=node:node --from=build /app/client/dist ./client/dist
# The app runs as the unprivileged `node` user and only writes to /data. Create the directory
# before declaring the volume so a new named volume inherits this ownership.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s CMD wget -qO- "http://localhost:${PORT}/healthz" || exit 1
CMD ["node", "--import", "tsx", "server/index.ts"]
