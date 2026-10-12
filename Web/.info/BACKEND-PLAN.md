# Afterbell — Backend Plan

Status: **draft, stack undecided.** This document is deliberately
backend-agnostic in §5 so you can pick the stack without rewriting the
integration plan. The integration approach in §3 works unchanged for any
choice in §5.

Written against `Web/index.html` @ 22,345 lines. Line numbers will drift;
the structural claims will not.

---

## 1. Where the front-end actually is

The prototype is not a client of an API. It is a mock with a very good UI, and
the distance between the two is the real cost of this project.

**What makes it not API-shaped:**

- All data lives in **module-level collections** declared at the top level of
  the single `<script>`. No data-access layer exists to redirect them.
- Screens read them directly: `CLIPS.filter(...)` (`index.html:12118`,
  `:21483`), `POSTS.find(...)` (20+ sites), `TICKETS.find(...)`.
- Actions mutate them inline: `TICKETS.unshift({...})` inside `ticketNew`,
  `POSTS.unshift(...)` inside compose.
- They are `const`, so they cannot be swapped at runtime. There is nothing to
  point at a server.
- **There is no user identity.** `S.me` is a local object with a name and
  handle. No id, no session, no token. `byId()` (`:3266`) resolves against a
  local array.
- The invite gate is **UI-only**. `ACTIONS.skipGate()` walks straight past it
  because nothing is enforced anywhere but the render tree.

**What is already further along than it looks:**

There is a working HTTP client in the file, and the author labelled it:

```
/* ---------- the backend that does not exist yet ---------- */
const JINGLE_API = { base, key, live, state, url(), headers(), pull(), push() }
```
(`index.html:20142`)

It has bearer auth, a base URL and key persisted through a real settings
screen (`:20386`–`:20429`), and a **degrade-gracefully contract**: no base →
local; reachable → `state: "live"`; error → `"unreachable"` or `"queued"`.
A second real call does the same for the Discord widget (`:19588`), and its
failure copy states the house rule outright: *"we could not check, and we do
not invent a verdict."*

That is your architectural precedent, already paid for. §3 generalises it.

---

## 2. The boundary that makes this tractable

My first draft of this section claimed the `let`/`const` declaration split was
the server/client boundary. It is not, and it is worth saying why, because the
wrong version is very tempting:

- `let`  → `POSTS`, `CONF`, `CRUSH`, `TICKETS`, `QUEUE`, `LOG`, `POLLS`,
  `QUESTIONS`, `BUGS`, `SUGGESTIONS`, `INVITE_CODES`, `ANNOUNCEMENTS`
- `const` → `CMT`, `DMS`, `BOARDS`, `CLIPS`, `LISTINGS`, `TOURNEYS`,
  `LADDER`, `REJECTED_HASHES`, `P`

Every one of those is user data. `CLIPS` is `const` yet `CLIPS.unshift(...)`
runs on every upload (`:8074`); `CMT` is `const` yet `CMT.push(...)` runs on
every comment (`:8194`). And `POSTS` is `let` despite **never being
reassigned** — the 30-minute sweep (`sweep()`, `:11172`) mutates in place
(`p.swept = true`) and hides through `S.hidden[p.id]`, which is the pattern
everywhere else too. There is no whole-array reassignment in the file.

So the declaration kind carries no architectural meaning. It is an accident of
the order things were written in. Using it to derive the schema would have put
`clips` and `comments` client-side and `posts` server-side for no defensible
reason.

**The real test is one question:**

> Does this row change when a user does something?

- **Yes → server state → a table.** Posts, comments, clips, DMs, confessions,
  crush entries, boards, threads, polls, listings, tickets, mod queue, mod
  log, reports, invite codes, announcements, tournaments, ladder, questions,
  bug reports, suggestions, cash ledger, jingles, users.
