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
- Socket acks are **separate emit-back events** (`messageSentAck`, `joinedChat`), not Socket.IO callback acks. Follow the existing pattern unless deliberately migrating. Only add one when something will actually listen: `markMessagesAsReadAck` was emitted by three handlers and consumed by nobody, which made the read path look acknowledged when it wasn't.
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
10. **`backdrop-blur` creates a stacking context, which traps `z-index` inside it.** `ChatWindowHeader` has `backdrop-blur-sm`; any `backdrop-filter` other than `none` makes the element a stacking context, so its absolutely-positioned dropdown could not rise above `MessageList` (a later sibling) no matter how high its own `z-`. The options menu, and worse its red confirm button, rendered *behind* the message bubbles on a long chat and were only clickable through the gaps. The fix is `relative z-30` on the **header itself** — raising the child's z-index does nothing. Same trap applies to `filter`, `transform`, `opacity < 1`, `will-change` and `contain`.
11. **Optimistic bookkeeping must be undone on the error path.** `joinedChatsRef` records a room the moment `joinChat` is emitted. When the server rejected the join and nothing repaired the set, the join effect saw "already joined" forever and that chat went dark for the whole session. Any "have I done X yet" ref needs a matching delete in the failure handler.
12. **A blocked CORS response is indistinguishable from a dead backend on the client.** axios surfaces both as a bare `Network Error` with no status, because there is no response to read — so "the site can't reach the server" is *not* evidence the server is down. On 2026-07-29 the deployed backend was entirely healthy (Mongo, Redis, demo mode all fine) but `CLIENT_URL` was unset on the host, so it advertised `Access-Control-Allow-Origin: http://localhost:5173` to every visitor and only the static frontend worked. Diagnose from outside the browser: `curl` enforces no CORS, so `curl -i -H "Origin: <frontend>" <backend>/health` returns 200 either way — **read the `access-control-allow-origin` header it echoes back**, not the status code. Both origins now come from `config/clientOrigin.js`, which logs a loud error when a `NODE_ENV=production` boot falls back, and strips a trailing slash (an `Origin` header never has one, so `https://x/` matches nothing and fails just as silently).

## Verifying changes

Unit tests cover handler logic, but realtime behavior needs the real app: run both
servers and use **two browser profiles** (normal + incognito, different accounts —
two tabs share `localStorage` and would log in as the same user). Watch the UI and
the backend log together. Check the flow from both sides — sender and receiver:

- Send a message → correct order, ticks progress sent → delivered → read.
- Send while the receiver is disconnected, then reconnect → message appears **without** a reload.
- Trigger the failure path (stop MongoDB mid-send) → the UI shows a failed state, not a permanent spinner.

**Testing a disconnect with DevTools "Offline" works, but be patient and check the log.** It blocks HTTP but sends no WebSocket close frame, so the drop is only detected by heartbeat — every such disconnect shows `Reason: ping timeout` in the backend log, never `transport close`. With `pingInterval: 10000, pingTimeout: 5000` that is ~15s; on socket.io's defaults it was ~45s. Judging the banner "broken" ten seconds in is wrong, and it wasted a round trip here. Two further traps that produced a confident false pass the same day: the offline tab still shows a **stale page** until you reload it, and running **both profiles as the same account** makes a message look delivered to the offline user when it was only ever echoed to the other tab of that same user. If you want an instant, unambiguous disconnect, stop the backend instead — that sends a real close frame and surfaces in under a second.

Scripted `socket.io-client` probes cover what the browser can't easily reach (rejected joins, auth, races). Two traps, both of which have produced fake failures here: **write the probe outside `backend/`** — nodemon watches that tree and restarts the server underneath a running probe — and **remove the listener when a `waitFor` times out**, or the stale `once` swallows the next assertion's event. Socket auth signs `{ userId }`, not `{ id }`.

**Ask before committing. Never push.** Don't run `git commit` unprompted, even when the work is finished and tested — summarize what would be staged and wait. Commit one logical change at a time so regressions bisect cleanly. `git push` is the user's own step: don't run it even when asked to commit, and don't treat approval of a commit as approval to publish. Say the branch is ready and stop.

