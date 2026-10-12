# Afterbell API

Node.js + Express + MongoDB backend for the Afterbell school app.

## The one file you need

```
settings.js
```

That is the entire test/prod switch. Nothing else in this folder knows which
environment it is in.

```js
const MODE = "test";   // flip to "prod" when you deploy
```

| | `test` | `prod` |
|---|---|---|
| database | throwaway in-memory MongoDB | your real MongoDB |
| survives a restart | no | yes |
| seeded demo data | yes, every boot | no |
| refuses to boot with a placeholder secret | no | yes |

```bash
npm start     # boot the API using whatever MODE says
npm test      # run the suite (always uses test mode, whatever settings.js says)
```

## Test mode

On boot, `mongodb-memory-server` downloads and starts a real `mongod` bound to
a random local port. It is seeded with:

- **4 users** — `rudra.c` (admin), `meera` (mod), `arjun.m`, `zoya.k` (students)
- **5 invite codes** — `DEMO-AAAA-1111` through `DEMO-EEEE-5555`
- **3 posts** — two approved, one still pending
- **3 comments** — one of which is a nested reply

Everything is wiped when the process exits. You cannot break anything real.

The suite in `test/` forces `MODE = "test"` internally, so editing
`settings.js` to `"prod"` and running `npm test` still cannot touch a real
database.

## Prod mode

Reads `MONGO_URI` from the environment, falling back to the literal in
`settings.js`. Set one of the two:

```bash
MONGO_URI="mongodb+srv://user:pass@cluster/afterbell" npm start
```

or edit the `prod.mongoUri` line directly. Seeding stays off.

## What the gateway does

`POST /posts` and `POST /posts/:id/comments` run the text through the filter
**before** anything is written. A blocked post returns `422` and produces no
row — there is nothing to delete later and nothing to leak.

Blocked hard at the gate:

- the slur list, in every spelling the front-end knows about
- styled Unicode from font generators (it exists only to sneak past the reader)
- the safety list (`FILTER_TERMS` — nudes, drugs, phone number, address…)

**Never** blocked:

- the swear tiers. They are reader-side only. `filter.blockSwearTiers` is
  `false` and turning it on changes what the product is.

The word lists in `src/filter.js` are a hand copy of the ones inside
`Web/index.html`. `test/filtersync.test.js` re-derives both from source on
every run and fails the suite if they have drifted.

## Endpoints

| | |
|---|---|
| `GET /health` | liveness + current filter flags |
| `POST /filter/check` | `{ text }` → `{ blocked, reasons, note }` |
| `POST /auth/redeem` | `{ code, handle, name, section }` → `{ token, user }` |
| `POST /auth/dev-login` | **test mode only** — `{ handle }` → `{ token, user }`. Lets you sign in as a seeded mod/admin |
| `GET /auth/me` | current user |
| `POST /auth/logout` | kills the token |
| `GET /posts` | approved feed, newest (boosted first) |
| `GET /posts/:id` | one post — `404` if pending and not yours |
| `POST /posts` | create — **pending by default** |
| `POST /posts/:id/like` | toggle |
| `GET /posts/:id/comments` | whole tree in one response |
| `POST /posts/:id/comments` | reply — same gate as a post |
| `GET /mod/queue` | pending posts, mod/admin only |
| `POST /mod/posts/:id/approve` | approve — needs two mods if reported |
| `POST /mod/posts/:id/reject` | reject + fingerprint for reupload detection |
| `GET /mod/log` | append-only moderation history |

## Layout

```
settings.js          the test/prod switch
src/
  server.js          entry point
  app.js             express app (no listen, so tests can drive it)
  db.js              connection + indexes
  auth.js            sessions, requireAuth, requireRole
  filter.js          the gateway text filter (port of the front-end's)
  seed.js            test fixtures
  routes/
    auth.js          redeem / me / logout
    posts.js         feed / create / like
    comments.js      tree read / reply
    mod.js           queue / approve / reject / log
test/
  helpers.js         boots an app + in-memory db per file
  filtersync.test.js proves the word lists match Web/index.html
  auth.test.js       invite burn, single use, token lifecycle
  posts.test.js      the gate, pending-by-default, likes, retention
  comments.test.js   tree shape, parent validation, same gate
  mod.test.js        restriction rule, two-mod threshold, append-only log
```

## Talking to the frontend

`Web/index.html` ships an `AB` module with the same contract as its existing
`JINGLE_API`: a base URL, a bearer token, and a state that degrades to
`local` when nothing is configured. Empty base URL means the app behaves
exactly as it did before this backend existed — everything on the device.

To connect it:

1. Run `start.bat` in the project root, or `npm start` here.
2. In the app: **Settings → Backend → Endpoint → Use localhost:4000**.
3. Reload. The invite gate now burns codes against this server.

The settings sheet also has a **test mode only** sign-in box. Redeeming a
code always creates a `student`, so there is no way to exercise moderation
without it. Type `rudra.c` (admin) or `meera` (mod) to become one of the
seeded fixtures. The server returns 404 for that endpoint outside test mode.

What is wired through the seam today: the invite gate, the feed (read +
create), likes, comments, and text-post moderation. Everything else —
clips, DMs, boards, polls, the marketplace — is still local, by design.
That is slices 0–2 and 5 of `Web/.info/BACKEND-PLAN.md`; the rest is
deliberately not built yet.

## Notes

- **Tokens are opaque strings** in a `sessions` collection, not JWTs. To log
  someone out you delete their row. At this scale that is the right trade.
- **Invite codes burn atomically.** Two people pasting the same code at the
  same instant both hit the database; only one wins. There is no
  application-level lock.
- **A moderator cannot act on their own content.** `403 restricted`.
- **30-day retention is enforced in the query**, not by a nightly job, so it
  holds even if nothing is running.
- Nothing in `src/` imports anything from `Web/`. The filter is a port, kept
  honest by the sync test, because `index.html` is a single self-contained
  file with no module system.