- **No, identical for every user forever → client config → stays in the file.**
  `SETTING_GROUPS`, `APP_THEMES`, `ACCENTS`, `FAQ`, `PERKS`, `COSMETICS`,
  `JINGLES_SHOP`, `SWEAR_TIERS`, `SLUR_WORDS`, `CALC_MODES`, `CALC_KEYS`,
  `FIRST_RUN`, `QCATS`, `TICKET_CATS`, `FEED_MIX`, `MOD_TEAM`, `ARCADE`,
  `SPIN_PRIZES`, `WARN_LADDER`, `CONSOLE_TABS`, `FEED_SORTS`.

Two edge cases worth naming now, because they will confuse someone at 2am:

- **`FEATURE_FLAGS`** (`:14154`) has an `on` boolean. An admin toggles it, so
  it is server state despite looking like config.
- **`CUSTOM_THEME`** (`:17779`) is user-created, so it is server state.
  `APP_THEMES` is not.
- **`SLUR_WORDS` / `SWEAR_TIERS`** are client config *and* must be read by the
  server (§3.3). Ship them as a shared JSON both import — the list itself is
  static, the user's *choice* about it is not.

The third category, which is neither:

**Device-local prefs.** `S.toggles` (214 of them), theme, accent, density,
typeface, rounding, calc mode/PIN/hint, swear prefs. Already persisted to
`localStorage` (`:13406`) and should stay there. These are device-local by
design, not by omission — they are the least interesting data in the app and
the most privacy-sensitive to centralise.

The single most important consequence of all this:

> **The app renders exclusively from local state, always. The backend is a
> synchroniser, not a data source.**

`render()` (`:6571`) reads `S.route` and calls `SCREENS[route].render()`, which
reads local arrays. That path never needs to change. You are not rewiring the
render layer — you are putting a synchroniser in front of the mutation path and
the initial load. That is what makes this shippable in slices rather than as a
big bang.

---

## 3. How to integrate

### 3.1 The seam

One module, same contract as `JINGLE_API`, injected once:

```js
/* ---------- the backend, now actually existing ---------- */
const AB = {
  base: "",          // from settings, persisted like JINGLE_API
  key: "",           // session token, set by the gate on success
  state: "local",    // "local" | "live" | "queued" | "unreachable"
  last: "",
  queue: [],         // offline write buffer

  url(p)  { return this.base.replace(/\/$/, "") + p; },
  head()  { return { "Content-Type": "application/json",
                     Authorization: "Bearer " + this.key }; },

  /* reads: resolve to local state on any failure. never throw. */
  async pull(path, fallback) {
    if (!this.base) return fallback;
    try {
      const r = await fetch(this.url(path), { headers: this.head() });
      if (!r.ok) throw new Error("HTTP " + r.status);
      this.state = "live";
      this.last  = new Date().toTimeString().slice(0, 5);
      return await r.json();
    } catch (e) {
      this.state = "unreachable";
      this.last  = e.message;
      return fallback;
    }
  },

  /* writes: mutate local first, then push. buffer on failure. */
  async send(method, path, body, apply) {
    if (apply) apply();                       // local first, always
    if (!this.base) return;
    const job = { method, path, body };
    try {
      const r = await fetch(this.url(path), {
        method, headers: this.head(), body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      this.state = "live";
    } catch (e) {
      this.queue.push(job);
      this.state = "queued";
    }
  },
};
```

Three rules, matching the existing precedent exactly:

1. **Never throw at a call site.** A dead server must not break the app. The
   user keeps working against local state.
2. **Local mutation first, network second.** The UI updates instantly; the
   push is fire-and-forget with a buffer. This is why `queued` exists as a
   state, not an error.
3. **The state is visible, not hidden.** There is already UI in the jingles
   screen that renders `JINGLE_API.state`. Reuse that vocabulary. Hiding
   sync state from a 100-person school app is how you get people reporting
   "my post vanished".

### 3.2 Wiring a collection — the mechanical pattern

Take the feed. Today:

```js
let POSTS = [ { id:"p1", uid:"arjun", t:38, body:"...", likes:41, liked:false, approved:true }, ... ];
// read:  POSTS.filter(x => x.approved)
// write: POSTS.unshift({ ... }); render();
```

After:

