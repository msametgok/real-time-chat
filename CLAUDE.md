# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Real-time chat application. Node/Express + Socket.IO + MongoDB + Redis backend; React 19 + Vite + Tailwind frontend. Solo hobby project, actively under development — **not** production and not enterprise-scoped. Prefer small, surgical changes over architectural rewrites.

## Running

```bash
# backend  (port 5000 by default)
cd backend && npm run dev      # nodemon server.js

# frontend (Vite dev server)
cd frontend && npm run dev
```

```bash
cd backend  && npm test    # jest   - socket handlers, injected fake deps
cd frontend && npm test    # vitest - components, jsdom + Testing Library
```

Both take `npm run test:watch`. Tests live in `__tests__/` next to the code they cover.

**Frontend timer tests:** use `vi.useFakeTimers({ shouldAdvanceTime: true })` with
`userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`. Without
`shouldAdvanceTime`, every `await user.type(...)` deadlocks on a microtask that
the frozen clock never flushes.

`backend/.env` holds `MONGO_URI`, `JWT_SECRET`, `ENCRYPTION_KEY`, `REDIS_*`, `CLIENT_URL`. Never commit it or print its values.

## Architecture

### Backend

```
server.js          bootstrap: connectDB -> initializeSocket -> listen
app.js             express app, helmet/cors/morgan, routes, error middleware
config/
  socket.js        Socket.IO init, JWT socket auth, connection bootstrap, handler wiring
  auth.js          HTTP JWT middleware (misnamed - it's middleware, not config)
  db.js redis.js logger.js
controllers/       auth, chat, user - talk to Mongoose/Redis directly (no service layer)
models/            User, Chat, Message
routes/            authRoutes, chatRoutes, userRoutes
socketHandlers/    chatEvents, typingEvents, statusEvents, disconnectEvents
utils/             chatCache (Redis invalidation), encryption (AES-256-CBC)
```

**Socket handler contract.** `config/socket.js` builds a single `deps` object and passes it to each handler module:

```js
const deps = { io, socket, logger, redis, User, Chat, Message, encrypt, decrypt, invalidateChatCache };
initializeChatEventHandlers(deps);   // etc.
```

Each handler file exports **exactly one** arrow function taking that destructured object and registering `socket.on(...)` listeners. Adding a new handler file means adding it to this list. Destructure only what you use — but make sure you destructure everything you *do* use (a missing `redis` in this list was a live bug).

**Rooms.** Two kinds:
- `user-<userId>` — personal fan-out room, also used to count open sockets for presence.
- `<chatId>` — one room per chat. Every user auto-joins **all** their chat rooms on connect (`config/socket.js`), not just the active one. This matters constantly: broadcasting to a chat room already reaches every online participant regardless of what they're viewing, so a second "sidebar" event is almost always redundant.

**Presence lives in Redis, not Mongo.** `userSockets:<id>` (a set) and `userLastSeen:<id>`. The User model has **no** `onlineStatus`/`lastSeen` fields — don't `.select()` them.

**Message content is encrypted at rest** (`utils/encryption.js`, AES-256-CBC). Decrypt on the way out to clients; never log decrypted content.

### Frontend

```
src/
  contexts/AuthContext.jsx   auth state, login/register/logout, cross-tab sync
  contexts/ChatContext.jsx   ~650 lines: ALL chat state + every socket handler
  services/socket.js         SocketService singleton (created at import time)
  services/api.js            axios wrapper; token passed manually per call
  hooks/ components/ pages/
```

`ChatContext.jsx` is the center of gravity — chats, activeChat, messages, presence, typing, and every socket listener. Messages are held as a **flat array for the active chat only** (no per-chat cache), so switching chats always refetches.

**Socket listener indirection.** `services/socket.js` installs raw listeners once and dispatches into a single `eventCallbacks` slot per event name. `_registerListener` **overwrites**, so only one consumer per event is possible. React registers/unregisters these in an effect in `ChatContext`.

## Conventions

