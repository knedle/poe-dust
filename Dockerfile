FROM node:22-alpine
WORKDIR /app
COPY server.js package.json ./
COPY lib ./lib
COPY public ./public
COPY scripts ./scripts
CMD ["node", "server.js"]
