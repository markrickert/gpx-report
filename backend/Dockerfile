FROM node:22-alpine AS build

WORKDIR /app
RUN npm install -g pnpm@11.0.9

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-alpine

WORKDIR /app
RUN npm install -g pnpm@11.0.9

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=build /app/dist ./dist

EXPOSE 4000

CMD ["node", "dist/index.js"]
