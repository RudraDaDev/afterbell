/* ===========================================================================
 * SERVER — entry point
 * ---------------------------------------------------------------------------
 *   node src/server.js
 *
 * Reads settings.js, opens the database, waits for the seed, listens.
 * The seed is awaited rather than fired in the background so the first
 * request cannot race it.
 * =========================================================================== */

const settings = require("../settings");
const { open } = require("./db");
const { createApp } = require("./app");

async function main() {
  const db = await open(settings);
  const app = createApp(settings, db.db);

  /* settings.db holds the handle so close() can reach the memory server */
  app.set("dbHandle", db);

  try {
    if (app.locals.ready) await app.locals.ready;
  } catch (e) {
    console.error("startup aborted: seed failed");
    await db.close().catch(() => {});
    process.exit(1);
  }

  const server = app.listen(settings.port, settings.host, () => {
    console.log(
      "afterbell api  [%s]  http://%s:%s  db=%s",
      settings.MODE,
      settings.host,
      settings.port,
      db.mode,
    );
    if (settings.MODE === "test")
      console.log("test mode: in-memory mongo, wiped on shutdown.");
  });

  /* a clean shutdown matters in test mode — the memory server is a real
     process and leaves a port bound if it is not stopped. */
  let closing = false;
  const shutdown = (why) => {
    if (closing) return;
    closing = true;
    console.log("\nshutting down (%s)", why);
    server.close(async () => {
      await db.close().catch(() => {});
      process.exit(0);
    });
    /* do not hang forever on a stuck connection */
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.on("SIGINT", () => shutdown("sigint"));
  process.on("SIGTERM", () => shutdown("sigterm"));
}

main().catch((e) => {
  console.error("failed to start:", e && e.message ? e.message : e);
  process.exit(1);
});
