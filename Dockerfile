FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs art-direction.json ./
COPY src ./src
COPY public ./public
COPY assets ./assets
ENV NODE_ENV=production HOST=0.0.0.0 PORT=10000
EXPOSE 10000
CMD ["node", "server.mjs"]
