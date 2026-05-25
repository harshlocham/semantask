# Mobile Chat Implementation Roadmap

## Goal
Ship a production-ready iOS + Android chat client powered by existing API and Socket services.

## Current Baseline
- Expo app boots from `index.ts` and `App.tsx`.
- Auth/session primitives exist in `src/lib/auth` and `src/store/authStore.ts`.
- API client and socket client skeletons exist.

## Sprint 1 - Foundation and Auth (2-3 days)
### Deliverables
- Stable app shell and navigation.
- Login + logout + session restore.
- Token refresh and auth error UX.

### Tasks
1. Add navigation stack and auth gate.
- Create `src/navigation/RootNavigator.tsx`.
- Create `src/navigation/AuthStack.tsx`.
- Create `src/navigation/AppTabs.tsx`.

2. Split current UI out of `App.tsx` into screens.
- Create `src/screens/auth/LoginScreen.tsx`.
- Create `src/screens/home/HomeScreen.tsx`.
- Keep `App.tsx` as root provider + navigator bootstrap only.

3. Harden auth service and store.
- Update `src/lib/auth/authService.ts` to normalize backend errors.
- Update `src/store/authStore.ts` for explicit `isLoading` and `isHydrated` state.
- Add `src/types/errors.ts` for API/auth error models.

4. Finalize env safety.
- Keep strict checks in `src/config/env.ts`.
- Add startup guard component `src/components/common/EnvGuard.tsx`.

### Validation Checklist
- Fresh install -> login works.
- App restart keeps session.
- Bad credentials show user-friendly message.
- Expired access token refreshes once and retries request.

## Sprint 2 - Conversations + Thread Read (2-3 days)
### Deliverables
- Conversation list screen.
- Thread screen with message history.

### Tasks
1. Conversation API and store.
- Create `src/lib/api/conversationsApi.ts`.
- Create `src/store/conversationStore.ts`.
- Create `src/types/conversation.ts`.

2. Message history API and store.
- Create `src/lib/api/messagesApi.ts`.
- Create `src/store/messageStore.ts`.
- Create `src/types/message.ts`.

3. UI screens and core components.
- Create `src/screens/chat/ConversationListScreen.tsx`.
- Create `src/screens/chat/ChatThreadScreen.tsx`.
- Create `src/components/chat/ConversationItem.tsx`.
- Create `src/components/chat/MessageBubble.tsx`.

### Validation Checklist
- Conversation list loads and paginates.
- Opening thread loads messages without crashes.
- Pull-to-refresh works on list and thread.

## Sprint 3 - Send + Realtime Socket (3-4 days)
### Deliverables
- Send message flow.
- Realtime incoming events.
- Optimistic UI with reconciliation.

### Tasks
1. Outgoing message flow.
- Add create/send in `src/lib/api/messagesApi.ts`.
- Add optimistic state in `src/store/messageStore.ts`.
- Add composer `src/components/chat/MessageComposer.tsx`.

2. Socket event integration.
- Extend `src/lib/socket/socketClient.ts` with room join/leave helpers.
- Create `src/lib/socket/socketEvents.ts`.
- Create `src/hooks/useChatSocket.ts`.

3. Event handling.
- Handle new message, edit, delete, reaction, typing, delivered, seen.
- Add dedupe by `messageId` and temporary client IDs.

### Validation Checklist
- Two devices receive messages in near real-time.
- Optimistic message transitions to server-confirmed.
- Reconnect restores stream after temporary network loss.

## Sprint 4 - Delivery, Seen, Typing, Presence (2-3 days)
### Deliverables
- Full read-state UX and presence indicators.

### Tasks
1. Delivery/seen/presence stores.
- Create `src/store/presenceStore.ts`.
- Extend `src/store/messageStore.ts` for per-message status changes.

2. UI indicators.
- Create `src/components/chat/TypingIndicator.tsx`.
- Create `src/components/chat/MessageStatus.tsx`.
- Create `src/components/common/PresenceDot.tsx`.

3. Wire APIs/events for status updates.
- Extend `src/lib/api/messagesApi.ts` for delivered/seen endpoints.
- Extend `src/lib/socket/socketEvents.ts` payload typing.

### Validation Checklist
- Typing appears/disappears correctly.
- Seen and delivered states are consistent after reconnect.
- Presence updates are stable and not noisy.

## Sprint 5 - Offline, Queue, and Recovery (3-4 days)
### Deliverables
- Offline-safe messaging and sync.

### Tasks
1. Persistence and queue.
- Add local persistence (choose one): MMKV or AsyncStorage.
- Create `src/store/offlineQueueStore.ts`.
- Create `src/lib/utils/retry.ts`.

2. Network-awareness hooks.
- Create `src/hooks/useNetworkStatus.ts`.
- Create `src/hooks/useOfflineSync.ts`.

3. Recovery behavior.
- Queue unsent messages and replay on reconnect.
- Mark failed messages and allow manual retry.

### Validation Checklist
- Send while offline queues correctly.
- Reconnect flushes queue in order.
- App kill/reopen preserves pending state.

## Sprint 6 - Attachments, Notifications, and Polish (4-5 days)
### Deliverables
- Image/file attachments.
- Push notifications and deep links.
- UX and performance polish.

### Tasks
1. Attachments.
- Create `src/lib/api/uploadApi.ts` using existing image auth route.
- Create `src/components/chat/AttachmentPicker.tsx`.
- Create `src/components/chat/AttachmentPreview.tsx`.

2. Notifications.
- Add Expo Notifications and device token registration endpoint usage.
- Deep-link to thread screen from notification taps.

3. Quality/perf.
- Virtualize long lists.
- Add image caching strategy.
- Reduce unnecessary rerenders with selector-based store usage.

### Validation Checklist
- Attachment upload works on iOS and Android.
- Push opens the exact thread.
- Scrolling and typing remain smooth in long chats.

## Sprint 7 - Hardening and Release (3-4 days)
### Deliverables
- CI checks, testing, and store-ready build.

### Tasks
1. Tests.
- Unit tests for auth/token/api retry logic.
- Integration tests for login/refresh/logout/session restore.
- Socket reconnect and dedupe behavior tests.

2. Release config.
- App identifiers, icons, splash, permissions.
- Build profiles for dev/staging/prod.
- Crash reporting and analytics.

3. Documentation.
- Create `apps/mobile/README.md` with setup and runbook.
- Add operational checklist for token expiry and socket outages.

### Definition of Done
- Auth works end-to-end with refresh recovery.
- Conversations and thread are fully functional.
- Realtime send/receive/edit/delete/reaction/typing/delivery/seen all work.
- Offline queue and reconnect are reliable.
- iOS and Android builds pass smoke tests.

## Immediate Next 5 Tasks (Start Here)
1. Add navigation package and create `src/navigation/RootNavigator.tsx`.
2. Move login UI from `App.tsx` into `src/screens/auth/LoginScreen.tsx`.
3. Build `src/lib/api/conversationsApi.ts` + `src/store/conversationStore.ts`.
4. Build `src/screens/chat/ConversationListScreen.tsx` and link from auth success flow.
5. Build `src/screens/chat/ChatThreadScreen.tsx` with read-only message history.
