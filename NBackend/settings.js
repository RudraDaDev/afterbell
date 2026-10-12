/* ===========================================================================
 * AFTERBELL BACKEND — SETTINGS
 * ---------------------------------------------------------------------------
 * This is the only file you need to touch to switch between test and prod.
 *
 *   MODE = "test"  ->  ephemeral in-memory MongoDB. Fresh database on every
 *                      boot, auto-seeded, wiped on shutdown. Nothing you do
 *                      here can break anything real. Safe to run a thousand
 *                      times.
 *
 *   MODE = "prod"  ->  your real MongoDB, seeded only if you say so, refusing
 *                      to boot if the JWT secret is still the placeholder.
 *
 * Everything below is commented. If a setting is not obvious, it is wrong.
 * =========================================================================== */

const MODE = "test"; // <--- flip this to "prod" when you deploy

/* ---------------------------------------------------------------------------
 * Path of the Web prototype. Used by the filter sync test to prove the
 * server's blocked-word list has not drifted from the front-end's.
 * ------------------------------------------------------------------------- */
const WEB_INDEX =
  "../Web/index.html";

module.exports = {
  MODE,
  WEB_INDEX,

  /* ---------------------------- network ---------------------------- */
  port: process.env.PORT || 4000,
  host: "127.0.0.1",

  /* --------------------------- test / prod -------------------------- */
  test: {
    /* null -> mongodb-memory-server downloads and runs a throwaway mongod.
       Set a real URI here if you would rather test against a scratch
       database on a real server. */
    mongoUri: null,
    /* wipe and reseed on every boot. keep true. */
    seed: true,
    /* fail loudly rather than silently skipping a test. */
    strict: true,
    log: "verbose",
  },

  prod: {
    /* Prefer MONGO_URI from the environment over a literal here, so a
       real password never lands in a file you might commit. */
    mongoUri: process.env.MONGO_URI || "mongodb://127.0.0.1:27017/afterbell",
    /* Seeding writes demo rows into your real database. Leave false. */
    seed: false,
    log: "normal",
    /* Comma separated, or ["*"] to allow any origin (PWA on a phone has an
       opaque origin, so ["*"] is usually correct for this deployment). */
    corsOrigins: (process.env.CORS_ORIGINS || "*").split(",").map((s) => s.trim()),
  },

  /* ----------------------------- auth ------------------------------- */
  session: {
    /* Days before a bearer token expires. */
    days: 30,
    /* A redeemed invite code burns immediately and cannot be reused.
       This is enforced in the database with a conditional update, not in
       application code, so two concurrent redeems cannot both win. */
    burnOnRedeem: true,
  },

  /* ---------------------------- content ----------------------------- */
  content: {
    /* Characters. The prototype caps a post at 500; keep them equal. */
    maxPostLen: 500,
    maxCommentLen: 400,
    /* PROJECT.md 11: 30 day auto-delete so R2/Atlas stay inside free tier. */
    retentionDays: 30,
    /* Nothing goes live until a moderator approves it (PROJECT.md 4). */
    postsPendingByDefault: true,
  },

  /* --------------------------- moderation --------------------------- */
  mod: {
    /* PROJECT.md 3: hide anything unapproved after this many minutes. */
    sweepAfterMinutes: 30,
    /* PROJECT.md 6: borderline content needs two separate moderators. */
    doubleApproval: true,
    /* Append-only. Nothing updates or deletes rows in mod_log. */
    appendOnlyLog: true,
  },

  /* ----------------------------- filter ----------------------------- */
  /* PROJECT.md 3, layer 1: rejected at the gateway, never stored.
     The lists themselves live in src/filter.js and are copied from the
     front-end. This only controls what the gateway does with a hit. */
  filter: {
    /* Slurs are hard blocked at the gate in every spelling. */
    blockSlurs: true,
    /* Stylised Unicode (font-generator paste) is hard blocked at the gate,
       because it exists only to get past the reader-side filter. */
    blockStyledFonts: true,
    /* The swear tiers are READER SIDE ONLY. They change what a person reads,
       they never block a post. Turning this on would silently break the
       product's own rule, so it stays false. */
    blockSwearTiers: false,
    /* FILTER_TERMS (nudes, drugs, phone number, address...) are a safety
       list, not a swearing list. Blocked at the gate. */
    blockSafetyTerms: true,
    /* Return the matched words in the 4xx so the composer can explain why.
       Never log them. */
    echoReasons: true,
  },
};
