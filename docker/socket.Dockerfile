FROM node:22-alpine

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.json ./
COPY apps/socket ./apps/socket
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @semantask/types build
RUN pnpm --filter @semantask/socket build

EXPOSE 3001

USER node

CMD ["pnpm", "--filter", "@semantask/socket", "start"]
