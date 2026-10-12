/* ===========================================================================
 * COMMENTS — self referencing tree, fetched in one pass  (PROJECT.md 7)
 * =========================================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");
const { startApp, signIn } = require("./helpers");

async function approvedPost(app) {
  return app.db.collection("posts").findOne({ status: "approved" });
}

test("the whole tree comes back in one response, nested by parent", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const post = await approvedPost(app);
  const r = await app.call("GET", "/posts/" + post._id + "/comments");
  assert.equal(r.status, 200);

  /* seeded: two top level comments, the second one has a reply */
  assert.equal(r.body.comments.length, 2);
  const withReply = r.body.comments.find((c) => c.replies.length > 0);
  assert.ok(withReply, "expected a nested reply");
  assert.equal(withReply.replies.length, 1);
  assert.equal(withReply.replies[0].body, "yes please, that would settle it");
  assert.equal(withReply.replies[0].parent, withReply.id);
  assert.equal(r.body.total, 3, "flat count must still be reported");
});

test("a reply whose parent is on a different post is refused", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { token } = await signIn(app);

  const posts = await app.db.collection("posts").find({ status: "approved" }).toArray();
  const comment = await app.db.collection("comments").findOne({ postId: posts[0]._id });

  /* grafting a reply onto someone else's thread is a data integrity bug */
  const r = await app.call("POST", "/posts/" + posts[1]._id + "/comments", {
    token,
    body: { body: "a reply on the wrong post", parentId: String(comment._id) },
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "parent_not_on_post");
});

test("replies to a reply are allowed and still nest correctly", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { token } = await signIn(app);

  const post = await approvedPost(app);
  const list = await app.call("GET", "/posts/" + post._id + "/comments");
  const root = list.body.comments[0];

  const made = await app.call("POST", "/posts/" + post._id + "/comments", {
    token,
    body: { body: "a second level reply", parentId: root.id },
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.comment.parent, root.id);

  const after = await app.call("GET", "/posts/" + post._id + "/comments");
  const found = after.body.comments.find((c) => c.id === root.id);
  assert.equal(found.replies.length, 2, "both replies must sit under the same parent");
});

test("a comment goes through the same gate as a post, before storage", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { token } = await signIn(app);

  const post = await approvedPost(app);
  const before = await app.db.collection("comments").countDocuments();

  const r = await app.call("POST", "/posts/" + post._id + "/comments", {
    token,
    body: { body: "you are a nigger" },
  });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, "blocked_at_gate");
  assert.equal(
    await app.db.collection("comments").countDocuments(),
    before,
    "a blocked comment reached the database",
  );
});

test("an empty comment, an over-long comment and a bad parent are all refused", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { token } = await signIn(app);

  const post = await approvedPost(app);
  const base = "/posts/" + post._id + "/comments";

  assert.equal((await app.call("POST", base, { token, body: { body: "   " } })).status, 400);

  const long = await app.call("POST", base, {
    token,
    body: { body: "a".repeat(app.settings.content.maxCommentLen + 1) },
  });
  assert.equal(long.status, 400);
  assert.equal(long.body.error, "too_long");

  assert.equal(
    (await app.call("POST", base, { token, body: { body: "ok", parentId: "not-an-objectid" } })).status,
    400,
  );
  assert.equal(
    (await app.call("POST", base, { token, body: { body: "ok", parentId: "507f1f77bcf86cd799439011" } })).status,
    400,
    "a parent id that is well formed but not on this post must fail",
  );
});

test("commenting requires a token", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const post = await approvedPost(app);
  const r = await app.call("POST", "/posts/" + post._id + "/comments", {
    body: { body: "anonymous comment" },
  });
  assert.equal(r.status, 401);
});

test("a comment on a post that does not exist is a 404", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());
  const { token } = await signIn(app);
  const r = await app.call("POST", "/posts/507f1f77bcf86cd799439011/comments", {
    token,
    body: { body: "into the void" },
  });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "post_not_found");
});
