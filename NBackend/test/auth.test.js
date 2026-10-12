/* ===========================================================================
 * AUTH — invite only, single use, burns on use  (PROJECT.md 2)
 * =========================================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");
const { startApp, signIn } = require("./helpers");

test("redeem burns the code, and the code cannot be used twice", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const first = await app.call("POST", "/auth/redeem", {
    body: { code: "DEMO-BBBB-2222", handle: "arjun.t", name: "Arjun Test", section: "7-B" },
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.ok(first.body.token, "expected a bearer token back");

  const second = await app.call("POST", "/auth/redeem", {
    body: { code: "DEMO-BBBB-2222", handle: "someone.else", name: "Someone Else" },
  });
  assert.equal(second.status, 403, "a burned code must not work again");
  assert.equal(second.body.error, "code_invalid");

  /* the row is actually marked used, not just rejected in memory */
  const row = await app.db.collection("invite_codes").findOne({ code: "DEMO-BBBB-2222" });
  assert.equal(row.state, "used");
  assert.equal(row.usedByHandle, "arjun.t");
});

test("unknown code is rejected without creating anything", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const before = await app.db.collection("users").countDocuments();
  const r = await app.call("POST", "/auth/redeem", {
    body: { code: "NOPE-0000-0000", handle: "ghost.user", name: "Ghost" },
  });
  assert.equal(r.status, 403);
  assert.equal(await app.db.collection("users").countDocuments(), before);
});

test("a handle cannot be taken twice", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  await app.call("POST", "/auth/redeem", {
    body: { code: "DEMO-AAAA-1111", handle: "rudra.c", name: "Impostor" },
  }).then((r) => assert.equal(r.status, 409, "rudra.c is already seeded"));

  const r2 = await app.call("POST", "/auth/redeem", {
    body: { code: "DEMO-CCCC-3333", handle: "rudra.c", name: "Impostor Again" },
  });
  assert.equal(r2.status, 409);
  assert.equal(r2.body.error, "handle_taken");
});

test("handle format is validated", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  for (const bad of ["", "ab", "has space", "UPPER CASE!!", "x".repeat(30)]) {
    const r = await app.call("POST", "/auth/redeem", {
      body: { code: "DEMO-DDDD-4444", handle: bad, name: "Test" },
    });
    assert.equal(r.status, 400, "should reject handle " + JSON.stringify(bad));
    assert.equal(r.body.error, "bad_handle");
  }
});

test("the token is required, and a forged one is refused", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  assert.equal((await app.call("GET", "/auth/me")).status, 401);
  assert.equal((await app.call("GET", "/auth/me", { token: "not-a-real-token" })).status, 401);

  const { token } = await signIn(app, "DEMO-EEEE-5555");
  const me = await app.call("GET", "/auth/me", { token });
  assert.equal(me.status, 200);
  assert.ok(me.body.user.handle.startsWith("user"));
  assert.equal(me.body.user.name, "Test Student");
});

test("logout kills the token for good", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const { token } = await signIn(app, "DEMO-AAAA-1111");
  assert.equal((await app.call("GET", "/auth/me", { token })).status, 200);
  assert.equal((await app.call("POST", "/auth/logout", { token })).status, 200);
  assert.equal(
    (await app.call("GET", "/auth/me", { token })).status,
    401,
    "a logged-out token must be dead, not just ignored",
  );
});

test("an expired token is refused", async (t) => {
  const app = await startApp();
  t.after(() => app.stop());

  const { token } = await signIn(app, "DEMO-CCCC-3333");
  await app.db
    .collection("sessions")
    .updateOne({ token }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  const r = await app.call("GET", "/auth/me", { token });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "expired_token");
});
