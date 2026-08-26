# arm64-capable (Pi target) — build on the Pi via `docker compose up -d --build`.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY public ./public
COPY seating-chart ./seating-chart
COPY ceremony ./ceremony
COPY welcome-drinks ./welcome-drinks
COPY sunday-brunch ./sunday-brunch

EXPOSE 3000
CMD ["node", "dist/server.js"]
