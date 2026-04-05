FROM oven/bun:1.2-alpine
WORKDIR /app
COPY . .
RUN bun install
RUN cd plugin-intent-parser && bun run build \
  && cd ../plugin-rate-checker && bun run build \
  && cd ../plugin-usdc-handler && bun run build \
  && cd ../plugin-payout-router && bun run build \
  && cd ../plugin-notifier && bun run build \
  && cd ../sendflow-agent && bun run build
EXPOSE 3000
WORKDIR /app/sendflow-agent
CMD ["bun", "run", "src/index.ts"]