```js
let POSTS = [];            // becomes a cache, not the source of truth

async function feedLoad() {
  const rows = await AB.pull("/posts", POSTS);
  if (rows !== POSTS) POSTS = rows;
  render();
}

function postCreate(body) {
  AB.send("POST", "/posts", { body }, () => {
    POSTS.unshift({ id: uid(), uid: S.me.id, t: nowMin(),
                    body, likes: 0, liked: false, approved: true });
  });
  render();
}
```

Nothing in `SCREENS.feed` changes. It still calls `POSTS.filter(...)`. That is
the whole trick.

**Migration order per collection** — three phases, each shippable alone:

| Phase | Change | Risk |
|---|---|---|
| 1 | Add `xLoad()` + call it on route entry. Reads still come from the local array. | Zero — local array is still the truth |
| 2 | Route writes through `AB.send(..., apply)`. Local `apply` keeps the UI instant. | Low — if the server is down, behaviour is identical to today |
| 3 | Drop the seed data once live is proven and the server is authoritative | Only after phase 2 has run for a while |

Do **not** do all three for all collections at once. One collection through all
three phases, then the next.

### 3.3 The one thing that must not go through the seam

The swear filter. PROJECT.md §3 requires rejection **at the API gateway,
before storage** — *"never stored"*. That is a server-side rule, and it cannot
be enforced by a client that a curious 14-year-old can edit in DevTools.

So the filter ships in two places, and only one of them is authoritative:

- **Client** — the existing engine (`SLUR_WORDS` `:5740`, `filterCheck`
  `:5748`, `SWEAR_TIERS` `:5773`, `filterStrip` `:7879`), unchanged. It gives
  the instant "you cannot post this" experience and the retroactive redaction
  on screen. It is a courtesy, not a control.
- **Server** — the same word lists (`SLUR_WORDS` `:5740`, `SWEAR_TIERS`
  `:5773`, plus `S.swears.extra`), run inside the write handler before the row
  is committed. This is the one that counts.

Keep the lists in one place (a shared JSON the server reads and the client
imports) so they cannot drift.

### 3.4 Auth, in the order it should be built

The gate flow already exists as UI: details → admin verifies → single-use
token → burn (`INVITE_CODES` `:18758`, gate screens `:6659`+). Map it
directly:

1. **Token as bearer credential.** `POST /auth/redeem {code, handle, name,
   sec}` → server burns the code, creates the row, returns a session token.
   Client stores it in `AB.key` and persists it.
2. **Every subsequent request carries it.** Server resolves `user_id` from the
   token, never from the request body. This is the whole identity model — the
   client never gets to claim to be someone else.
3. **RLS / per-user scoping from day one**, not later. The "admin visibility
   restricted to reported messages only" rule (§5) is a query-shape rule, and
   retrofitting it is how you end up leaking DMs.

**Privacy point that needs deciding before you write the schema:** the gate
collects personal details (name, section, phone, Instagram) for manual
verification. Decide now whether those are stored, and if so for how long.
My recommendation: **verify, then discard.** Keep the row (handle, section,
role, verified_at) and drop the phone/Instagram. There is no feature that
needs them after verification, and they are the single highest-value table in
the database if it is ever exposed.

---

## 4. Derived schema

Derived from §2's question — *does this row change when a user does something?*
Column names follow the existing field names so the client mapping is
mechanical.

### Core social

| Table | From | Notes |
|---|---|---|
| `users` | `P` `:3176`, `S.me` | `id, handle, name, section, avatar, role, badges[], verified`. `role` ∈ `student \| mod \| admin`. |
| `posts` | `POSTS` `:3329` | `id, user_id, t, body, likes, approved, boost, boost_left`. 30-day auto-delete. |
| `post_likes` | `S.likes` | join table, not a counter — the counter is derived. Prevents double-like races. |
| `comments` | `CMT` `:3491` | `id, post_id, parent_id, user_id, t, body, likes`. **Self-referencing** — matches §7 exactly. |
| `clips` | `CLIPS` `:4604` | `id, user_id, t, url, dur, caption, likes, comments, views, approved, saves, sound, tag`. `url` points at R2. |
| `rejected_hashes` | `REJECTED_HASHES` `:4241` | `h, what, by, when`. The pHash table from §4. Index on `h`. |

