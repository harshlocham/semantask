FROM node:22-alpine
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.json ./
COPY apps/task-worker ./apps/task-worker
COPY packages ./packages
RUN pnpm install --frozen-lockfile
RUN pnpm run clean:artifacts
RUN pnpm --filter @semantask/types build
RUN pnpm --filter @semantask/db build
RUN pnpm --filter @semantask/services build
RUN pnpm --filter @semantask/task-worker build

EXPOSE 4444
CMD ["pnpm", "--filter", "@semantask/task-worker", "start"]
