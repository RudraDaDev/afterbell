/* ===========================================================================
 * AUTH — opaque bearer tokens, stored server-side
 * ---------------------------------------------------------------------------
 * Not JWT. For ~100 users the sessions collection is cheaper than the key
 * management, and it gives you revocation for free: delete the row, the
 * token is dead. A JWT would need a rotation story nobody will maintain.
 * =========================================================================== */

const crypto = require("crypto");
const { ObjectId } = require("mongodb");

const SESSION_DAYS_DEFAULT = 30;

function newToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function expiry(days) {
  return new Date(Date.now() + (days || SESSION_DAYS_DEFAULT) * 864e5);
}

async function createSession(db, userId, days) {
  const token = newToken();
  const doc = {
    token,
    userId: new ObjectId(userId),
    createdAt: new Date(),
    expiresAt: expiry(days),
  };
  await db.collection("sessions").insertOne(doc);
  return { token, expiresAt: doc.expiresAt };
}

async function destroySession(db, token) {
  await db.collection("sessions").deleteOne({ token });
}

/* The db is read from the request, not captured at build time — the app
   factory builds the router before the connection exists. */
const dbOf = (req) => req.app.get("db");

/* Express middleware. Attaches req.user and req.session on success,
   responds 401 itself on failure so no handler has to remember to check. */
function requireAuth() {
  return async (req, res, next) => {
    try {
      const db = dbOf(req);
      const h = req.headers.authorization || "";
      const token = h.startsWith("Bearer ") ? h.slice(7).trim() : null;
      if (!token) return res.status(401).json({ error: "no_token" });

      const s = await db.collection("sessions").findOne({ token });
      if (!s) return res.status(401).json({ error: "bad_token" });
      if (s.expiresAt < new Date())
        return res.status(401).json({ error: "expired_token" });

      const user = await db.collection("users").findOne(
        { _id: s.userId },
        {
          projection: {
            handle: 1,
            name: 1,
            section: 1,
            role: 1,
            badges: 1,
            avatar: 1,
          },
        },
      );
      if (!user) return res.status(401).json({ error: "gone_user" });

      req.user = user;
      req.session = s;
      next();
    } catch (e) {
      next(e);
    }
  };
}

/* Optional: for endpoints that behave differently when signed in, but are
   not wrong when signed out. Never use this where identity matters. */
function optionalAuth() {
  return async (req, res, next) => {
    try {
      const db = dbOf(req);
      const h = req.headers.authorization || "";
      const token = h.startsWith("Bearer ") ? h.slice(7).trim() : null;
      if (token) {
        const s = await db.collection("sessions").findOne({ token });
        if (s && s.expiresAt >= new Date()) {
          req.user = await db.collection("users").findOne({ _id: s.userId });
          req.session = s;
        }
      }
    } catch (e) {
      /* an optional identity failing is not an error */
    }
    next();
  };
}

/* PROJECT.md 6: a moderator cannot act on their own content. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "no_token" });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: "forbidden", need: roles });
    next();
  };
}

module.exports = {
  newToken,
  createSession,
  destroySession,
  requireAuth,
  optionalAuth,
  requireRole,
};
