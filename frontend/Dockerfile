FROM node:22-alpine AS build
WORKDIR /app
# EXPO_PUBLIC_* values are inlined into the JS bundle at export time, so they
# must be present here (build args), not at container runtime.
ARG EXPO_PUBLIC_GRAPHQL_URL
ENV EXPO_PUBLIC_GRAPHQL_URL=$EXPO_PUBLIC_GRAPHQL_URL
ARG EXPO_PUBLIC_CODE_SERVER_URL
ENV EXPO_PUBLIC_CODE_SERVER_URL=$EXPO_PUBLIC_CODE_SERVER_URL
RUN npm install -g pnpm@11.0.9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec expo export -p web

FROM node:22-alpine
WORKDIR /app
RUN npm install -g serve
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["serve", "-s", "dist", "-l", "3000"]
