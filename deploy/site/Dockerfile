# Orbix Core site + Center SPA on Railway.
# Build context is the REPO ROOT (service rootDirectory), hence the deploy/site/ prefixes.
FROM node:20-alpine
WORKDIR /app
COPY deploy/site/package.json ./
RUN npm install --omit=dev
COPY deploy/site/ .
EXPOSE 8080
CMD ["node", "server.js"]
