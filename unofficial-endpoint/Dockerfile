FROM node:20-alpine

WORKDIR /app

COPY .npmrc package*.json ./
RUN npm install --omit=dev

COPY server.js ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
