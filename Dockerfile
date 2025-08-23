FROM node:20-alpine
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY . .
CMD ["npm", "run", "encode"]
