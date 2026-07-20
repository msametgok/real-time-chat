# Real-Time Chat — Redundancy & Logic-Error Remediation

## Context

The app works end-to-end today, but a full audit of the ~3,300 LOC (backend Express/Mongoose/Socket.IO/Redis + React 19 frontend) surfaced a set of **silent** failures — code that looks correct, never throws visibly, and quietly does nothing or the wrong thing. The most severe is a nested `module.exports` that unregisters an entire socket handler; four client call sites have been emitting into the void.

Alongside these are systematic duplications: the same delivery-status computation copy-pasted 4×, the same participant check written 6× in 3 different idioms with 3 different error shapes, and message decryption duplicated 3× with 3 *different* failure fallbacks.

Goal: fix the silent breakage first, then collapse the duplication — in that order, so we don't canonicalize a buggy block into a shared helper.

**Decisions confirmed by the user:** delete `chatListUpdate` entirely · render `unreadCount` as a client-side badge · reconcile by reordering ack-before-broadcast · execute all phases.

## Status

| Phase | State | Commit |
|---|---|---|
| 0 — Restore the delivery pipeline | **DONE** | `d145197` (backend) + `fafbdd9` (client dedupe) |
| 1 — Stop losing messages / swallowing errors | **DONE** | `d145197` (1a) + `fafbdd9` (1b/1c/1d) |
| 2 — Delete `chatListUpdate`, fix reconciliation | **DONE** | `caa2896` |
| 3 — Remaining correctness | **DONE** | `57dee7e` (typing) + `d951022` (race) + `844ced6` (newChat) + `022e7af` (multi-tab) |
| 4 — Shared helpers | not started | — |
| 5 — Cleanup | not started | — |

A test suite now exists (`fdce6b0`) — jest on the backend, vitest on the frontend.
99 tests green as of `022e7af`. The "no test suite exists" note under Verification
below is obsolete; unit tests cover handler logic, but the two-browser checks in
that table are still the only way to verify realtime behavior.

**Phases 0–2 have not yet been verified in the real app** — only by unit test.
The ack-before-broadcast ordering and the unread badge in particular want a
two-profile pass.

**Phase 3 is half-verified.** The backend half was driven against the live stack
with scripted Socket.IO clients (typing wire format + Redis key naming, `newChat`
delivery to recipients and to the creator's other sessions, and a new chat being
immediately usable once the client joins the room — with a negative control
confirming that join is load-bearing). The two client-side behaviors — the typing
indicator on chat switch, and the `selectChat` race — are still unit-test-only.
The race needs network throttling to hit at all.

---

## Phase 0 — Restore the delivery pipeline — **DONE** (`d145197`, `fafbdd9`)

