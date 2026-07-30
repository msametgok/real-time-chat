# CLAUDE.md

Guidance for Claude Code when working in this repository. Untracked and local —
everything a *human* reader needs lives in the tracked docs instead.

## Read this first

**[ENGINEERING-NOTES.md](ENGINEERING-NOTES.md) holds the architecture, the
conventions, and a numbered list of gotchas — read it before editing anything.**
Every entry in that list is a bug that already happened here, and most of them
failed silently rather than crashing, so they are not guessable from the code.

- [README.md](README.md) — install, scripts, env vars, API and socket surface.
- [DEPLOY.md](DEPLOY.md) — free-tier deployment and its quiet failure modes.
- [REMEDIATION-PLAN.md](REMEDIATION-PLAN.md) — history, but its verification
  recipes and its record of *wrong* instructions are still worth reading before
  writing a realtime test.

## Scope

Solo hobby project, actively under development — **not** production and not
enterprise-scoped. Prefer small, surgical changes over architectural rewrites.
No TypeScript — don't introduce it without asking.

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

Both take `npm run test:watch`. Tests live in `__tests__/` next to the code they
cover.

`backend/.env` holds `MONGO_URI`, `JWT_SECRET`, `ENCRYPTION_KEY`, `REDIS_*`,
`CLIENT_URL`. Never commit it or print its values. Message content is encrypted
at rest — never log decrypted content.

## Testing changes

Unit tests are not enough for realtime work, and the obvious manual checks
produce confident false passes. Follow **"Verifying realtime changes"** in
ENGINEERING-NOTES.md rather than improvising: it covers the two-browser-profile
setup, why DevTools "Offline" takes ~15s to register, and the two traps that make
scripted socket probes fail for reasons unrelated to the code.

When fixing a bug, add a test that **fails against the old code**. Several bugs
here were silent no-ops rather than crashes, so a test asserting the *observable*
behavior is the only real guard.

## Git

**Never run `git commit` or `git push` — not even when asked.** The user commits
manually so their history carries no AI co-author trailer. Staging files is fine
(`git add`, `git rm`); creating a commit is not.

When work is finished, hand off instead: list **which files to commit together**
(one logical change per commit, so regressions bisect cleanly) and supply the
**commit message** to paste.

Message rules:

- A subject line, then **one or two sentences**. Never a multi-paragraph body,
  never a bulleted rationale — that reads as machine-written.
- No `Co-Authored-By` trailer, no `Generated with` footer, no emoji.
- Say what changed and why in plain terms. Detail belongs in
  ENGINEERING-NOTES.md, not in the commit.

## Keeping the docs current

When a change invalidates something written down, update it in the same pass:

- A new silent-failure bug, convention, or subsystem note → ENGINEERING-NOTES.md.
- A new endpoint, socket event, script, or env var → README.md.
- Anything about hosting or configuration → DEPLOY.md.
