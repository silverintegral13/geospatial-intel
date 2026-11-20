# On-prem / private-cloud image. Build from the repo root:
#   docker build -f api/Dockerfile -t bhoomipulse-api .
#   docker run -p 8787:8787 -e ADMIN_TOKEN=change-me -e STORE_PATH=/data/store.json -v bp:/data bhoomipulse-api
FROM node:22-alpine
WORKDIR /app
COPY web/engine ./web/engine
COPY web/data/india_districts.geojson ./web/data/india_districts.geojson
COPY api ./api
ENV PORT=8787 NODE_ENV=production
EXPOSE 8787
USER node
CMD ["node", "api/server.mjs"]