### Private

| Table | From | Notes |
|---|---|---|
| `dm_threads` | `DMS` `:3619` | `id, a_id, b_id`. Unique on the unordered pair. |
| `dm_messages` | `DMS[].msgs` | `id, thread_id, sender_id, t, body, read_at`. Indexed by `(thread_id, t)` per §7. |
| `confessions` | `CONF` `:3727` | **No `user_id` column.** §7: all identifying data stripped before storage. This is a hard requirement, not a preference. |
| `crush` | `CRUSH` `:3778` | `user_id, target_handle`. Match only revealed when both rows exist. Query is `JOIN` on the pair — never expose a single row. |

### Community

| Table | From | Notes |
|---|---|---|
| `boards` | `BOARDS` `:3795` | `id, name, description` |
| `threads` | `BOARDS[].threads` | `id, board_id, user_id, title, t` |
| `polls` | `POLLS` `:4748` | `id, question, opts[], ends_at` |
| `poll_votes` | `S.votes` | join table, one row per user per poll |
| `listings` | `LISTINGS` `:4068` | `id, user_id, title, price, cond, cat, boost, sold, t` |
| `tournaments` | `TOURNEYS` `:4042` | `id, game, when, fee, entrants, cap, pool, format, status` |
| `ladder` | `LADDER` `:4034` | `user_id, w, l, streak` |
| `questions` | `QUESTIONS` `:13682` | oracle/Q&A |
| `announcements` | `ANNOUNCEMENTS` `:21782` | admin-authored |

### Operations

| Table | From | Notes |
|---|---|---|
| `tickets` | `TICKETS` `:4138` | `id, user_id, sub, cat, body, status, mod_id, t` |
| `mod_queue` | `QUEUE` `:4180` | pending clips. `status ∈ pending \| approved \| rejected`, `flags[]`, `rerouted_to` |
| `mod_log` | `LOG` `:4255` | **Append-only.** `mod_id, content_id, action, reason, t`. §6 requires every action logged; nothing updates or deletes rows here. |
| `reports` | `REPORT_INBOX` `:14390` | `id, kind, ref_id, by_id, t, why, state, sev` |
| `invite_codes` | `INVITE_CODES` `:18758` | `code, issued_to, issued_by, state ∈ unused\|used\|burned, used_at`. **Single-use enforced server-side.** |
| `cash_ledger` | `CASH_LEDGER` `:14307` | `id, user_id, item, amount, collected, when, state`. No payment processor — this is a record, not a transaction. |
| `jingles` | `S.jingles` | `user_id, balance, owned[], equipped{}`. The existing `JINGLE_API` already speaks to this. |

### Explicitly *not* a table

`S.toggles` (214 of them), theme, accent, density, typeface, rounding, calc
mode/PIN/hint, swear prefs. Already persisted to device (`:13406`) and should
stay there. These are device-local by design and are the least interesting
data in the app.

---

## 5. What goes behind the API — undecided

You said you are still deciding. Here is the decision laid out for *this*
project's actual constraints, which are unusual: **~100 users, one school, one
solo maintainer, no payment processor, no app store, and every user is a
minor.**

### Option A — Supabase + a thin Node service

- Supabase free tier: Postgres, auth, and **row-level security**.
- RLS is the single biggest win here. The §6 rule (*a moderator cannot act on
  their own content or their close friends'*) and the §5 rule (*admin sees only
  reported messages, never full DM history*) are both **query-shape rules**.
  RLS expresses them in the database, where a client bug cannot undo them.
  Hand-rolling that in application code is where the leaks come from.
- Node service for the two things Supabase does not do cleanly: the swear-filter
  gateway (§3.3) and the 30-minute sweep.
- Cost: two things to run. Mitigated by the sweep being a cron, not a process.

### Option B — All Supabase, no custom server