- **CommonJS on the backend** (`require`/`module.exports`), **ESM on the frontend** (`import`). Don't mix.
- **One `module.exports` per file.** A nested second one silently shadowed an entire handler here — it registered nothing and threw no error.
- Backend logging via **winston** (`config/logger.js`), not `console.*`.
- Socket acks are **separate emit-back events** (`messageSentAck`, `joinedChat`, `markMessagesAsReadAck`), not Socket.IO callback acks. Follow the existing pattern unless deliberately migrating.
- Socket errors go to `chatError` / `messageError` / `statusError`. All three are consumed in `ChatContext`; `chatError`/`statusError` surface through the `RealtimeNotice` banner. A new error event needs a listener there or it silently vanishes — that was true of all three at some point.
- 4-space indent backend, 4-space JSX frontend. Match the surrounding file.
- No TypeScript — don't introduce it without asking.
- **Socket handlers are tested by injecting a fake `deps` object** — no live Mongo, Redis, or Socket.IO server. See `backend/socketHandlers/__tests__/statusEvents.test.js` for the `buildHarness()` pattern and the `lean()`/`selectLean()` helpers that stand in for Mongoose chaining. Reuse it for new handlers.
- When fixing a bug, add a test that **fails against the old code**. Several bugs here were invisible at runtime (silent no-ops, not crashes), so a test asserting the *observable* behavior is the only real guard.

## Gotchas

These have each caused a real bug — check for them when editing:

1. **`catch` cannot see `const` declared inside `try`.** Several handlers logged `chatId`/`username` from the catch, which threw `ReferenceError` and masked the original error. Declare with `let` **above** the `try`.
2. **`findOneAndUpdate` with a `$ne` guard returns `null`** when the condition already holds. Always null-check before dereferencing — an unguarded `.sender` skipped cache invalidation downstream.
3. **Timers/mutable values in components need `useRef`.** A plain `let` at component scope resets every render, so `clearTimeout` silently no-ops.
4. **Effects depending on `messages` or `chats` re-run on every incoming message.** Anything that emits from such an effect must dedupe (a `useRef(new Set())` of handled IDs) or it fans out per message.
5. **`setState(prev => ...)` updaters do NOT run synchronously.** React defers them to render time, so a value captured inside one is still unset on the next line. To read current state inside a callback, use a ref mirror (`messagesRef.current = messages`) — that also avoids taking `messages` as a dependency.
6. **Anything that replaces `messages` wholesale drops client-only state.** Failed and in-flight sends exist only in React state, so a refetch must re-append them (see `fetchMessages`) or the user's text vanishes.
7. **`socket.to(room)` excludes the sender; `io.to(room)` includes it.** Picking the wrong one causes either a missing update or a double-apply. Also note `socket.to()` does **not** require room membership — always verify the user is a participant before broadcasting on their behalf.
8. **`Message` post-save hook already updates `Chat.latestMessage` and invalidates cache.** Don't invalidate again at the call site.
9. Compare Mongo IDs with `.toString()` consistently — mixing raw ObjectIds and strings in `.includes()` fails silently.
10. **Optimistic bookkeeping must be undone on the error path.** `joinedChatsRef` records a room the moment `joinChat` is emitted. When the server rejected the join and nothing repaired the set, the join effect saw "already joined" forever and that chat went dark for the whole session. Any "have I done X yet" ref needs a matching delete in the failure handler.

## Verifying changes

Unit tests cover handler logic, but realtime behavior needs the real app: run both
servers and use **two browser profiles** (normal + incognito, different accounts —
two tabs share `localStorage` and would log in as the same user). Watch the UI and
the backend log together. Check the flow from both sides — sender and receiver:

- Send a message → correct order, ticks progress sent → delivered → read.
- Send while the receiver is disconnected, then reconnect → message appears **without** a reload.
- Trigger the failure path (stop MongoDB mid-send) → the UI shows a failed state, not a permanent spinner.

Scripted `socket.io-client` probes cover what the browser can't easily reach (rejected joins, auth, races). Two traps, both of which have produced fake failures here: **write the probe outside `backend/`** — nodemon watches that tree and restarts the server underneath a running probe — and **remove the listener when a `waitFor` times out**, or the stale `once` swallows the next assertion's event. Socket auth signs `{ userId }`, not `{ id }`.

**Ask before committing.** Don't run `git commit` unprompted, even when the work is finished and tested — summarize what would be staged and wait. Commit one logical change at a time so regressions bisect cleanly.

## Current state

