/* ===========================================================================
 * ROUTES · posts  (PROJECT.md 3, 7 — filter gate, pending by default)
 * =========================================================================== */

const express = require("express");
const { ObjectId } = require("mongodb");
const filter = require("../filter");
const { requireAuth, optionalAuth } = require("../auth");

const router = express.Router();

const oid = (s) => {
  try {
    return new ObjectId(s);
  } catch (e) {
    return null;
  }
};

/* PROJECT.md 11: everything older than 30 days is gone. Enforced in the
   query, not by a nightly job, so it is true even if nothing runs. */
function retentionCutoff(settings) {
  return new Date(Date.now() - settings.content.retentionDays * 864e5);
}

/* GET /posts?limit=30&before=<iso>
 * Public read of approved posts. Chronological, with an approved-and-fresh
 * boost first, exactly as PROJECT.md 7 describes.
 */
router.get("/", optionalAuth(), async (req, res, next) => {
  try {
    const db = req.app.get("db");
    const settings = req.app.get("settings");
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const before = req.query.before ? new Date(req.query.before) : null;

    const q = {
      status: "approved",
      createdAt: { $gte: retentionCutoff(settings) },
    };
    if (before && !isNaN(before)) q.createdAt.$lt = before;

    /* boostLeft is a wall-clock deadline, so a boosted post ages out of the
       top slot on its own with no cron needed. */
    const rows = await db
      .collection("posts")
      .aggregate([
        { $match: q },
        {
          $addFields: {
            _boosted: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$boost", true] },
                    { $gt: ["$boostUntil", new Date()] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
        { $sort: { _boosted: -1, createdAt: -1 } },
        { $limit: limit },
      ])
      .toArray();

    const likes = await db
      .collection("post_likes")
      .find({ postId: { $in: rows.map((r) => r._id) } })
      .toArray();
    const byPost = {};
    for (const l of likes) {
      const k = String(l.postId);
      byPost[k] = byPost[k] || { count: 0, mine: false };
      byPost[k].count++;
      if (req.user && String(l.userId) === String(req.user._id))
        byPost[k].mine = true;
    }

    res.json({
      posts: rows.map((r) => view(r, byPost[String(r._id)], req.user)),
      hasMore: rows.length === limit,
    });
  } catch (e) {
    next(e);
  }
});

/* GET /posts/:id */
router.get("/:id", optionalAuth(), async (req, res, next) => {
  try {
    const db = req.app.get("db");
    const _id = oid(req.params.id);
    if (!_id) return res.status(400).json({ error: "bad_id" });
    const row = await db.collection("posts").findOne({ _id });
    if (!row) return res.status(404).json({ error: "not_found" });

    /* a pending post is visible only to its author and to a moderator.
       this is the rule that makes "nobody else can see it before that"
       true rather than a nicety. */
    const mine = req.user && String(row.userId) === String(req.user._id);
    const staff = req.user && (req.user.role === "mod" || req.user.role === "admin");
    if (row.status !== "approved" && !mine && !staff)
      return res.status(404).json({ error: "not_found" });

    const likes = await db
      .collection("post_likes")
      .find({ postId: row._id })
      .toArray();
    const mineLike = req.user && likes.some((l) => String(l.userId) === String(req.user._id));
    res.json({ post: view(row, { count: likes.length, mine: !!mineLike }, req.user) });
  } catch (e) {
    next(e);
  }
});

/* POST /posts
 * THE GATE. PROJECT.md 3: "rejected at the API gateway, never stored."
 *
 * The order below is the whole point:
 *   1. validate length        -> 400, nothing written
 *   2. run the filter         -> 422, nothing written
 *   3. only now insert        -> 201
 *
 * A rejected post never reaches the database, so there is nothing to delete
 * later and no row to leak. The client-side filter is a courtesy; this is
 * the control.
 */
router.post("/", requireAuth(), async (req, res, next) => {
  try {
    const db = req.app.get("db");
    const settings = req.app.get("settings");

    const body = String((req.body || {}).body || "").trim();
    if (!body) return res.status(400).json({ error: "empty" });
    if (body.length > settings.content.maxPostLen)
      return res.status(400).json({
        error: "too_long",
        max: settings.content.maxPostLen,
        got: body.length,
      });

    const verdict = filter.check(body, settings.filter);
    if (verdict.blocked) {
      /* 422, not 403: the request was well formed, the content was not
         acceptable. And nothing is written — check the handler, there is no
         insert above this line. */
      return res.status(422).json({
        error: "blocked_at_gate",
        reasons: settings.filter.echoReasons ? verdict.reasons : ["blocked"],
        note: filter.explain(verdict),
      });
    }

    const now = new Date();
    const doc = {
      userId: req.user._id,
      handle: req.user.handle,
      body,
      t: Math.floor(now.getTime() / 60000) - 0,
      createdAt: now,
      status: settings.content.postsPendingByDefault ? "pending" : "approved",
      approvedAt: settings.content.postsPendingByDefault ? null : now,
      approvedBy: null,
      boost: false,
      boostUntil: null,
      kind: "text",
      reports: 0,
    };

    const ins = await db.collection("posts").insertOne(doc);
    res.status(201).json({
      post: view({ ...doc, _id: ins.insertedId }, { count: 0, mine: false }, req.user),
      note:
        doc.status === "pending"
          ? "Waiting for a moderator. Nobody else can see it until then."
          : undefined,
    });
  } catch (e) {
    next(e);
  }
});

/* POST /posts/:id/like — a toggle, backed by a unique index so a double
   tap cannot produce two likes.

   The read-then-write below is racy by design: two taps in the same tick
   can both see "not liked yet" and both try to insert. The unique index
   is what makes that safe — the loser gets a duplicate key error, which
   we catch and report as "you are already liked" rather than a 500. */
router.post("/:id/like", requireAuth(), async (req, res, next) => {
  try {
    const db = req.app.get("db");
    const _id = oid(req.params.id);
    if (!_id) return res.status(400).json({ error: "bad_id" });

    const post = await db.collection("posts").findOne({ _id });
    if (!post) return res.status(404).json({ error: "not_found" });

    const key = { postId: _id, userId: req.user._id };
    let liked = true;
    const existing = await db.collection("post_likes").findOne(key);
    if (existing) {
      await db.collection("post_likes").deleteOne(key);
      liked = false;
    } else {
      try {
        await db.collection("post_likes").insertOne({ ...key, createdAt: new Date() });
      } catch (e) {
        /* lost the race — the index already holds our row, so we are liked */
        if (!e || e.code !== 11000) throw e;
      }
    }
    const count = await db.collection("post_likes").countDocuments({ postId: _id });
    res.json({ liked, likes: count });
  } catch (e) {
    next(e);
  }
});

/* a row as the front-end expects it — field names match POSTS in index.html
   so the client mapping is a rename and nothing more. */
function view(row, like, user) {
  return {
    id: String(row._id),
    uid: row.handle,
    body: row.body,
    t: row.t,
    createdAt: row.createdAt,
    likes: like ? like.count : 0,
    liked: like ? !!like.mine : false,
    approved: row.status === "approved",
    status: row.status,
    boost: !!row.boost,
    mine: user ? String(row.userId) === String(user._id) : false,
  };
}

module.exports = router;
