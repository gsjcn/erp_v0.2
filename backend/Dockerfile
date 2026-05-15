FROM node:20-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/package.json
COPY backend/scripts ./backend/scripts
COPY database/prisma ./database/prisma
RUN npm ci --workspace backend
RUN npm --workspace backend run db:generate

COPY backend ./backend
RUN npm --workspace backend run build

FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/node_modules ./backend/node_modules
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/scripts ./backend/scripts
COPY --from=build /app/backend/src ./backend/src
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/database/prisma ./database/prisma
COPY outputs/component-order-template ./outputs/component-order-template

WORKDIR /app/backend

EXPOSE 3000

CMD ["node", "dist/main.js"]
