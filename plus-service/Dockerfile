# Build context = monorepo root (required for plus-pricing.json SSOT):
#   docker build -f plus-service/Dockerfile -t atoms-plus .
#   fly deploy --dockerfile plus-service/Dockerfile -c plus-service/fly.toml
FROM node:22-bookworm-slim
WORKDIR /repo/plus-service
COPY plus-service/package.json plus-service/package-lock.json ./
RUN npm ci --omit=dev
COPY plus-service/src ./src
COPY plus-pricing.json /repo/plus-pricing.json
ENV ATOMS_PLUS_STORE=postgres
ENV PORT=8787
EXPOSE 8787
CMD ["node", "src/server.mjs"]
