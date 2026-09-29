# --- Compila la interfaz ---
FROM node:22-slim AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- Imagen final ---
FROM node:22-slim
ENV NODE_ENV=production DB_FILE=/data/dulceria.db PORT=3000 NODE_NO_WARNINGS=1
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server/ server/
COPY --from=web /web/dist web/dist
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
