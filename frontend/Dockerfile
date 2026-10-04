FROM node:22-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.0.9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec expo export -p web

# Pinned: Caddy 2.11 answers 499 to a proxied request when the client
# half-closes the connection, which the Pangolin tunnel in front of the live
# site does, so every /graphql and /api call failed.
FROM caddy:2.10-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
EXPOSE 3000
