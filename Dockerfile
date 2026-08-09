FROM node:22-alpine
WORKDIR /app
COPY server.js index.html package.json ./
COPY lib ./lib
CMD ["node", "server.js"]
