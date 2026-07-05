# mobile

## 3.0.0

### Major Changes

- fe46888: Rebrand from chat-app / @chat to Semantask / @semantask.
  - Product name: AgentMesh AI → Semantask
  - npm scope: @chat/_ → @semantask/_
  - Default MongoDB database: chat-app → semantask
  - VPS deploy path example: /opt/chat-app → /opt/semantask

  Breaking for anyone still importing @chat/\* or using the old DB/deploy paths.
  Existing Mongo data in `chat-app` is unchanged; update MONGODB_URI or migrate data.

## 2.1.1

### Patch Changes

- 5a2cba8: - Socket: register message:send handlers; broadcast online status on connect; remove duplicate join/leave handlers
  - Web: connect socket after login/register without reload; stop disconnecting on tab visibility changes
  - Mobile: reconnect on app foreground instead of disconnecting in background
  - Task worker: use @semantask/services package imports so production start resolves modules correctly
  - Root: Next 15.5.18 override, uuid 14, ESLint config baseDirectory for apps/web

## 2.1.0

### Minor Changes

- 8a4de46: Added task management across the stack, including shared task models/types, task APIs and socket events, a real-time task panel in the web app, and an outbox-driven worker for task intelligence and execution.

## 2.0.0

### Major Changes

- 3215a80: Enhanced mobile authentication and chat session management, and standardized monorepo build tooling across shared packages.
  - Added mobile auth support improvements and session flow hardening.
  - Added explicit build scripts/config for shared packages (auth, db, services, redis, types) to emit dist artifacts consistently.
  - Improved repository cleanup scripts with safer artifact cleanup and full-reset options.
  - Updated Turbo build outputs for better Next.js build caching behavior.