`backend/socketHandlers/statusEvents.js:96` opens a **second `module.exports = ...` inside the body of the first** (which doesn't close until the stray `};` at :140). `config/socket.js:143` captured the outer function at require time, so the reassignment is invisible and **`messageDeliveredToClient` never registers**. Client emits at `ChatContext.jsx:245,426,562,575` are all dropped.

- Delete the nested `module.exports` at `:96` and the stray `};` at `:140`; move the handler inside the first body (after `:90`).
- Add `redis` to the outer param list at `:9` — it's passed by `config/socket.js:140` but never destructured, so `:109` would throw `ReferenceError` the instant the handler starts working.
- **Reorder the dedupe guard:** `SET NX` (`:109`) currently runs *after* the `findOneAndUpdate` (`:101`), so duplicates hit Mongo before being discarded. Swap them; return early if `!alreadyHandled`.

> **Coupling:** once this works, `ChatContext.jsx` effects 7 (`:552-565`) and 8 (`:568-578`) fire a burst — effect 8 depends on `messages`, which changes on every incoming message, so it re-scans and re-emits the whole array each time. Fix in the same commit: track acked IDs in a `useRef(new Set())` and only emit for new ones.

---

## Phase 1 — Stop losing messages and swallowing errors — **DONE** (`d145197`, `fafbdd9`)

**1a — Six catch blocks throw `ReferenceError`.** `chatEvents.js:32,59,180`, `typingEvents.js:33,63`, `statusEvents.js:87` reference `chatId`/`username` that are `const`-declared *inside* the `try`. The catch is a sibling scope, so it throws before reaching `socket.emit('messageError')` — the original error is masked and the client is never told. Hoist to `let chatId; let username;` above each `try`.

**1b — The client has no error listener.** `messageError` is wired in `services/socket.js:163` but `ChatContext` never registers it (see the handler list at `:457-463`), and the payload carries no `tempId`. So 1a alone will *not* unstick optimistic bubbles. Add `tempId` to the `messageError` payload at `chatEvents.js:72,79,181`, register `handleMessageError` alongside the others, and set `{sending:false, failed:true}` by tempId. The `failed` flag is set at `ChatContext.jsx:196` but has no consumer — render it in `MessageBubble`.

**1c — Reconnect never refetches.** `ChatContext.jsx:534-549` only rejoins rooms. Server-side `syncMissedDeliveryEvents`/`syncMissedReadReceipts` sync *tick state* for messages the client already has — never content. **Any message sent while disconnected is permanently missing until a manual reload.** In `handleConnect`, after the join loop, call `fetchChats()` and `fetchMessages(activeChat._id)`. Keep `fetchChats`/`activeChat` in refs — `handleConnect` closes over `chats` and the effect deps are `[hasConnected, chats]`, so it currently re-registers the listener on every sidebar change.

**1d — Typing debounce is fully broken.** `MessageInput.jsx:5` `let typingTimeout = null` is render-local; `setInputValue` re-renders, so `clearTimeout(typingTimeout)` at `:16` always clears `null`. Every keystroke leaks an uncancellable 2s timer. → `useRef(null)`, update `:16,17,30`, add unmount cleanup.

---

## Phase 2 — Delete `chatListUpdate`, fix reconciliation — **DONE** (`caa2896`)

> Landed beyond the plan as written: `selectChat` now clears `unreadCount` on
> open. Nothing else reset the count, so the badge was unusable without it.

**Remove `chatListUpdate` entirely.** Everyone auto-joins all their chat rooms at `config/socket.js:66-67`, so `io.to(chatId).emit('newMessage')` already reaches every online participant. `chatListUpdate` is redundant — and the server emits it to the chat room (`chatEvents.js:133`) *and* each `user-<id>` room (`:135-137`), so participants receive it twice, plus `newMessage`. Both `handleNewMessage:292` and `handleChatListUpdate:400` increment → **+3 per message**.

Delete: server emits at `chatEvents.js:133-137` and `statusEvents.js:74` (that one increments unread when someone *reads* — backwards), client handler `ChatContext.jsx:389-409`, plumbing at `services/socket.js:26,93,170-171`. `handleNewMessage` becomes the single writer for preview, ordering, and unread.

Then guard the increment at `:292` with `!fromMe` (the variable already exists at `:237`) — fixes unread rising on your own sends. **Render the badge in `ChatList`** (~5 lines); counts reset on refresh, which is accepted.

**Reconciliation.** `handleMessageSentAck` (`ChatContext.jsx:434-451`) already does correct tempId replacement, but `chatEvents.js` emits `newMessage` (`:126`) *before* `messageSentAck` (`:140`), so the content-match heuristic at `:262-273` always wins — and it scans backwards, so sending the same text twice renders the messages **permanently reversed**. Fix: emit `messageSentAck` to the sender **before** the broadcast, and use `socket.to(chatId)` (excludes sender) for `newMessage`. Then delete the heuristic at `:260-273` and the dead fast path at `:251`. tempId stays sender-private.

---

## Phase 3 — Remaining correctness — **DONE**

> All three items landed, including the `newChat` emit flagged as deferrable.
> Deviations from the plan as written, and things learned while verifying:
>
> - `config/socket.js` exports `{ initializeSocket, getIO }` instead of the bare
>   function. `server.js` was the only require site. `getIO()` returns `null`
>   until boot completes — callers must tolerate that.
> - `TypingIndicator` is exported from `ChatWindow.jsx` so it can be tested
>   directly.
> - Scoping typing state had to move to the **view**, not the handler. Filtering
>   in the handler is precisely what dropped the `isTyping:false` events.
> - The `newChat` emit deliberately includes the **creator** (`022e7af`).
>   `user-<id>` fans out across every socket a user has open, so skipping them
>   left their other tabs and devices blind until reload. The originating tab
>   dedupes client-side.
> - **The room join is load-bearing.** The server joins sockets to chat rooms at
>   connect time only, so a chat created afterwards has no membership for anyone
>   already online. Verified with a negative control: without the client's
>   `joinChat`, the sender gets a normal `messageSentAck` and the recipient never
>   hears anything. Prepending to `chats` is what triggers the join effect.
> - **No regression guard on `emitNewChat`.** Controllers have no test harness
>   (the backend suite only covers `socketHandlers/` via injected `deps`) and the
>   function isn't exported. Covered by a live driver only. This is the one place
>   Phase 3 misses the failing-test-first bar.


**Typing state leaks across chats.** `typingUsers` (`ChatContext.jsx:89`) is keyed only by userId and never reset on chat switch. The `chatId === activeChat?._id` guard at `:306` also blocks the `isTyping:false` cleanup, so an indicator from chat1 sticks **permanently in chat2**. → key by `chatId`, drop the guard, filter at render time, clear in `selectChat`. Also `typingEvents.js:18,50` call `getTypingKey(userId, chatId)` against a `(chatId, userId)` signature — swapped consistently so it's stable, but fix it.

**`selectChat` race.** `ChatContext.jsx:163-175` → `fetchMessages:132-160` has no guard that the response still matches the current chat; clicking A then B fast can write **A's messages into B's window**. Add a chatId/sequence check before `setMessages`. Note `fetchMessages` depends on `chats` (`:159`) so it's recreated constantly — stabilize via ref.

**New chats invisible until reload.** `chatController.js:105,167` return over HTTP with no socket emit, so the recipient never learns the chat exists. Capture `io` in a module-level `getIO()` export from `config/socket.js` (it already returns `io` at `:153`), emit `newChat` to each `user-<pid>`, add the listener + handler that prepends and joins. *Most invasive item here — defer this one if anything slips.*

---

## Phase 4 — Shared helpers

Deliberately after correctness, so we extract the *fixed* shape.

- **`backend/utils/messageStatus.js`** — export the already-correct `areAllOtherInArray` (currently trapped unexported at `statusEvents.js:1-7`) plus `computeDeliveredToAll`. Replaces 4 copy-pastes: `config/socket.js:119-121`, `:168-170`, `chatEvents.js:157-163`, `statusEvents.js:120-122`. **Fix the null deref while here:** `chatEvents.js:157` does `updatedMsg.sender` where `updatedMsg` is `null` whenever the participant is already in `deliveredTo` — it throws, the catch throws again, and `invalidateChatCache` at `:176` is skipped, leaving every participant's cache stale for the full 300s TTL. Guard with `if (!updatedMsg) continue;`.
- **`backend/utils/chatAuth.js`** — `findChatForParticipant(chatId, userId, select)`. Replaces 6 sites in 3 idioms: `chatEvents.js:17,76`, `statusEvents.js:30-34`, `chatController.js:241,295,338`. Two wrappers so sockets emit `{chatId, message}` and controllers get a 403.
- **`backend/utils/presence.js`** — `syncUserSockets(io, redis, userId)`. Replaces the identical 5-line block at `config/socket.js:58-62` and `disconnectEvents.js:18-23`. The `del`-then-`sadd` sequence is **non-atomic** (a concurrent connect between them reads an empty set and broadcasts a genuinely-online user as offline) → wrap in `MULTI`. Add TTLs to `userLastSeen:` (`disconnectEvents.js:32`) and the socket set, which currently never expire.
- **`backend/utils/encryption.js`** — add `decryptMessageDoc(msg)` covering text + caption. Replaces `chatEvents.js:108-124`, `chatController.js:260-271`, `:31-37`. Pick **one** fallback — the third currently leaves raw ciphertext in `latestMessage.content`, which renders as garbage in the sidebar.
- **`backend/utils/validate.js`** — `handleValidation` middleware, replacing 8 boilerplate blocks with 2 different output shapes.
- **`authController.js`** — `issueAuthResponse(user)` for the duplicated JWT sign + user object at `:38-40/45-51` and `:80-82/86-92`.

---

## Phase 5 — Cleanup

- **Double cache invalidation:** `Message.js:65-77` post-save hook and `chatEvents.js:176` both invalidate the same participants. Keep the hook, drop the explicit call.
- **Phantom `onlineStatus`/`lastSeen`:** not fields on the User model (presence is Redis-only) yet `.select()`ed at 9 sites (`chatController.js:80,100,160,161,194,296` + userController). Cosmetic but misleading — strip.
- **`createOneOnOneChat` TOCTOU** (`chatController.js:72-97`): `findOne` then `save` with no unique index → simultaneous requests create duplicate chats. Use `findOneAndUpdate(..., {upsert:true})` + unique index on sorted participants.
- **Handlers register last, so a freshly-connected socket is deaf.** *(Found while
  verifying Phase 3 — not caused by it.)* `config/socket.js` registers every
  `socket.on(...)` at step 7, after the whole connection bootstrap: room joins,
  per-participant presence sync, and the unbounded delivery replay below.
  Anything the client emits before that lands on a socket with **no listener** and
  is dropped — no error, no log, no client-side hint. Measured at **~210ms** on a
  near-empty test account; it scales with message history, because the replay
  below runs inside that window. The client emits into it: `joinChat` from the
  reconnect effect, and `messageDeliveredToClient` from the catch-up effects.
  Reproduce by connecting a socket.io client and emitting `typingStart`
  immediately — nothing happens, and the Redis key is never written. Fix by
  registering handlers **before** the bootstrap (they only need `deps`, which is
  ready at connection time), then doing the sync work. Bounding the replay
  narrows the window but doesn't close it — the ordering is the actual bug.
- **`config/socket.js:156-183`:** replays *every* message ever delivered, unbounded, and does `Chat.findById` inside the loop (N+1 — the sibling at `:199` correctly hoists it). Hoist + bound to last 50 / since-last-seen.
- **`services/socket.js:54-62`:** `connect_error` only rejects on two exact auth strings; any other failure leaves the promise **pending forever**, so `hasConnected` never flips and the app hangs with no error surfaced. Reject on all, or add a timeout.
- **Typing authz** (`typingEvents.js:6,37`): no participant check — any authenticated user can inject a fake "X is typing…" into any chatId. Use `socket.rooms.has(chatId)` (free, no DB read per keystroke).
- **`api.js:33-40`:** logs every request/response body — plaintext message content in the browser console. Delete.
- **Dead frontend code:** `services/encryption.js`, `utils/formatTime.js`, `styles/*.css`, `api.getMessages`, `api.getCurrentUserProfile`, `MainLayout` (no-op), and the unused `on*`/`off*` socket methods — **keep `onMessageError`**, Phase 1b starts using it. Grep before each deletion.
- **`sortChats` helper** for the block repeated 5× (`ChatContext.jsx:108,210,297,449` — `:405` dies in Phase 2).
- **Skip:** converting all 12 controllers to `next(err)`. The error middleware at `app.js:62-75` is well-built and unused, but this is a large diff for little gain on a solo project. Convert opportunistically if already editing a file.
- Also stray `console.log`s at `ChatWindowHeader.jsx:19`, `ChatContext.jsx:491,540`, `MessageList.jsx:56`, `ChatWindow.jsx:61`, and a stray root-level `node_modules/` (10 packages) that looks accidental.

---

## Verification

Unit tests cover handler logic (`npm test` in both packages), but realtime
behavior needs the real app. Drive it (`npm run dev` in both `backend/` and
`frontend/`) with **two browser profiles**, checking these after each phase.
Phases 0–2 are still owed this pass:

> **Scripting the backend half.** Anything that doesn't involve rendering can be
> driven far faster than by clicking: connect two `socket.io-client` instances
> (available in `frontend/node_modules`) straight to `localhost:5000`. Sign the
> tokens locally — `jwt.sign({ userId }, process.env.JWT_SECRET)` is all socket
> auth and `config/auth.js` check, so no passwords or login round-trip are
> needed, and nothing secret has to be printed. Three things to know:
> **(1)** wait ~1.5s after `connect` before emitting, or you land in the deaf
> window described in Phase 5 and your events vanish;
> **(2)** always include a negative control — "does it still pass if I skip the
> step I think matters?" is what proved the room join was load-bearing;
> **(3)** chat creation must go through `POST /api/chat/one-on-one` to emit
> `newChat`. `scripts/createChat.js` writes straight to Mongo and deliberately
> bypasses the controller; `scripts/createChatViaApi.js` (untracked) hits the
> endpoint. A "Chat already exists" 200 emits nothing — delete the chat to retest.

| Phase | Check |
|---|---|
| 0 | Server logs show `messageDeliveredToClient` firing; single ticks become double on delivery |
| 1a/1b | Stop MongoDB mid-send → bubble shows a **failed** state, not a permanent "sending" spinner |
| 1c | Kill wifi on tab B, send 3 messages from A, restore → all 3 appear **without reload** |
| 1d | Type continuously in A → B shows a *steady* indicator that clears ~2s after you stop, no flicker |
| 2 | Send 1 message to an inactive chat → badge reads exactly **1**, not 3. Send twice from A → your own badge stays 0. Have B read → A's badge doesn't rise. Send "ok" twice fast → correct order |
| 3 | **Backend half done** (scripted socket clients). Still owed in a browser: type in chat1, switch to chat2 → no stuck indicator; click chat A then B fast **under Slow 3G** → B shows B's messages |
| 4/5 | Full regression of the above — these phases should be behavior-neutral |

Commit one phase at a time (one helper per commit in Phase 4) so any regression bisects cleanly. **Phases 0–3 contain all user-visible breakage; 4–5 are debt.**

---

## Corrections to note

Two audit findings were revised during design, and one was added:
- `handleMessageSentAck` **does** correctly reconcile by tempId — the bug is emit *ordering*, not a missing path.
- `messageError` has no client listener at all, so fixing the catch blocks alone wouldn't surface errors. Both halves are needed.
- `Message.js:81` is a normal `//console.error` comment, not a bug.
