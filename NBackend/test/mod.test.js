/* ===========================================================================
 * MODERATION — restriction rule, two-mod threshold, append-only log
 * (PROJECT.md 4, 6)
 * =========================================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");
const { ObjectId } = require("mongodb");
const { startApp, signIn, signAs } = require("./helpers");

/* a student's post, waiting in the queue */
async function pendingPost(app, userId) {
  const _id = new ObjectId();
  await app.db.collection("posts").insertOne({
    _id,
    userId,
    handle: "arjun.m",
    body: "a post waiting for review",
    t: 1,
    createdAt: new Date(),
    status: "pending",
    approvedAt: null,
    boost: false,
    kind: "text",
    reports: 0,
  });
  return _id;
}

test("only a mod or admin can reach the queue", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const student = await signIn(app);
  assert.equal((await app.call("GET", "/mod/queue", { token: student.token })).status, 403);

  const mod = await signAs(app, "meera");
  const r = await app.call("GET", "/mod/queue", { token: mod.token });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.queue));
  assert.ok(r.body.queue.length >= 1, "the seeded pending post should be waiting");

  /* unsigned is 401, not 403 — the role check needs an identity first */
  assert.equal((await app.call("GET", "/mod/queue")).status, 401);
});

test("a moderator cannot act on their own content", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const mod = await signAs(app, "meera");
  const mine = await pendingPost(app, mod.user._id);

  const r = await app.call("POST", "/mod/posts/" + mine + "/approve", { token: mod.token });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "restricted");
  assert.ok(r.body.note.includes("own content"));

  const row = await app.db.collection("posts").findOne({ _id: mine });
  assert.equal(row.status, "pending", "the restriction must actually hold");
});

test("a single approval promotes an ordinary post", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const mod = await signAs(app, "meera");
  const arjun = await app.db.collection("users").findOne({ handle: "arjun.m" });
  const pid = await pendingPost(app, arjun._id);

  const r = await app.call("POST", "/mod/posts/" + pid + "/approve", {
    token: mod.token,
    body: { reason: "fine by me" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "approved");

  const row = await app.db.collection("posts").findOne({ _id: pid });
  assert.equal(row.status, "approved");
  assert.equal(row.approvals.length, 1);
  assert.equal(String(row.approvals[0].modId), String(mod.user._id));
});

test("flagged content needs TWO separate moderators", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const meera = await signAs(app, "meera");
  const rudra = await signAs(app, "rudra.c");
  const arjun = await app.db.collection("users").findOne({ handle: "arjun.m" });

  /* reported twice -> the two-mod threshold applies */
  const pid = await pendingPost(app, arjun._id);
  await app.db.collection("posts").updateOne({ _id: pid }, { $set: { reports: 3 } });

  const first = await app.call("POST", "/mod/posts/" + pid + "/approve", { token: meera.token });
  assert.equal(first.status, 200);
  assert.equal(first.body.status, "flagged", "one approval must not be enough");
  assert.equal(first.body.approvals, 1);

  const stillWaiting = await app.call("GET", "/mod/queue", { token: rudra.token });
  assert.ok(stillWaiting.body.queue.some((q) => q.id === String(pid)));

  /* the SAME moderator approving twice must not count as two */
  const repeat = await app.call("POST", "/mod/posts/" + pid + "/approve", { token: meera.token });
  assert.equal(repeat.status, 409);
  assert.equal(repeat.body.error, "already_approved_by_you");

  const second = await app.call("POST", "/mod/posts/" + pid + "/approve", { token: rudra.token });
  assert.equal(second.body.status, "approved");
  assert.equal(second.body.approvals, 2);

  /* and no third approval is needed or accepted as meaningful */
  const row = await app.db.collection("posts").findOne({ _id: pid });
  assert.equal(row.status, "approved");
  assert.equal(row.approvals.length, 2);
});

test("reject records a fingerprint so a reupload is pre-flagged", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const mod = await signAs(app, "meera");
  const arjun = await app.db.collection("users").findOne({ handle: "arjun.m" });
  const pid = await pendingPost(app, arjun._id);

  const r = await app.call("POST", "/mod/posts/" + pid + "/reject", {
    token: mod.token,
    body: { reason: "not school appropriate", hash: "a1b2c3d4e5f6" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "rejected");
  assert.equal(r.body.fingerprinted, true);

  const row = await app.db.collection("posts").findOne({ _id: pid });
  assert.equal(row.status, "rejected");
  assert.equal(row.rejectReason, "not school appropriate");

  /* the hash is now in the table the client checks before re-upload */
  const h = await app.db.collection("rejected_hashes").findOne({ h: "a1b2c3d4e5f6" });
  assert.ok(h, "fingerprint was not stored");
  assert.equal(h.by, "meera");
});

test("every action lands in the append-only log, and the log is never rewritten", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const mod = await signAs(app, "meera");
  const arjun = await app.db.collection("users").findOne({ handle: "arjun.m" });
  const pid = await pendingPost(app, arjun._id);

  await app.call("POST", "/mod/posts/" + pid + "/approve", {
    token: mod.token,
    body: { reason: "checked" },
  });
  await app.call("POST", "/mod/posts/" + pid + "/reject", {
    token: mod.token,
    body: { reason: "changed my mind" },
  });

  const log = await app.call("GET", "/mod/log", { token: mod.token });
  assert.equal(log.status, 200);
  const forPost = log.body.log.filter((e) => e.contentId === "p-" + pid);
  assert.ok(forPost.length >= 2, "both actions must be logged");
  assert.ok(forPost.some((e) => e.action === "approve"));
  assert.ok(forPost.some((e) => e.action === "reject"));
  for (const e of forPost) {
    assert.equal(e.by, "meera", "log must record which moderator");
    assert.ok(e.at, "log must record a timestamp");
  }

  /* append-only: a reject does not erase the approve row */
  const raw = await app.db
    .collection("mod_log")
    .find({ contentId: "p-" + pid })
    .toArray();
  assert.ok(raw.some((e) => e.action === "approve"), "the earlier row was rewritten");
});

test("the log is not readable by a student", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const student = await signIn(app);
  assert.equal((await app.call("GET", "/mod/log", { token: student.token })).status, 403);
});

test("a student cannot approve or reject", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const student = await signIn(app);
  const post = await app.db.collection("posts").findOne({ status: "pending" });
  assert.equal(
    (await app.call("POST", "/mod/posts/" + post._id + "/approve", { token: student.token })).status,
    403,
  );
  assert.equal(
    (await app.call("POST", "/mod/posts/" + post._id + "/reject", { token: student.token })).status,
    403,
  );
});
