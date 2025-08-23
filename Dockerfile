FROM oven/bun:1.1-alpine
WORKDIR /app

# Манифесты + зависимости
COPY package*.json tsconfig.json ./
RUN bun install --frozen-lockfile || bun install

# Код проекта
COPY . .

# По умолчанию покажем help кастомного QR
CMD ["bun","run","customQR/index.ts"]
