# Deploying the public demo

Free-tier deployment: **Render** (backend) + **Vercel** (frontend) + **Atlas**
(Mongo) + **Redis Cloud**. Nothing here costs money, but two of the free tiers
have sharp edges that are called out where they bite.

Order matters. The backend needs the frontend's URL and the frontend needs the
backend's URL, so one of them has to be deployed twice. The sequence below
deploys the backend first, then the frontend, then goes back and fills in
`CLIENT_URL`.

---

## 1. MongoDB Atlas

1. Create a free **M0** cluster. Pick a region near where you will put Render
   (`Frankfurt` pairs well with Render's `Frankfurt`) - every query crosses this
   gap, so a mismatched pair adds latency to every message.
2. **Database Access** → add a database user. Give the deploy its own user, not
   your admin login.
3. **Network Access** → allow `0.0.0.0/0`. Render's free tier has no static
   egress IP, so there is nothing narrower to allow-list. The database is still
   protected by the user password.
4. Copy the connection string:
   `mongodb+srv://<user>:<pass>@<cluster>/real-time-chat?retryWrites=true&w=majority`

   **URL-encode the password.** A literal `@`, `#`, `/` or `?` in it truncates
   the connection string and produces an authentication error that looks
   nothing like the actual cause.

## 2. Redis Cloud

Redis is **required**, not an optimisation: `config/socket.js` opens pub/sub
clients for the Socket.IO adapter during boot, and presence (`userSockets:<id>`)
plus the chat cache live there. The server will not start without it.

1. Create a free **30 MB** database.
2. Copy the endpoint host, port, and password.
3. Whatever provider you use, confirm it supports **real pub/sub**. Some
   serverless Redis tiers expose only a REST subset; the adapter fails at
   startup on those, before the server ever listens.

## 3. Render (backend)

**New → Web Service**, connect the GitHub repo, then:

| Setting | Value |
|---|---|
| Root Directory | `backend` |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/health` |
| Instance Type | Free |

`npm ci` rather than `npm install` - it installs exactly what
`package-lock.json` pins, so a deploy can't silently pick up a different
version than the one you tested.

Environment variables (see `backend/.env.example` for the full annotated list):

```
NODE_ENV=production
MONGO_URI=<from step 1>
JWT_SECRET=<generate fresh>
JWT_EXPIRES=7d
ENCRYPTION_KEY=<generate fresh, EXACTLY 32 characters>
REDIS_HOST=<from step 2>
REDIS_PORT=<from step 2>
REDIS_PASSWORD=<from step 2>
REDIS_TLS=true
DEMO_MODE=true
```

Generate the secrets locally - never reuse the ones from your dev `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"          # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(24).toString('base64').slice(0,32))" # ENCRYPTION_KEY
```

`ENCRYPTION_KEY` is measured in **characters, not hex bytes** -
`utils/encryption.js` does `Buffer.from(ENCRYPTION_KEY)` at the default utf8
encoding, so a 64-character hex string is 64 bytes and throws on the first
message sent. And it cannot be rotated later: changing it makes every stored
message decrypt to `[Message unavailable]`.

Do **not** set `PORT`. Render assigns one and expects the process to bind it;
`server.js` already reads `process.env.PORT`.

Leave `CLIENT_URL` unset for now - step 5.

Deploy, then note the URL: `https://<name>.onrender.com`.

## 4. Vercel (frontend)

**Add New → Project**, same repo:

| Setting | Value |
|---|---|
| Root Directory | `frontend` |
| Framework Preset | Vite (auto-detected) |

`frontend/vercel.json` handles the rest, including the SPA rewrite - without it
a refresh on `/login` returns a 404 instead of the app.

Environment variables, both set to the Render URL from step 3, **no trailing
slash**:

```
VITE_API_URL=https://<name>.onrender.com
VITE_SOCKET_URL=https://<name>.onrender.com
VITE_DEMO_MODE=true
```

`VITE_DEMO_MODE` shows the "Try the live demo" button. It must match
`DEMO_MODE` on the backend - with the button on and the backend's demo mode
off, the endpoint 404s and the button just reports an error.

These are read via `import.meta.env` and baked in at **build** time. Changing
them later requires a redeploy, not a restart - editing the value and
restarting does nothing at all.

Deploy, then note the URL: `https://<name>.vercel.app`.

## 5. Close the loop

Back on Render, set:

```
CLIENT_URL=https://<name>.vercel.app
```

Exact origin, scheme included. This feeds both the Express CORS config
(`app.js`) and the Socket.IO handshake (`config/socket.js`), which share one
resolver in `config/clientOrigin.js`.

**This step is not optional, and skipping it is the single most confusing way
this deploy can fail.** Unset, the resolver falls back to `http://localhost:5173`
and the backend advertises *that* as the only permitted origin. The site then
loads (static files, no backend involved) and every single API call dies as an
unexplained `Network Error` with no status - identical to the backend being
down, which is where the diagnosis usually goes wrong. It happened on
2026-07-29. Two things now make it findable: a production boot with `CLIENT_URL`
missing or empty logs an explicit error in the Render log, and a **trailing
slash is stripped** rather than silently matching nothing.

On Render: left sidebar → **Environment** → **+ Add Environment Variable** →
then pick **"Save and deploy"** from the save dropdown. "Save only" stores the
value without applying it, so the site stays broken and the fix looks like it
did not work. No rebuild is needed - this is read at runtime.

## 6. Keep it awake

**This is the difference between a demo that works and one that doesn't.**

Render's free tier sleeps after 15 minutes with no inbound requests and takes
roughly 50 seconds to wake. A visitor arriving from the portfolio gets a blank
screen for most of a minute and leaves.

The free allowance is 750 instance-hours per month and a month is at most 744
hours, so **one always-on service fits inside the free tier**. Point a free
[UptimeRobot](https://uptimerobot.com) HTTP monitor at:

```
https://<name>.onrender.com/health
```

every 5 minutes. That endpoint is deliberately cheap - it touches neither Mongo
nor Redis - so the keep-alive costs nothing but the instance hours you are
already entitled to.

## 7. Verify

Realtime failures are quiet, so check the socket explicitly rather than
assuming a loading page means success:

1. Open the Vercel URL, register, and send a message.
2. DevTools → Network → **WS**. There must be a `socket.io` connection in state
   `101 Switching Protocols`. If HTTP works but this is missing or looping,
   `CLIENT_URL` is wrong - that is nearly always the cause.
3. Open a second browser **profile** (incognito, different account - two tabs
   share `localStorage` and log in as the same user) and confirm a message
   crosses live.
4. Watch the ticks progress: sent → delivered → read.

---

## Known limits of this setup

- **Uploaded files do not survive a redeploy.** They are written to
  `backend/uploads/` on the instance's ephemeral disk. Fine for a demo; if you
  ever need them to persist, that is the point to move to S3 or Cloudinary.
- **M0 is 512 MB.** Guests are disposed of two ways, so this should stay flat:
  logging out deletes the account and its chats immediately, and a sweeper
  removes anything older than 24 hours once at startup and hourly after. The
  sweeper is the one that matters - most visitors close the tab rather than
  logging out, and that fires no request.
- **Cold start still applies to the very first request after a deploy**, and if
  the keep-alive monitor is ever paused.
- **Node version is unpinned.** Render picks a current default. If a future
  deploy breaks on a version bump, pin it with an `engines.node` field in
  `backend/package.json`.
