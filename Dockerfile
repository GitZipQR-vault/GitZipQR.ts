FROM oven/bun:1.1-alpine
WORKDIR /app

# install dependencies
COPY package*.json tsconfig.json ./
RUN bun install --frozen-lockfile || bun install

# project source
COPY . .

ENTRYPOINT ["bun","run"]
CMD ["encode"]
