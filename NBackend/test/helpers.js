/* Shared test harness. One in-memory mongo per test file, one ephemeral
   port per app, both torn down after. No fixed ports, so files run in
   parallel without colliding. */

const settings = require("../settings");
const { open } = require("../src/db");
const { createApp } = require("../src/app");

/* Force test mode regardless of what settings.js says. Editing the settings
   file must never be able to make the suite write to a real database. */
const testSettings = {
  ...settings,
  MODE: "test",
  test: { ...settings.test, seed: true, log: "silent" },
};

async function startApp() {
  const handle = await open(testSettings);
  const app = createApp(testSettings, handle.db);
  if (app.locals.ready) await app.locals.ready;
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + server.address().port;

  return {
    base,
    db: handle.db,
    settings: testSettings,
    server,
    /* thin fetch wrapper: json in, json out, status always attached */
    async call(method, path, { token, body } = {}) {
      const headers = { "Content-Type": "application/json" };
      if (token) headers.Authorization = "Bearer " + token;
      const r = await fetch(base + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let json = null;
      try {
        json = await r.json();
      } catch (e) {
        /* some responses are empty on purpose */
      }
      return { status: r.status, body: json };
    },
    async stop() {
      await new Promise((r) => server.close(r));
      await handle.close();
    },
  };
}

/* redeem the first unused seeded code and return { token, user } */
async function signIn(app, handle) {
  const r = await app.call("POST", "/auth/redeem", {
    body: {
      code: handle || "DEMO-AAAA-1111",
      handle: "user" + Math.random().toString(36).slice(2, 8),
      name: "Test Student",
      section: "7-A",
    },
  });
  if (r.status !== 201)
    throw new Error("signIn failed: " + r.status + " " + JSON.stringify(r.body));
  return { token: r.body.token, user: r.body.user };
}

/* Test-only shortcut: attach a session to an already-seeded account so the
   moderation tests can act as the seeded mod and admin without burning an
   invite code on them. This writes a session row directly on purpose — it
   is not a production path and is not exported from src/. */
async function signAs(app, handle) {
  const { createSession } = require("../src/auth");
  const user = await app.db.collection("users").findOne({ handle });
  if (!user) throw new Error("no seeded user " + handle);
  const ses = await createSession(app.db, user._id, 30);
  return { token: ses.token, user };
}

module.exports = { startApp, signIn, signAs, testSettings };
