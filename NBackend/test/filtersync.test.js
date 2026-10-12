/* ===========================================================================
 * FILTER SYNC — the anti-drift guarantee
 * ---------------------------------------------------------------------------
 * src/filter.js is a port, and ports rot. This test re-derives the word
 * lists, the leet map, the innocent whitelist and the font ranges straight
 * out of Web/index.html and fails if the server has drifted from the app.
 *
 * If this fails, someone changed the filter in the prototype and forgot
 * the gateway. The gateway is the one that counts (PROJECT.md 3).
 * =========================================================================== */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const settings = require("../settings");
const filter = require("../src/filter");
const I = filter._internals;

/* settings.WEB_INDEX is relative to the NBackend root, not to test/ */
const indexHtml = path.resolve(__dirname, "..", settings.WEB_INDEX);

test("the prototype file is where settings.js says it is", () => {
  assert.ok(
    fs.existsSync(indexHtml),
    "expected Web/index.html at " + indexHtml + " — fix settings.WEB_INDEX",
  );
});

const src = fs.readFileSync(indexHtml, "utf8");

/* pull a top-level const's initializer out of the prototype source */
function grab(name, kind) {
  const re = new RegExp("(?:const|let|var)\\s+" + name + "\\s*=\\s*", "g");
  const m = re.exec(src);
  assert.ok(m, "could not find " + name + " in index.html");
  const start = m.index + m[0].length;
  const open = src[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) {
    /* a string or regex literal — read to the terminating delimiter */
    const end = src.indexOf(open, start + 1);
    return src.slice(start, end + 1);
  }
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unbalanced " + name);
}

/* evaluate a literal safely — these are pure data, no identifiers */
function evalLiteral(text, extra) {
  return new Function(
    "SLUR_A",
    "SLUR_E",
    "return (" + text + ")",
  )(extra && extra.SLUR_A, extra && extra.SLUR_E);
}

test("FILTER_TERMS match the prototype", () => {
  const fromApp = evalLiteral(grab("FILTER_TERMS"));
  assert.deepEqual(
    I.FILTER_TERMS,
    fromApp,
    "safety list drifted — update src/filter.js",
  );
});

test("SLUR_A / SLUR_E suffixes match the prototype", () => {
  /* these are plain strings, not arrays */
  const a = grab("SLUR_A").trim().replace(/^["']|["']$/g, "");
  const e = grab("SLUR_E").trim().replace(/^["']|["']$/g, "");
  assert.equal(I.SLUR_A, a, "SLUR_A drifted");
  assert.equal(I.SLUR_E, e, "SLUR_E drifted");
});

test("SLUR_WORDS patterns match the prototype", () => {
  const fromApp = evalLiteral(grab("SLUR_WORDS"), { SLUR_A: I.SLUR_A, SLUR_E: I.SLUR_E });
  assert.deepEqual(
    I.SLUR_WORDS.map((w) => w.p),
    fromApp.map((w) => w.p),
    "slur patterns drifted — the gateway would let something through",
  );
});

test("INNOCENT whitelist matches the prototype", () => {
  const fromApp = evalLiteral(grab("INNOCENT"));
  assert.deepEqual(Object.keys(I.INNOCENT).sort(), Object.keys(fromApp).sort());
});

test("FONT_RANGES match the prototype", () => {
  const fromApp = evalLiteral(grab("FONT_RANGES"));
  assert.deepEqual(I.FONT_RANGES, fromApp);
});

test("LEET map matches the prototype", () => {
  const fromApp = evalLiteral(grab("LEET"));
  assert.deepEqual(Object.keys(I.LEET).sort(), Object.keys(fromApp).sort());
  for (const k of Object.keys(fromApp))
    assert.equal(I.LEET[k], fromApp[k], "leet mapping for " + k + " drifted");
});

test("SLUR_HIT and FONT_HIT labels match the prototype", () => {
  const slur = grab("SLUR_HIT").trim().replace(/^["']|["']$/g, "");
  const font = grab("FONT_HIT").trim().replace(/^["']|["']$/g, "");
  assert.equal(I.SLUR_HIT, slur);
  assert.equal(I.FONT_HIT, font);
});

test("the gateway still blocks every spelling it used to", () => {
  const spellings = [
    "nigger",
    "nigga",
    "n1gg3r",
    "n i g g e r",
    "n.i.g.g.e.r",
    "НИГГЕР",
    "baniggas",
    "neygger",
    "nugger",
    "niggz",
    "nig",
  ];
  for (const s of spellings) {
    const v = filter.check(s);
    assert.ok(v.blocked, "gate let through: " + JSON.stringify(s));
    assert.ok(v.reasons.includes(I.SLUR_HIT), "wrong reason for " + s);
  }
});

test("the gateway still lets the innocent words through", () => {
  const innocent = [
    "manga",
    "snigger",
    "nigeria",
    "nigerian",
    "nagasaki",
    "nagpur",
    "niggle",
    "niggling",
    "passing",
    "passage",
    "assassin",
    "the asset improved",
    "assistants",
    "annihilate",
    "thug",
    "what the fuck", // swear tiers are reader side, never a gate
    "this is shit",
  ];
  for (const s of innocent) {
    const v = filter.check(s);
    assert.ok(!v.blocked, "false positive on " + JSON.stringify(s) + " -> " + v.reasons.join(","));
  }
});
