FROM node:22-bookworm-slim
WORKDIR /repo/plus-service
COPY plus-service/package.json ./
COPY plus-service/src ./src
COPY plus-pricing.json /repo/plus-pricing.json
ENV ATOMS_PLUS_STORE=sqlite
ENV ATOMS_PLUS_DATABASE_PATH=/data/plus.sqlite
ENV PORT=8787
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "src/server.mjs"]