## Current state

**Bug-fixing is done; the project is moving to feature work.** The remediation (Phases 0–5) landed earlier, and a follow-up pass on 2026-07-20 closed the realtime gaps it left behind: the silent mid-session socket loss, server-side unread counts, whole-chat read clearing, the dropped-emit badge repair, a heartbeat that detects a silent connection loss in ~15s instead of ~45s, and a dead-code sweep. All of it is unit-tested; the unread work was additionally verified against the real database, and the disconnect reason strings against a real socket.io client.

**Phase 1 is done: everything the backend already had is now reachable from the UI.** Starting a chat (`NewChatModal`, from the `+ New chat` button in `ChatList`), removing one (menu in `ChatWindowHeader`), and viewing/editing your profile (`ProfileModal`, from the user card's Profile item). The `createChat.js` / `createChatViaApi.js` dev helpers existed only because chat creation had no button; they were deleted on 2026-07-20.

`GET /api/users/:userId/profile` and `GET /api/chat/:chatId` (details) still have no client method — neither is needed yet, but check before building. Note the HTTP mount is `/api/chat`, **singular**, while user routes are `/api/users`.

Profile avatars are **URLs**, not uploads; `updateCurrentUserProfile` validates them with `isURL`. Check this list before building anything: the server side may already be done.

File & image upload landed on 2026-07-24 (see the notes under the feature table). Avatars could now reuse the same storage, but currently still expect a URL.

`REMEDIATION-PLAN.md` is tracked in the repo root. Its phase-by-phase detail is now history, but two parts stay useful: the **verification recipes** (how to drive the error banner, why network throttling cannot test the `selectChat` race, the two-browser setup traps) and the record of where the plan's own instructions turned out to be **wrong**. Read it before writing a realtime test — several obvious approaches there are documented as producing confident false passes.

Conventions worth knowing, introduced during the remediation and the 2026-07-20 pass:
- `config/socket.js` exports `{ initializeSocket, getIO }` — use `getIO()` (null-tolerant) to broadcast from HTTP controllers.
- `typingUsers` in `ChatContext` is keyed **`{ [chatId]: { [userId]: {username} } }`**; the handler records every chat and the view filters by `activeChat._id`, because gating in the handler also swallowed the stop event.
- Socket handlers are registered **before** any `await` in the connection bootstrap. Moving them back down re-opens a window where a freshly-connected client's emits hit a socket with no listener and vanish.
- Realtime errors surface through `RealtimeNotice`, not through ChatList's `chatError` state — that one renders *instead of* the sidebar.
- **`unreadCount` is server-supplied on fetch, client-incremented in between.** `getUserChats` attaches it via `attachUnreadCounts` (one aggregate: messages in the chat whose `sender` isn't you and whose `readBy` lacks you); `ChatContext` increments it on `newMessage` and zeroes it on `selectChat`. It was client-only at first, which meant messages received while offline fired no event and showed no badge at all. The count is deliberately **not** stored in the `user:<id>:chats` Redis cache — that key survives 5 minutes and is invalidated on message *create* but never on message *read*, so a cached count would keep badging a chat you had already opened.
- **Two read paths, and they are not interchangeable.** `markMessagesAsRead` takes explicit ids and covers the page `ChatWindow` currently holds — that is what keeps ticks moving for messages arriving while a chat is open. `markChatAsRead` takes only a `chatId` and clears the *entire* chat; `selectChat` emits it on open. Without the second one, unread history older than one page could never be cleared and the badge came back on every reload. It reads `readBy` **before** its update because it needs the ids to broadcast, but it decides read-by-all from a **second read taken after the write** — same as the other handler. It used to splice the reader into the pre-update snapshot instead, which is correct for one reader and silently wrong for two: when two participants open a group chat in the same moment, each snapshot predates the other's write, so both compute `false`, *neither* broadcasts, and the sender's ticks stay grey forever with nothing scheduled to repair them. Re-reading means the last writer always sees the complete set. Found on 2026-07-28 by two demo bots reading a group at the same instant. The deliberate trade: senders receive read receipts for messages the reader never scrolled to. `markChatAsRead` **returns whether the emit went out** (like `sendMessage`, unlike the other emitter shortcuts) because `selectChat` zeroes the badge optimistically — and since the count now comes from the server, clearing it after a dropped emit only hides the badge until the next `fetchChats` brings it back. The repair is the re-emit in the reconnect effect — there is no success ack on either read handler, so that return value is the only signal a dropped emit gives you.
- **A soft-deleted chat comes back through `chatRestored`, not `newMessage`.** Deleting leaves the chat's socket room, so the `newMessage` broadcast cannot reach that user — their sidebar would stay empty until a manual reload. `sendMessage` therefore reads `deletedFor` **before** saving (the `Message` post-save hook clears it, so reading after always yields an empty list) and emits `chatRestored { chatId }` to each hidden user's **personal** `user-<id>` room, which they never leave. The client refetches rather than rebuilding from the payload — that gets a per-viewer formatted chat and the server-computed unread count, so it reappears already carrying its badge. Note `findChatForParticipant` selects only `participants` by default; pass `'participants deletedFor'` or the field is silently absent.
- **Deleting a 1-on-1 chat is a per-user soft delete**, via `Chat.deletedFor`. It used to remove the chat *and every message* for **both** participants, so one person tidying their sidebar destroyed the other's history. `getUserChats` filters on `deletedFor: { $ne: currentUserId }` — which also matches documents that predate the field, so no migration was needed. The `Message` post-save hook clears `deletedFor`, so a new message un-hides the chat for everyone; once every participant has hidden it, `deleteOrLeaveChat` removes it for real. Leaving a **group** is still a genuine removal from `participants`. Note the ids in `deletedFor` are compared with `.toString()` throughout (gotcha 9): `currentUserId` arrives as a string off the JWT, so pushing it and then calling `.equals()` on the result throws.
- **`selectChat(chatId, chatHint)` takes an optional chat object.** Anything that creates a chat and then opens it must pass the created chat: `fetchChats()` has only *queued* its `setChats` by the next line, so a lookup by id misses the chat that was just made and opens `null` (gotcha 5). Lookups otherwise go through `chatsRef`, not the `chats` closure. The chat-creation helpers also deliberately **throw instead of setting `chatError`** — `ChatList` renders that state *instead of* the sidebar, so a failed create would blank the chat list; `NewChatModal` catches and shows it inline.
- **Connection state is owned by two different places, split by timing.** The connect effect handles the *initial* connect and its backoff retry; it is gated on `!hasConnected` and never sees a later failure. Everything *after* that — mid-session drops — is handled by the raw-socket `connect`/`disconnect` listeners in effect 6.6, which live for the whole session. Branch on the disconnect reason: `io client disconnect` is our own teardown and must stay silent, `io server disconnect` does **not** auto-reconnect and has to flip `hasConnected` false to hand control back to the connect effect, and everything else is already inside socket.io's retry loop.

### Demo mode (`backend/demo/`, added 2026-07-28)

Powers the public demo linked from the portfolio. **Entirely inert unless `DEMO_MODE=true`** — the frontend button is separately gated on `VITE_DEMO_MODE`, and both must be set or the button appears and 404s.

- **Five shared companions plus a throwaway guest per visitor.** `POST /api/auth/demo` provisions a guest, seeds four chats, and answers with the same envelope as login. Per-visitor rather than one shared account on purpose: two simultaneous visitors would otherwise move each other's tick states, which is the entire thing being demonstrated.
- **The tick states are real, not staged.** Offline User has no socket, so `sendMessage`'s presence check never marks delivered — one tick. Online User 1 holds a socket and ignores its inbox — two grey. Online User 2 reads — two red. The bots in `demo/bots.js` are ordinary `socket.io-client`s, so every state comes out of the normal handlers.
- **Never give the offline companion a client.** The connect-time replay in `config/socket.js` marks its whole backlog delivered the moment it connects, and that is not undoable — every visitor's Offline User chat jumps to two ticks, past and future.
- **Read timing is per-companion (`groupReadDelayMs`) and per-chat.** Online User 1 never reads a one-on-one but reads a group after 10s, which is what lets a visitor watch grey turn red. The seeded group intro promises that number out loud — change one, change the other.
- **Bots must handle `newChat` by emitting `joinChat`.** `emitNewChat` only fans out to personal rooms and never `socketsJoin`s, so clients join for themselves. Without it a group the visitor creates looks dead: the bots are participants in Mongo and presence still gives two ticks, but they are not in the room and never read or reply. Seeded chats take the other route — `joinCompanionSockets` in `demo/seed.js`, since the seed writes to Mongo directly and emits nothing.
- **Seeded messages are saved with `save({ timestamps: false })`** so they can be back-dated. Without it Mongoose stamps them all in one millisecond and in-chat order is down to how the sort breaks ties. Note `createdAt` is **immutable** under `timestamps: true` — an `updateOne` trying to change it reports success and silently does nothing; go through the raw collection.
- **Guests are disposed of twice over** (`demo/cleanup.js`): logout deletes immediately, and a sweeper removes anything older than 24h at startup and hourly. The sweeper is the main path — most visitors close the tab, which fires no request, and `sendBeacon` cannot set an Authorization header. Both paths re-check the **`guest-` email prefix**, because companions also carry `isDemo: true` and deleting one would cascade into every live visitor's chats.

### Known bugs, not yet fixed

None currently. The last one — the join repair having no retry cap — was closed on 2026-07-24: `joinFailuresRef` in `ChatContext` counts rejected joins per chat and the join effect stops after `MAX_JOIN_ATTEMPTS` (3). The counts reset on reconnect and are swept when a chat leaves the list (a `chatRestored` chat keeps its id, so the sweep is what lets it join again). Note the counter also increments on a rejected `leaveChat` — `chatError` doesn't say which emit failed — which is accepted imprecision.

Known-incomplete features, roughly in order of how much is already done for you:

| Feature | Backend | Frontend |
|---|---|---|
| ~~Start a chat / search users~~ | done | **done** — `NewChatModal` |
| ~~Delete or leave a chat~~ | done, now a **soft delete** | **done** — menu in `ChatWindowHeader` |
| ~~View / edit own profile~~ | done | **done** — `ProfileModal` |
| ~~File & image upload~~ | **done** — `POST /api/chat/:chatId/upload` | **done** — attach button, `sendAttachment`, bubble rendering |
| ~~Message edit / delete~~ | **done** — `editMessage` / `deleteMessageForMe` / `deleteMessageForEveryone` socket events | **done** — bubble hover menu, inline edit, tombstone |
| ~~Group admin actions~~ | **done** — rename/avatar, add members, remove member (HTTP, admin-gated) | **done** — `GroupInfoModal` from the header menu |

Group admin notes (added 2026-07-24):
- Three HTTP endpoints in `chatController.js` (`PUT /:chatId/group`, `POST /:chatId/participants`, `DELETE /:chatId/participants/:userId`), all gated on `chat.groupAdmin`. Missing and forbidden chats both answer 404, like everywhere else.
- **Realtime is a payload-free `groupUpdated { chatId }` to the chat room; clients refetch.** The refetch returns per-viewer formatted chats, so the event cannot go stale or leak another viewer's formatting. `handleGroupUpdated` refreshes `activeChat` from the **return value** of `fetchChats` — its `setChats` is still queued at that point, so `chatsRef` is stale (gotcha 5); this is why `fetchChats` returns the normalized list.
- **Added members get their sockets joined to the room server-side** (`socketsJoin`) — their client can't join a room it doesn't know about yet — plus a per-viewer `newChat`, which is what puts the group in their sidebar.
- **Removed members: `socketsLeave` runs BEFORE the room-wide `groupUpdated`**, or the broadcast would still reach them; they're told via `removedFromGroup` on the personal room they never leave. The client mirrors delete-chat cleanup but must NOT emit `leaveChat` — no longer being a participant, it would only bounce back as a `chatError`.
- The admin can't remove themselves (leave instead — `deleteOrLeaveChat` reassigns the admin role), and a group can't shrink below 2 members.

Message edit/delete notes (added 2026-07-24):
- **All three handlers update with `updateOne`/`findOneAndUpdate`, never `save()`** — the `Message` post-save hook would overwrite `Chat.latestMessage` with an old message and un-hide soft-deleted chats. The flip side: the hook's cache invalidation doesn't run either, so edit and delete-for-everyone call `invalidateChatCache` themselves (it's back in the socket `deps` for exactly this).
- **Edit**: own text messages only, within `EDIT_WINDOW_MS` (15 min, `chatEvents.js`) — enforced server-side; `MessageBubble` mirrors the constant only to hide the option. Broadcast is `io.to(chatId)` (`messageEdited`) — the sender applies the same event, there is no optimistic apply on this path. `editedAt`'s presence is the "edited" label.
- **Delete for me**: any message; `Message.deletedFor` per-user hide (filtered in `getChatMessages`, `$ne` matches pre-field docs like Chat's). `readBy` is added in the same update or an unread hidden message would badge the chat forever (deliberately no read-receipt broadcast). Emitted to the **personal** room (`messageDeletedForMe`) so the user's other tabs follow; the `$ne` guard makes a repeat a silent no-op (gotcha 2 — null is success here).
- **Delete for everyone**: sender only, any age. Sets `isDeletedForEveryone` and `$unset`s content + file fields — the tombstone has no payload — then removes the uploaded file from disk (`removeUploadedFile`, best-effort) and broadcasts `messageDeletedForEveryone` to the room. Clients render "This message was deleted".
- No menu on `sending`/`failed` bubbles: their ids are client-only temp ids the server has never heard of.

File upload notes (added 2026-07-24), for whoever touches attachments next:
- **The upload is HTTP, the message is still the socket.** Picking a file opens `AttachmentPreview` (WhatsApp-style: shows the file, takes an optional caption, cancellable — nothing is uploaded until Send). `sendAttachment(chatId, file, caption)` then posts the file (`uploadController.js`, multer config in `utils/uploads.js`, 10 MB cap) and emits the regular `sendMessage` event with the returned metadata — the `chatEvents` handler had accepted attachment fields all along. Acks, ticks, and retry ride the existing path; retry re-uploads only if the bubble has no `fileUrl` yet.
- **The server decides `messageType`** from the real mimetype (`messageTypeForMime`); never trust or send a client-chosen type. SVG is deliberately `file`, not `image` — it's the one image format that can carry scripts.
- **Files are served from `/uploads` (outside `/api`, so image loads don't eat the rate limit)** with two header overrides in `app.js`: helmet's default `Cross-Origin-Resource-Policy: same-origin` would block the Vite origin from embedding images entirely, and anything not on the inline-extension whitelist gets `Content-Disposition: attachment` so an uploaded HTML/SVG can't execute in the backend's origin. Names on disk are random hex; the user's filename lives only in `fileName` (decoded latin1→utf8, or Turkish names arrive as mojibake).
- **`fileUrl` is stored relative** (`/uploads/…`); the client resolves it via `api.resolveFileUrl`. Captions (`content` on attachment messages) are encrypted like any text; `fileUrl` is not.
- The optimistic bubble carries two client-only fields: the `File` itself (for retry) and `localPreviewUrl` (blob URL for images, revoked on ack). Uploads land in `backend/uploads/`, which is gitignored.

Two socket-layer notes for whoever builds these. A new handler file must be added to the `deps` wiring list in `config/socket.js` or it registers nothing. And `services/socket.js` dispatches through a **single callback slot per event** (`_registerListener` overwrites), so a second consumer of an existing event silently replaces the first — add a new event name rather than sharing one.

`backend/scripts/backfillChatPairKey.js` is a tracked one-shot migration run from the shell (`node scripts/backfillChatPairKey.js --apply`). Nothing imports it — that is expected, don't "clean it up".
