# Builder: compile native deps (canvas) and TypeScript
FROM oven/bun:1.2-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ cairo-dev pango-dev jpeg-dev giflib-dev librsvg-dev

COPY package.json bun.lock ./
COPY plugin-intent-parser/package.json ./plugin-intent-parser/
COPY plugin-rate-checker/package.json ./plugin-rate-checker/
COPY plugin-usdc-handler/package.json ./plugin-usdc-handler/
COPY plugin-payout-router/package.json ./plugin-payout-router/
COPY plugin-notifier/package.json ./plugin-notifier/
COPY sendflow-agent/package.json ./sendflow-agent/

RUN bun install

COPY . .

# Same order as root `bun run build` (workspace dependency order)
RUN bun run --filter @sendflow/plugin-intent-parser build \
  && bun run --filter @sendflow/plugin-usdc-handler build \
  && bun run --filter @sendflow/plugin-payout-router build \
  && bun run --filter @sendflow/plugin-notifier build \
  && bun run --filter @sendflow/plugin-rate-checker build \
  && bun run --filter @sendflow/sendflow-agent build

# Runtime: Bun + canvas shared libraries
FROM oven/bun:1.2-alpine
WORKDIR /app

RUN apk add --no-cache cairo pango jpeg giflib librsvg

COPY --from=builder /app /app

EXPOSE 3000
WORKDIR /app/sendflow-agent
CMD ["bun", "run", "src/index.ts"]
