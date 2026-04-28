FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
# RUN npm run build  <-- НЕ НУЖНО
CMD ["npx", "tsx", "src/bot/index.ts"]