**The remediation is finished.** All of Phases 0–5 have landed, plus two follow-ups: the `chatError`/`statusError` client gap (`d181602`) and a Mongo server-selection timeout (`e7b0904`). Everything through those two follow-ups is unit-tested *and* verified in the real app — the two-browser pass was run on 2026-07-20.

Since then, the silent mid-session socket loss (known bug 1) has been fixed. It is unit-tested, and a scripted probe confirmed the three `disconnect` reason strings it branches on against a real socket.io client. The **banner itself has not been driven in a browser** — normal use looks healthy, but nobody has watched it appear and clear during an actual outage. To do that: two profiles, stop the backend, watch for the banner, restart, confirm it clears and missed messages arrive without a reload.

`REMEDIATION-PLAN.md` is tracked in the repo root. Its phase-by-phase detail is now history, but two parts stay useful: the **verification recipes** (how to drive the error banner, why network throttling cannot test the `selectChat` race, the two-browser setup traps) and the record of where the plan's own instructions turned out to be **wrong**. Read it before writing a realtime test — several obvious approaches there are documented as producing confident false passes.

Conventions worth knowing, all introduced during the remediation:
- `config/socket.js` exports `{ initializeSocket, getIO }` — use `getIO()` (null-tolerant) to broadcast from HTTP controllers.
- `typingUsers` in `ChatContext` is keyed **`{ [chatId]: { [userId]: {username} } }`**; the handler records every chat and the view filters by `activeChat._id`, because gating in the handler also swallowed the stop event.
- Socket handlers are registered **before** any `await` in the connection bootstrap. Moving them back down re-opens a window where a freshly-connected client's emits hit a socket with no listener and vanish.
- Realtime errors surface through `RealtimeNotice`, not through ChatList's `chatError` state — that one renders *instead of* the sidebar.
- **`unreadCount` is server-supplied on fetch, client-incremented in between.** `getUserChats` attaches it via `attachUnreadCounts` (one aggregate: messages in the chat whose `sender` isn't you and whose `readBy` lacks you); `ChatContext` increments it on `newMessage` and zeroes it on `selectChat`. It was client-only at first, which meant messages received while offline fired no event and showed no badge at all. The count is deliberately **not** stored in the `user:<id>:chats` Redis cache — that key survives 5 minutes and is invalidated on message *create* but never on message *read*, so a cached count would keep badging a chat you had already opened.
- **Two read paths, and they are not interchangeable.** `markMessagesAsRead` takes explicit ids and covers the page `ChatWindow` currently holds — that is what keeps ticks moving for messages arriving while a chat is open. `markChatAsRead` takes only a `chatId` and clears the *entire* chat; `selectChat` emits it on open. Without the second one, unread history older than one page could never be cleared and the badge came back on every reload. It reads `readBy` **before** its update (it needs the ids to broadcast), so it must add the reader in by hand before calling `computeReadByAll` — the other handler re-reads after the write and gets that for free. The deliberate trade: senders receive read receipts for messages the reader never scrolled to.
- **Connection state is owned by two different places, split by timing.** The connect effect handles the *initial* connect and its backoff retry; it is gated on `!hasConnected` and never sees a later failure. Everything *after* that — mid-session drops — is handled by the raw-socket `connect`/`disconnect` listeners in effect 6.6, which live for the whole session. Branch on the disconnect reason: `io client disconnect` is our own teardown and must stay silent, `io server disconnect` does **not** auto-reconnect and has to flip `hasConnected` false to hand control back to the connect effect, and everything else is already inside socket.io's retry loop.

### Known bugs, not yet fixed

Found during verification and deliberately left; not a regression.

1. **The join repair has no retry cap.** `handleChatError` drops the chat id from `joinedChatsRef` so a rejected `joinChat` is re-attempted — correct for a transient failure, but the retry rides on `chats` changing, and `chats` changes on every incoming message. A permanently-denied chat that stayed in the list would produce a steady trickle of doomed joins. Bounded in practice only because the refetch drops the chat. A per-chat backoff or attempt cap would close it.

Known-incomplete features: file/image upload (`multer` is installed, no route), group chat admin actions, and message edit/delete.

`backend/scripts/createChat.js` and `createChatViaApi.js` are intentionally **untracked** dev helpers — `createChat.js` writes straight to Mongo (no `newChat` emit); `createChatViaApi.js` goes through the controller. Don't `git add -A` them in.
