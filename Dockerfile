FROM node:25-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json schema.sql ./
COPY src ./src
RUN npm run build

FROM ghcr.io/puppeteer/puppeteer:24.43.1
USER root
WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/templates/db_listing.html ./templates/db_listing.html
COPY schema.sql ./
RUN mkdir -p /data && chown -R pptruser:pptruser /app /data
USER pptruser
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "dist/server.js"]
