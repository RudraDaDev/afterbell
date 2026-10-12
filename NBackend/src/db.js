/* ===========================================================================
 * DB — one resolver, two modes
 * ---------------------------------------------------------------------------
 * test: mongodb-memory-server. a throwaway mongod, seeded, wiped on stop.
 * prod: whatever settings.prod.mongoUri points at.
 * =========================================================================== */

const { MongoClient } = require("mongodb");
const { MongoMemoryServer } = require("mongodb-memory-server");

/* Every collection this slice uses, with the indexes the queries need.
   Indexes are created idempotently on boot — never by hand later. */
async function ensureIndexes(db) {
  await Promise.all([
    db.collection("users").createIndex({ handle: 1 }, { unique: true }),
    db.collection("users").createIndex({ role: 1 }),
    db.collection("sessions").createIndex({ token: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    /* conditional single-use: a redeemed code is found and flipped in one
       atomic update, so two concurrent redeems cannot both win. */
    db.collection("invite_codes").createIndex({ code: 1 }, { unique: true }),
    db.collection("posts").createIndex({ createdAt: -1 }),
    db.collection("posts").createIndex({ userId: 1, createdAt: -1 }),
    db.collection("posts").createIndex({ status: 1, createdAt: -1 }),
    db.collection("comments").createIndex({ postId: 1, createdAt: 1 }),
    db.collection("comments").createIndex({ parentId: 1 }),
    db.collection("post_likes").createIndex({ postId: 1, userId: 1 }, { unique: true }),
    db.collection("mod_log").createIndex({ contentId: 1, createdAt: -1 }),
    db.collection("mod_log").createIndex({ modId: 1, createdAt: -1 }),
  ]);
}

async function open(settings) {
  const isTest = settings.MODE === "test";
  const cfg = isTest ? settings.test : settings.prod;

  let mem = null;
  let uri = cfg.mongoUri;

  if (!uri) {
    if (!isTest)
      throw new Error(
        "settings.prod.mongoUri is empty. Set MONGO_URI or edit settings.js.",
      );
    mem = await MongoMemoryServer.create();
    uri = mem.getUri("afterbell");
  }

  const client = new MongoClient(uri, {
    /* a school app on a school wifi. fail fast rather than hang a request. */
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
  });
  await client.connect();

  /* the db name is part of the uri in prod; force one for the memory server */
  const db = client.db(isTest && !cfg.mongoUri ? "afterbell-test" : undefined);
  await ensureIndexes(db);

  return {
    db,
    client,
    mem,
    mode: settings.MODE,
    async close() {
      await client.close().catch(() => {});
      if (mem) await mem.stop().catch(() => {});
    },
  };
}

module.exports = { open, ensureIndexes };
