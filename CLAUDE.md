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
- Socket errors go to `chatError` / `messageError` / `statusError`.
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

## Verifying changes

Unit tests cover handler logic, but realtime behavior needs the real app: run both
servers and use **two browser profiles** (normal + incognito, different accounts —
two tabs share `localStorage` and would log in as the same user). Watch the UI and
the backend log together. Check the flow from both sides — sender and receiver:

- Send a message → correct order, ticks progress sent → delivered → read.
- Send while the receiver is disconnected, then reconnect → message appears **without** a reload.
- Trigger the failure path (stop MongoDB mid-send) → the UI shows a failed state, not a permanent spinner.

**Ask before committing.** Don't run `git commit` unprompted, even when the work is finished and tested — summarize what would be staged and wait. Commit one logical change at a time so regressions bisect cleanly.

## Current state

The app works end-to-end but is mid-remediation. `REMEDIATION-PLAN.md` in the repo root documents known logic errors and redundancy in phases 0–5 — **read it before touching** `socketHandlers/`, `config/socket.js`, or `contexts/ChatContext.jsx`, since several behaviors there are known-broken and slated to change.

**Phases 0–2 are done** (delivery pipeline restored, failed sends surfaced, reconnect resync, `chatListUpdate` deleted, ack-before-broadcast reconciliation, unread badge). Phase 3 is done but **uncommitted** (typing state now keyed by chatId, `selectChat` fetch race guarded by a sequence ref, `newChat` emitted over the socket on chat creation). All of 0–3 are unit-tested but **not yet verified in the real app**. Phases 4–5 are debt. The plan file carries a per-phase status table.

Two conventions Phase 3 introduced: `config/socket.js` exports `{ initializeSocket, getIO }` — use `getIO()` (null-tolerant) to broadcast from HTTP controllers. And `typingUsers` in `ChatContext` is keyed **`{ [chatId]: { [userId]: {username} } }`**; the handler records every chat and the view filters by `activeChat._id`, because gating in the handler also swallowed the stop event.

That file is scratch and will be deleted once the phases land. It is now in `.gitignore` along with `.vscode/`.

Known-incomplete features: file/image upload (`multer` is installed, no route), group chat admin actions, and message edit/delete.
