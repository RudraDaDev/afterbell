/* ===========================================================================
 * SEED — test-mode data only
 * ---------------------------------------------------------------------------
 * Runs when settings[MODE].seed is true, which is test mode and only test
 * mode. It wipes first, so a seed is idempotent and a rerun is clean.
 * =========================================================================== */

const { ObjectId } = require("mongodb");

/* Deterministic ids so a test can reference a seeded row by name rather
   than by an id it cannot know in advance. */
const ids = {
  rudra: new ObjectId(),
  meera: new ObjectId(),
  arjun: new ObjectId(),
  zoya: new ObjectId(),
};

const CODES = [
  { code: "DEMO-AAAA-1111", invitedBy: "Rudra Chitambare" },
  { code: "DEMO-BBBB-2222", invitedBy: "Rudra Chitambare" },
  { code: "DEMO-CCCC-3333", invitedBy: "Rudra Chitambare" },
  { code: "DEMO-DDDD-4444", invitedBy: "Rudra Chitambare" },
  { code: "DEMO-EEEE-5555", invitedBy: "Rudra Chitambare" },
];

async function seed(db, settings) {
  const col = (n) => db.collection(n);
  await Promise.all([
    col("users").deleteMany({}),
    col("sessions").deleteMany({}),
    col("invite_codes").deleteMany({}),
    col("posts").deleteMany({}),
    col("comments").deleteMany({}),
    col("post_likes").deleteMany({}),
    col("mod_log").deleteMany({}),
    col("rejected_hashes").deleteMany({}),
  ]);

  const now = Date.now();
  const mins = (m) => new Date(now - m * 60000);

  await col("users").insertMany([
    {
      _id: ids.rudra,
      handle: "rudra.c",
      name: "Rudra Chitambare",
      section: "7-A",
      role: "admin",
      badges: ["Founder"],
      avatar: "g1",
      verified: true,
      createdAt: mins(100000),
    },
    {
      _id: ids.meera,
      handle: "meera",
      name: "Meera Joshi",
      section: "7-B",
      role: "mod",
      badges: ["Moderator"],
      avatar: "g2",
      verified: true,
      createdAt: mins(90000),
    },
    {
      _id: ids.arjun,
      handle: "arjun.m",
      name: "Arjun Mehta",
      section: "7-B",
      role: "student",
      badges: [],
      avatar: "g3",
      verified: true,
      createdAt: mins(80000),
    },
    {
      _id: ids.zoya,
      handle: "zoya.k",
      name: "Zoya Khan",
      section: "7-C",
      role: "student",
      badges: [],
      avatar: "g4",
      verified: true,
      createdAt: mins(70000),
    },
  ]);

  await col("invite_codes").insertMany(
    CODES.map((c) => ({
      code: c.code,
      state: "unused",
      invitedBy: c.invitedBy,
      version: 0,
      createdAt: mins(60000),
    })),
  );

  await col("posts").insertMany([
    {
      _id: new ObjectId(),
      userId: ids.arjun,
      handle: "arjun.m",
      body: "canteen samosa went from 12 to 18 in one year and somehow got smaller.",
      t: 38,
      createdAt: mins(38),
      status: "approved",
      approvedAt: mins(37),
      approvedBy: ids.meera,
      boost: false,
      boostUntil: null,
      kind: "text",
      reports: 0,
    },
    {
      _id: new ObjectId(),
      userId: ids.zoya,
      handle: "zoya.k",
      body: "sports day practice at 6:40am. the ground is a swamp. coach said no excuses.",
      t: 96,
      createdAt: mins(96),
      status: "approved",
      approvedAt: mins(95),
      approvedBy: ids.meera,
      boost: false,
      boostUntil: null,
      kind: "text",
      reports: 0,
    },
    /* one deliberately left pending, so the queue is never empty in tests */
    {
      _id: new ObjectId(),
      userId: ids.arjun,
      handle: "arjun.m",
      body: "does anybody have the physics notes from thursday?",
      t: 4,
      createdAt: mins(4),
      status: "pending",
      approvedAt: null,
      approvedBy: null,
      boost: false,
      boostUntil: null,
      kind: "text",
      reports: 0,
    },
  ]);

  const posts = await col("posts").find({ status: "approved" }).toArray();
  await col("comments").insertMany([
    {
      postId: posts[0]._id,
      parentId: null,
      userId: ids.zoya,
      handle: "zoya.k",
      body: "the smaller part is the real crime here",
      t: 30,
      createdAt: mins(30),
      reports: 0,
    },
    {
      postId: posts[0]._id,
      parentId: null,
      userId: ids.meera,
      handle: "meera",
      body: "i have the receipt from last year if anyone wants proof",
      t: 25,
      createdAt: mins(25),
      reports: 0,
    },
  ]);
  const first = await col("comments").findOne({ handle: "zoya.k" });
  await col("comments").insertOne({
    postId: posts[0]._id,
    parentId: first._id,
    userId: ids.arjun,
    handle: "arjun.m",
    body: "yes please, that would settle it",
    t: 20,
    createdAt: mins(20),
    reports: 0,
  });

  if (settings && settings.MODE === "test")
    console.log(
      "seeded: 4 users, %d invite codes, 3 posts, 3 comments",
      CODES.length,
    );
}

module.exports = { seed, ids, CODES };
