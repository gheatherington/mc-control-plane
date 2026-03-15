FROM node:20-alpine AS build

WORKDIR /app

RUN apk add --no-cache bash docker-cli

COPY package*.json ./
RUN npm ci

COPY tsconfig.server.json ./
COPY esbuild.client.mjs ./
COPY public ./public
COPY src ./src

RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache bash docker-cli

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/server/index.js"]
