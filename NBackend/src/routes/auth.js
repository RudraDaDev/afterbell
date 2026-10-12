/* ===========================================================================
 * ROUTES · auth  (PROJECT.md 2 — invite only, single use, burns on use)
 * =========================================================================== */

const express = require("express");
const { ObjectId } = require("mongodb");
const { createSession, destroySession, requireAuth } = require("../auth");

const router = express.Router();

const HANDLE_RE = /^[a-z0-9._]{3,24}$/;

/* POST /auth/redeem
 * { code, handle, name, section }
 *
 * The burn is a conditional update, not a find-then-write:
 *   updateOne({ code, state: "unused" }, { $set: { state: "used", ... } })
 * If it matched 0 documents the code was already taken, and we say so.
 * Two people pasting the same code at the same instant both hit the
 * database; only one of them wins. No application-level lock required.
 */
router.post("/redeem", async (req, res, next) => {
  try {
    const { code, handle, name, section } = req.body || {};
    if (!code || typeof code !== "string")
      return res.status(400).json({ error: "code_required" });

    const h = String(handle || "").trim().toLowerCase();
    if (!HANDLE_RE.test(h))
      return res.status(400).json({
        error: "bad_handle",
        note: "3 to 24 characters: letters, numbers, dot, underscore.",
      });
    const n = String(name || "").trim();
    if (!n || n.length > 60)
      return res.status(400).json({ error: "bad_name" });

    const db = req.app.get("db");
    const settings = req.app.get("settings");

    /* a handle is taken forever, even after the account is removed.
       this is what stops someone registering as a classmate. */
    const taken = await db.collection("users").findOne({ handle: h });
    if (taken) return res.status(409).json({ error: "handle_taken" });

    const now = new Date();
    const burn = await db.collection("invite_codes").findOneAndUpdate(
      { code: String(code).trim().toUpperCase(), state: "unused" },
      {
        $set: { state: "used", usedAt: now, usedByHandle: h },
        $inc: { version: 1 },
      },
      { returnDocument: "after" },
    );
    if (!burn)
      return res.status(403).json({
        error: "code_invalid",
        note: "Codes are single use and burn the moment they are typed.",
      });

    const user = {
      handle: h,
      name: n,
      section: String(section || "").trim() || "7-A",
      /* PROJECT.md 2: admin verifies by hand before a code is issued, so the
         person redeeming is already known. Nothing here is auto-approved. */
      role: "student",
      badges: [],
      avatar: "g1",
      verified: true,
      invitedBy: burn.invitedBy || null,
      createdAt: now,
      /* PROJECT.md 11 / privacy: the details collected at the gate are kept
         only as far as the row above needs them. Nothing else is stored. */
    };
    const ins = await db.collection("users").insertOne(user);

    const ses = await createSession(db, ins.insertedId, settings.session.days);

    await db.collection("mod_log").insertOne({
      contentId: "u-" + ins.insertedId,
      kind: "invite_redeemed",
      action: "redeem",
      reason: "code " + burn.code,
      modId: null,
      createdAt: now,
    });

    res.status(201).json({
      token: ses.token,
      expiresAt: ses.expiresAt,
      user: { id: String(ins.insertedId), ...user },
    });
  } catch (e) {
    if (e && e.code === 11000)
      return res.status(409).json({ error: "handle_taken" });
    next(e);
  }
});

/* POST /auth/dev-login — TEST MODE ONLY.
 *
 * The seeded fixtures (rudra.c admin, meera mod) have no password, because
 * the real product has no password either — the invite code IS the credential.
 * But redeeming a code always creates a fresh *student*, so there is no way
 * to exercise the moderator flow without either hand-editing a row or
 * shipping a second credential type the product does not want.
 *
 * This endpoint exists so the localhost test can sign in as a seeded mod.
 * It refuses to run outside test mode, so it cannot reach production. */
router.post("/dev-login", async (req, res, next) => {
  try {
    const settings = req.app.get("settings");
    if (settings.MODE !== "test")
      return res.status(404).json({ error: "not_found" });

    const handle = String((req.body || {}).handle || "").trim().toLowerCase();
    const db = req.app.get("db");
    const user = await db.collection("users").findOne({ handle });
    if (!user)
      return res.status(404).json({
        error: "no_such_user",
        note: "Test mode seeds rudra.c (admin), meera (mod), arjun.m, zoya.k.",
      });

    const ses = await createSession(db, user._id, settings.session.days);
    res.json({
      token: ses.token,
      expiresAt: ses.expiresAt,
      user: publicUser(user),
      dev: true,
    });
  } catch (e) {
    next(e);
  }
});

/* GET /me */
router.get("/me", requireAuth(), (req, res) => {
  res.json({ user: publicUser(req.user) });
});

/* POST /auth/logout — kills the token. cheap, and the right default. */
router.post("/logout", requireAuth(), async (req, res, next) => {
  try {
    await destroySession(req.app.get("db"), req.session.token);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

function publicUser(u) {
  return {
    id: String(u._id),
    handle: u.handle,
    name: u.name,
    section: u.section,
    role: u.role,
    badges: u.badges || [],
    avatar: u.avatar || "g1",
  };
}

module.exports = router;
