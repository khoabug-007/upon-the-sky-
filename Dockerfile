FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
RUN npm prune --omit=dev

EXPOSE 3000

CMD ["node", "server/index.js"]
