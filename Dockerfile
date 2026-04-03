FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install -g bun
RUN bun install
RUN bun run build
EXPOSE 3000
CMD ["bun", "run", "sendflow-agent/src/index.ts"]