- Filter and sweep as edge functions / database webhooks.
- Fewer moving parts, single dashboard, one deploy.
- Cost: the filter runs in a less controllable place, and you lose the clean
  *"rejected at the gateway, never stored"* property — an edge function sits
  after more of the stack than a gateway does. Given §3 is the one moderation
  rule the spec states most absolutely, I would not trade it for convenience.

### Option C — Hand-rolled Node + Postgres

- One service, one database, no vendor lock-in.
- Cost: you own auth, TLS, backups, connection pooling, and migrations, solo,
  forever. For a 100-user school app that is a lot of undifferentiated
  maintenance for no user-visible benefit.

### Where I land

**A**, for one reason specific to this project: the moderation rules in §5 and
§6 are *isolation* rules about who may read what, and RLS puts them in the one
place a client cannot subvert. That matters more here than anywhere, because
every user is a minor and the data is their school life.

But that is a recommendation, not a decision — and it is cheap to reverse until
§3.3 and the `mod_log` table exist, because those are the only two pieces that
lean on the choice.

---

## 6. Build order

PROJECT.md §13 already says it: *"ship the core loop first — feed, DMs, invite
gating, basic text moderation — get it live with the initial invited group,
then layer in forums, minigames, marketplace and tournaments based on actual
demand rather than building the full spec before anyone has used any of it."*

That is correct and I would not change it. Concretely:

| Slice | Tables | Unlocks | Rough size |
|---|---|---|---|
| **0. The seam** | — | `AB` module in `index.html`, settings screen wired, state visible in the UI. Nothing calls it yet. | Small |
| **1. Gate + identity** | `invite_codes`, `users` | Real signup. Token burn enforced server-side. First real session token. | Small, highest value |
| **2. Feed + comments** | `posts`, `post_likes`, `comments` | The core loop. Self-referencing comment tree per §7. | Medium |
| **3. Filter gateway** | — | §3 "never stored" becomes true rather than aspirational. | Small, high value |
| **4. DMs + reports** | `dm_threads`, `dm_messages`, `reports` | Privacy-critical. Do RLS before writing the queries. | Medium |
| **5. Moderation** | `mod_queue`, `mod_log`, `rejected_hashes` | §4 and §6 become real. Frame grid and pHash wire into `Lib/media.js`. | Large |
| **6. Everything else** | boards, polls, listings, tickets, tournaments, jingles | Only on demand, per §13. | — |

Slices 1–3 are a genuinely usable app for five people. Stop there and see if
anyone uses it before building 4–6.

### The video path specifically

`Lib/media.js` (codec chain, frame extraction, pHash) and `Lib/clipstudio.js`
(capture, compose, export) are **already built and tested** — 27/27, 38/38,
31/31 in-browser, live archive.org 206 + ranged fetch verified.

And `index.html` references neither. Zero hits for `AbMedia|AbStudio|Lib/`.

So the video backend is not a build task, it is a **wiring** task: load the
libs, point `SCREENS.clips` at real captured video instead of the SVG `SCENE`
tableaus (`:7063`), let `stampFrames` (`:7154`) stamp real decoded frames, and
make `REJECTED_HASHES` real pHash values instead of seeded strings. Do this in
slice 5, not before — the spec's build order is right that video is not the
core loop.

---

## 7. Open decisions for you

1. **Stack** — §5. My recommendation is A, but the moderation-isolation
   argument is the only thing really at stake, and it is reversible until
   slice 5.
2. **Personal details at the gate** — store or discard after verification?
   I recommend discard.
3. **Where the code lives** — this file stays one file, or does the seam
   justify splitting `index.html`? My recommendation: **keep it one file.**
   The seam is one module; splitting 22k lines into a module graph buys you a
   build step and costs you the zero-friction share-the-file property that the
   whole prototype depends on.
4. **Host** — Supabase is managed; the Node service needs somewhere. Fly.io,
   Railway, or a free-tier VM. Roughly irrelevant at 100 users; decide on
   whichever you can debug at 11pm before a school morning.
5. **`Nativescript/`** — it is an empty directory and PROJECT.md §1 lists a
   mobile client. At this scale I would ship the PWA only and delete the
   empty directory, then revisit if the PWA install flow proves insufficient
   on the phones your classmates actually use.
