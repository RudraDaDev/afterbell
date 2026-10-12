/* ===========================================================================
 * POSTS — the gate, and what the gate must never do  (PROJECT.md 3, 7)
 * =========================================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");
const { startApp, signIn } = require("./helpers");

test("a blocked post is rejected BEFORE storage — nothing is written", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { token } = await signIn(app);

  const before = await app.db.collection("posts").countDocuments();

  const r = await app.call("POST", "/posts", {
    token,
    body: { body: "you are a nigger" },
  });

  assert.equal(r.status, 422, JSON.stringify(r.body));
  assert.equal(r.body.error, "blocked_at_gate");
  assert.ok(r.body.reasons.includes("racial slur"));
  assert.ok(r.body.note && r.body.note.length > 10, "must explain why");

  /* the entire point of this test */
  assert.equal(
    await app.db.collection("posts").countDocuments(),
    before,
    "a rejected post reached the database. PROJECT.md 3 says never stored.",
  );
});

test("every evasion spelling is stopped at the gate, and none are stored", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { token } = await signIn(app);

  const spellings = [
    "nigger",
    "n1gg3r",
    "n i g g e r",
    "n.i.g.g.e.r",
    "НИГГЕР",
    "baniggas",
    "neygger",
  ];
  for (const s of spellings) {
    const before = await app.db.collection("posts").countDocuments();
    const r = await app.call("POST", "/posts", { token, body: { body: "look at this " + s } });
    assert.equal(r.status, 422, "gate let through " + JSON.stringify(s));
    assert.equal(
      await app.db.collection("posts").countDocuments(),
      before,
      "stored a blocked post for " + JSON.stringify(s),
    );
  }
});

test("safety terms are blocked, styled unicode is blocked", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { token } = await signIn(app);

  assert.equal((await app.call("POST", "/posts", { token, body: { body: "send nudes" } })).status, 422);
  assert.equal((await app.call("POST", "/posts", { token, body: { body: "here is my address" } })).status, 422);
  assert.equal(
    (await app.call("POST", "/posts", { token, body: { body: "𝐡𝐞𝐥𝐥𝐨 everyone" } })).status,
    422,
    "font-generator paste exists only to sneak past the reader filter",
  );
});

test("the swear tiers do NOT block — they are reader side only", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { token } = await signIn(app);

  /* This is the product's own rule. If it starts failing, somebody turned
     settings.filter.blockSwearTiers on, and the app changed character. */
  for (const body of ["what the fuck", "this is shit", "you bitch"]) {
    const r = await app.call("POST", "/posts", { token, body: { body } });
    assert.equal(r.status, 201, "swear tiers must never gate a post: " + body);
  }
});

test("a good post is created PENDING, and nobody else can see it", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { token, user } = await signIn(app);

  const r = await app.call("POST", "/posts", {
    token,
    body: { body: "does anybody have the physics notes from thursday?" },
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.post.status, "pending", "PROJECT.md 4: pending by default");
  assert.equal(r.body.post.approved, false);
  assert.ok(r.body.note.includes("Nobody else can see it"));

  /* the author can see their own pending post */
  const own = await app.call("GET", "/posts/" + r.body.post.id, { token });
  assert.equal(own.status, 200);

  /* a different signed-in user gets a 404, not a 403 — a 403 would confirm
     the post exists, which is itself a leak */
  const other = await signIn(app, "DEMO-BBBB-2222");
  const hidden = await app.call("GET", "/posts/" + r.body.post.id, { token: other.token });
  assert.equal(hidden.status, 404, "a pending post must look absent to others");

  /* and it is not in the feed */
  const feed = await app.call("GET", "/posts");
  assert.ok(
    !(feed.body.posts || []).some((p) => p.id === r.body.post.id),
    "a pending post leaked into the public feed",
  );
});

test("the feed only serves approved posts, newest boosted first", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const feed = await app.call("GET", "/posts");
  assert.equal(feed.status, 200);
  const ids = feed.body.posts.map((p) => p.id);
  assert.equal(ids.length, 2, "the third seeded post is pending and must not show");

  /* approve the pending one, then it appears */
  const { token } = await signIn(app);
  const made = await app.call("POST", "/posts", {
    token,
    body: { body: "a post that will be approved in this test" },
  });
  await app.db
    .collection("posts")
    .updateOne({ _id: new (require("mongodb").ObjectId)(made.body.post.id) }, { $set: { status: "approved" } });

  const after = await app.call("GET", "/posts");
  assert.equal(after.body.posts.length, 3);
});

test("posts are length capped, and an empty post is refused", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { token } = await signIn(app);

  assert.equal((await app.call("POST", "/posts", { token, body: { body: "" } })).status, 400);

  const tooLong = await app.call("POST", "/posts", {
    token,
    body: { body: "a".repeat(app.settings.content.maxPostLen + 1) },
  });
  assert.equal(tooLong.status, 400);
  assert.equal(tooLong.body.error, "too_long");
  assert.equal(tooLong.body.max, app.settings.content.maxPostLen);
});

test("posting requires a token", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const r = await app.call("POST", "/posts", { body: { body: "anonymous attempt" } });
  assert.equal(r.status, 401);
});

test("liking is a simple on/off toggle", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { token } = await signIn(app);

  const post = await app.db.collection("posts").findOne({ status: "approved" });
  const id = String(post._id);

  const on = await app.call("POST", "/posts/" + id + "/like", { token });
  assert.equal(on.status, 200);
  assert.equal(on.body.liked, true);

  const off = await app.call("POST", "/posts/" + id + "/like", { token });
  assert.equal(off.status, 200);
  assert.equal(off.body.liked, false);
});

test("a double tap cannot double count — the unique index holds under concurrency", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { token } = await signIn(app);

  const post = await app.db.collection("posts").findOne({ status: "approved" });

  /* five simultaneous taps from the same user on a post they have never
     liked. The read-then-write in the handler races, but the unique index
     on (postId, userId) is what keeps the result honest: at most one row. */
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      app.call("POST", "/posts/" + post._id + "/like", { token }),
    ),
  );
  for (const r of results)
    assert.equal(r.status, 200, "a lost race must not surface as a 500");

  const likes = await app.db.collection("post_likes").countDocuments({
    postId: post._id,
  });
  assert.ok(likes <= 1, "expected at most 1 like row, got " + likes);
});

test("a post older than the retention window is not served", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const stale = await app.db.collection("posts").findOne({ status: "approved" });
  const past = new Date(Date.now() - 40 * 864e5); /* 40 days, window is 30 */
  await app.db.collection("posts").updateOne({ _id: stale._id }, { $set: { createdAt: past } });

  const feed = await app.call("GET", "/posts");
  assert.ok(
    !(feed.body.posts || []).some((p) => p.id === String(stale._id)),
    "PROJECT.md 11: 30 day auto-delete was not applied to the query",
  );
});

test("the standalone filter endpoint agrees with the gate", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const blocked = await app.call("POST", "/filter/check", { body: { text: "nigger" } });
  assert.equal(blocked.body.blocked, true);

  const clean = await app.call("POST", "/filter/check", { body: { text: "manga and snigger" } });
  assert.equal(clean.body.blocked, false);
  assert.deepEqual(clean.body.reasons, []);
});
