/* ===========================================================================
 * ROUTES · comments  (PROJECT.md 7 — self referencing tree, one pass)
 * ---------------------------------------------------------------------------
 * "The full comment tree for a post is fetched and grouped by parent server
 *  side in a single pass, minimizing repeated database hits."
 *
 * That is one find() plus an in-memory group. Not N+1, not a recursive
 * lookup, not a $graphLookup — 18 comments in the seed, a few hundred at
 * worst, and the flat round trip is faster than the aggregation.
 * =========================================================================== */

const express = require("express");
const { ObjectId } = require("mongodb");
const filter = require("../filter");
const { requireAuth, optionalAuth } = require("../auth");

const router = express.Router({ mergeParams: true });

const oid = (s) => {
  try {
    return new ObjectId(s);
  } catch (e) {
    return null;
  }
};

/* GET /posts/:postId/comments
 * Flat list, grouped into a tree by parentId before it leaves the server. */
router.get("/", optionalAuth(), async (req, res, next) => {
  try {
    const db = req.app.get("db");
    const postId = oid(req.params.postId);
    if (!postId) return res.status(400).json({ error: "bad_id" });

    const rows = await db
      .collection("comments")
      .find({ postId })
      .sort({ createdAt: 1 })
      .toArray();

    /* one pass: every comment lands in its parent's bucket, or at the top
       level if it has no parent. a reply whose parent was deleted floats up
       rather than vanishing with it. */
    const byParent = {};
    for (const c of rows) {
      const k = c.parentId ? String(c.parentId) : "_root";
      (byParent[k] = byParent[k] || []).push(view(c, req.user));
    }

    const build = (list) =>
      (list || []).map((c) => ({ ...c, replies: build(byParent[c.id]) }));

    res.json({ comments: build(byParent._root), total: rows.length });
  } catch (e) {
    next(e);
  }
});

/* POST /posts/:postId/comments
 * { body, parentId? } — same gate as a post, before storage. */
router.post("/", requireAuth(), async (req, res, next) => {
  try {
    const db = req.app.get("db");
    const settings = req.app.get("settings");
    const postId = oid(req.params.postId);
    if (!postId) return res.status(400).json({ error: "bad_id" });

    const body = String((req.body || {}).body || "").trim();
    if (!body) return res.status(400).json({ error: "empty" });
    if (body.length > settings.content.maxCommentLen)
      return res.status(400).json({
        error: "too_long",
        max: settings.content.maxCommentLen,
        got: body.length,
      });

    /* same gateway, same rules, before storage. a comment is content. */
    const verdict = filter.check(body, settings.filter);
    if (verdict.blocked)
      return res.status(422).json({
        error: "blocked_at_gate",
        reasons: settings.filter.echoReasons ? verdict.reasons : ["blocked"],
        note: filter.explain(verdict),
      });

    /* PROJECT.md 7: replies attach to their parent comment. Validate the
       parent belongs to this post, or a reply could be grafted onto
       someone else's thread. */
    let parentId = null;
    const rawParent = (req.body || {}).parentId;
    if (rawParent) {
      parentId = oid(rawParent);
      if (!parentId) return res.status(400).json({ error: "bad_parent" });
      const parent = await db
        .collection("comments")
        .findOne({ _id: parentId, postId });
      if (!parent)
        return res.status(400).json({ error: "parent_not_on_post" });
    }

    const post = await db.collection("posts").findOne({ _id: postId });
    if (!post) return res.status(404).json({ error: "post_not_found" });

    const now = new Date();
    const doc = {
      postId,
      parentId,
      userId: req.user._id,
      handle: req.user.handle,
      body,
      t: Math.floor(now.getTime() / 60000),
      createdAt: now,
      reports: 0,
    };
    const ins = await db.collection("comments").insertOne(doc);
    res.status(201).json({ comment: view({ ...doc, _id: ins.insertedId }, req.user) });
  } catch (e) {
    next(e);
  }
});

function view(c, user) {
  return {
    id: String(c._id),
    post: String(c.postId),
    parent: c.parentId ? String(c.parentId) : null,
    uid: c.handle,
    body: c.body,
    t: c.t,
    createdAt: c.createdAt,
    mine: user ? String(c.userId) === String(user._id) : false,
    replies: [],
  };
}

module.exports = router;
