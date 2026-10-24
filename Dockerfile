# Pensive webhook server — Node 24 runs the .ts sources directly (type stripping).
FROM node:24-slim

# git is required (PR checkouts); ripgrep improves context retrieval when present.
RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY rulepacks ./rulepacks

# Cloned repos + dedupe state live under /app/.pensive (a Fly volume mounts here).
EXPOSE 3000
CMD ["node", "src/server/index.ts"]
