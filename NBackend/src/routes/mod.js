/* ===========================================================================
 * ROUTES · moderation  (PROJECT.md 4, 6)
 * ---------------------------------------------------------------------------
 * Queue, approve, reject, and the append-only action log. Every action is
 * written to mod_log with moderator id, content id, action, reason and
 * timestamp — and nothing anywhere updates or deletes a log row.
 * =========================================================================== */

const express = require("express");
const { ObjectId } = require("mongodb");
const { requireAuth, requireRole } = require("../auth");

const router = express.Router();

const oid = (s) => {
  try {
    return new ObjectId(s);
  } catch (e) {
    return null;
  }
};

/* append-only. if a future change makes this look like it needs an update,
   the answer is a new row, not a mutation. */
async function log(db, entry) {
  await db.collection("mod_log").insertOne({ ...entry, createdAt: new Date() });
}

/* GET /mod/queue — everything waiting, oldest first. */
router.get("/queue", requireAuth(), requireRole("mod", "admin"), async (req, res, next) => {
  try {
    const db = req.app.get("db");
    const rows = await db
      .collection("posts")
      .aggregate([
        { $match: { status: { $in: ["pending", "flagged"] } } },
        { $sort: { createdAt: 1 } },
        { $limit: 100 },
        {
          $lookup: {
            from: "users",
            localField: "userId",
            foreignField: "_id",
            as: "_author",
          },
        },
        { $unwind: { path: "$_author", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            body: 1,
            createdAt: 1,
            status: 1,
            reports: 1,
            approvals: 1,
            handle: "$_author.handle",
            name: "$_author.name",
          },
        },
      ])
      .toArray();

    res.json({
      queue: rows.map((r) => ({
        id: String(r._id),
        body: r.body,
        uid: r.handle || "?",
        name: r.name || "?",
        status: r.status,
        reports: r.reports || 0,
        approvals: r.approvals || [],
        createdAt: r.createdAt,
        /* PROJECT.md 6: a mod cannot act on their own content. The check is
           server side and re-evaluated per row, so a client cannot hide it. */
        self: req.user && r.handle === req.user.handle,
      })),
    });
  } catch (e) {
    next(e);
  }
});

/* POST /mod/posts/:id/approve
 * PROJECT.md 6: flagged or borderline content needs TWO separate moderators.
 * The counter is stored on the row; the second distinct approval promotes. */
router.post("/posts/:id/approve", requireAuth(), requireRole("mod", "admin"), async (req, res, next) => {
  try {
    const db = req.app.get("db");
    const settings = req.app.get("settings");
    const _id = oid(req.params.id);
    if (!_id) return res.status(400).json({ error: "bad_id" });

    const post = await db.collection("posts").findOne({ _id });
    if (!post) return res.status(404).json({ error: "not_found" });

    /* restriction rule, checked against the row and not the request */
    if (String(post.userId) === String(req.user._id))
      return res.status(403).json({
        error: "restricted",
        note: "A moderator cannot act on their own content.",
      });

    const already = (post.approvals || []).some(
      (a) => String(a.modId) === String(req.user._id),
    );
    if (already)
      return res.status(409).json({ error: "already_approved_by_you" });

    const approvals = [
      ...(post.approvals || []),
      { modId: req.user._id, at: new Date() },
    ];

    /* two-mod threshold only applies where the post is actually flagged —
       high reports, or a re-upload matching a rejected fingerprint. */
    const needsTwo =
      settings.mod.doubleApproval && ((post.reports || 0) >= 2 || post.flagged);
    const promoted = !needsTwo || approvals.length >= 2;

    await db.collection("posts").updateOne(
      { _id },
      {
        $set: promoted
          ? { status: "approved", approvedAt: new Date(), approvals }
          : { status: "flagged", approvals },
      },
    );

    await log(db, {
      contentId: "p-" + _id,
      kind: "post",
      action: promoted ? "approve" : "approve_partial",
      reason: String((req.body || {}).reason || ""),
      modId: req.user._id,
      modHandle: req.user.handle,
    });

    res.json({ status: promoted ? "approved" : "flagged", approvals: approvals.length });
  } catch (e) {
    next(e);
  }
});

/* POST /mod/posts/:id/reject
 * Also records the perceptual hash when one is supplied, so a re-upload of
 * the same clip is pre-flagged next time (PROJECT.md 4). */
router.post("/posts/:id/reject", requireAuth(), requireRole("mod", "admin"), async (req, res, next) => {
  try {
    const db = req.app.get("db");
    const _id = oid(req.params.id);
    if (!_id) return res.status(400).json({ error: "bad_id" });

    const post = await db.collection("posts").findOne({ _id });
    if (!post) return res.status(404).json({ error: "not_found" });
    if (String(post.userId) === String(req.user._id))
      return res.status(403).json({ error: "restricted" });

    const reason = String((req.body || {}).reason || "").trim();
    const hash = String((req.body || {}).hash || "").trim();

    await db.collection("posts").updateOne(
      { _id },
      { $set: { status: "rejected", rejectedAt: new Date(), rejectReason: reason } },
    );

    if (hash)
      await db.collection("rejected_hashes").updateOne(
        { h: hash },
        {
          $set: { h: hash, what: post.kind || "post", when: new Date() },
          $setOnInsert: { by: req.user.handle },
        },
        { upsert: true },
      );

    await log(db, {
      contentId: "p-" + _id,
      kind: "post",
      action: "reject",
      reason,
      modId: req.user._id,
      modHandle: req.user.handle,
    });

    res.json({ status: "rejected", fingerprinted: !!hash });
  } catch (e) {
    next(e);
  }
});

/* GET /mod/log — append only, newest first. */
router.get("/log", requireAuth(), requireRole("mod", "admin"), async (req, res, next) => {
  try {
    const db = req.app.get("db");
    const rows = await db
      .collection("mod_log")
      .find({})
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();
    res.json({
      log: rows.map((r) => ({
        contentId: r.contentId,
        kind: r.kind,
        action: r.action,
        reason: r.reason,
        by: r.modHandle || null,
        at: r.createdAt,
      })),
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
