FROM node:22-slim
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @semantask/types build
RUN pnpm --filter @semantask/db build
RUN pnpm --filter @semantask/services build
RUN pnpm --filter @semantask/web build
EXPOSE 3000
CMD ["pnpm", "--filter", "@semantask/web", "start"]
