/* ===========================================================================
 * FILTER GATEWAY  (PROJECT.md 3, layer 1)
 * ---------------------------------------------------------------------------
 * Ported line-for-line from Web/index.html so the gate and the composer
 * agree. The composer's filter is a courtesy; this one is the control.
 *
 * The rule that matters: a hit only counts when it starts at a real word
 * start and ends on a real word boundary in the ORIGINAL text. That single
 * rule is what stops "manga", "snigger", "Nigeria", "asset" and "assist"
 * from tripping anything, even though their letters line up.
 *
 * test/filtersync.test.js re-derives these lists from index.html on every
 * run, so they cannot drift apart.
 * =========================================================================== */

const INVIS =
  /[­͏؜᠎​-‏‪-‮⁠-⁤⁦-⁩︀-️﻿ㅤ゠ﾠ]/;
const FONT_RANGES = [
  [0x1d400, 0x1d7ff],
  [0x1d00, 0x1d25],
  [0x1d2c, 0x1d6a],
  [0x24b6, 0x24e9],
  [0xff01, 0xff5e],
  [0x1f170, 0x1f191],
];
const COMBINING =
  /[̀-ͯ҃-҉֑-ׇֽ-׿ؐ-ؚٰٟۖ-ۭ࣓-ࣳ‿-⁀⃐-⃰︠-︯]/;
const MARKS = /\p{M}/u;

/* letters people swap in: 0o 1il 3e 4a 5s 7t, plus cyrillic twins of latin */
const LEET = {
  0: "o",
  1: "i",
  3: "e",
  4: "a",
  5: "s",
  6: "g",
  7: "t",
  8: "b",
  9: "g",
  "@": "a",
  $: "s",
  "!": "i",
  "+": "t",
  "|": "i",
  "а": "a",
  "е": "e",
  "о": "o",
  "р": "r",
  "с": "c",
  "х": "x",
  "у": "y",
  "і": "i",
  "ѕ": "s",
  "ђ": "j",
  "ԁ": "d",
  "ɡ": "g",
  /* cyrillic twins of the letters a slur is spelled with: ниггер */
  "н": "n",
  "г": "g",
  "в": "b",
  "д": "d",
  "з": "z",
  "л": "l",
  "п": "p",
  "ф": "f",
  "к": "k",
  "м": "m",
  "т": "t",
  "и": "i",
  "ё": "e",
};

/* innocent words whose letters line up with a blocked spelling. checked
   against the WHOLE word, so it still works when the word is obfuscated. */
const INNOCENT = {
  snigger: 1,
  sniggered: 1,
  sniggering: 1,
  sniggerer: 1,
  niggle: 1,
  niggling: 1,
  niggles: 1,
  niger: 1,
  nigeria: 1,
  nigerian: 1,
  nigerians: 1,
  nagasaki: 1,
  nagano: 1,
  nagoya: 1,
  nagpur: 1,
  passing: 1,
  passage: 1,
};

const FONT_HIT = "fancy font characters";
const SLUR_HIT = "racial slur";

/* safety list — not a swearing list. these are blocked at the gate. */
const FILTER_TERMS = [
  "loser",
  "kill",
  "hate you",
  "ugly",
  "fat",
  "nudes",
  "porn",
  "drugs",
  "ganja",
  "weapon",
  "knife",
  "leak",
  "phone number",
  "address",
  "caste",
  "sexy",
];

/* the slur gate: the n-word in every spelling people actually use */
const SLUR_A =
  "(?:rish|rly|ries|ring|red|rs|rz|ry|r|er|ers|ier|ies|s|h|z|y|ly|ish|ed|ing)*";
const SLUR_E = "(?:rish|rly|ries|ring|red|rs|rz|ry|r|ed|ing|s|z|y|ly)*";
const SLUR_WORDS = [
  { p: "n[a-z0-9]{0,2}g{1,4}[ae]" + SLUR_E },
  { p: "n[ai1ln]*g{1,4}e" + SLUR_E },
  { p: "n[ai1ln]*g{1,4}a" + SLUR_A },
  { p: "n[ai1ln]*g{1,4}z+" },
  { p: "n[i1]g{1,4}" },
];

const wb = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/);

function hasStyledFont(text) {
  let letter = false,
    run = 0;
  for (let i = 0; i < text.length; i++) {
    let cp = text.codePointAt(i);
    if (cp > 0xffff) i++;
    const ch = String.fromCodePoint(cp);
    if (INVIS.test(ch)) {
      letter = false;
      run = 0;
      continue;
    }
    if (COMBINING.test(ch)) {
      if (letter && ++run >= 2) return true;
      continue;
    }
    for (let k = 0; k < FONT_RANGES.length; k++)
      if (cp >= FONT_RANGES[k][0] && cp <= FONT_RANGES[k][1]) return true;
    letter = /[a-z]/i.test(ch);
    run = 0;
  }
  return false;
}

/* walk the text once into the letter-only form the patterns are written
   against. returns a char map so a hit can be reported at original offsets. */
function textScan(text) {
  const nc = [],
    tight = [],
    tmap = [],
    tstart = [];
  let start = true;
  for (let i = 0; i < text.length; i++) {
    let cp = text.codePointAt(i);
    if (cp > 0xffff) i++;
    const ch = String.fromCodePoint(cp);
    if (INVIS.test(ch)) continue; /* invisible is transparent, not a space */
    let s = ch.toLowerCase();
    if (MARKS.test(s)) s = s.normalize("NFD").replace(/\p{M}+/gu, "");
    const cp2 = s.codePointAt(0);
    if (cp2 >= 0xff01 && cp2 <= 0xff5e)
      s = String.fromCharCode(cp2 - 0xfee0);
    else if (cp2 >= 0x24b6 && cp2 <= 0x24cf)
      s = String.fromCharCode(cp2 - 0x24b6 + 65);
    else if (cp2 >= 0x24d0 && cp2 <= 0x24e9)
      s = String.fromCharCode(cp2 - 0x24d0 + 97);
    if (s.length === 1 && LEET[s] !== undefined) s = LEET[s];
    if (s.length !== 1 || !/[a-z]/.test(s)) {
      nc.push({ c: " ", o: i, sep: 1 });
      start = true;
      continue;
    }
    const at = nc.length;
    nc.push({ c: s, o: i, sep: 0 });
    tight.push(s);
    tmap.push(at);
    tstart.push(start);
    start = false;
  }
  return { nc: nc, tight: tight.join(""), tmap: tmap, tstart: tstart };
}

/* ents: [{p:regex source}]. returns original-string ranges that match.
   mid=true lets an embedded hit count when it is long — only the slur gate
   wants that, to catch "baniggas". */
function scanMatches(text, ents, re, starts, mid) {
  if (!ents.length || !text) return [];
  const sc = textScan(text);
  if (!sc.tight) return [];
  let any = false;
  for (let i = 0; i < starts.length; i++)
    if (sc.tight.indexOf(starts[i]) >= 0) {
      any = true;
      break;
    }
  if (!any) return [];
  const out = [];
  for (let j = 0; j < sc.tight.length; j++) {
    re.lastIndex = j;
    const m = re.exec(sc.tight);
    if (!m || !m[0]) continue;
    let gi = 0;
    for (let g = 1; g < m.length; g++)
      if (m[g] !== undefined) {
        gi = g - 1;
        break;
      }
    const end = j + m[0].length;
    if (end < sc.tight.length && !sc.tstart[end]) continue; /* whole word */
    if (!sc.tstart[j] && !(mid && m[0].length >= 5)) continue;
    let rs = j;
    while (rs > 0 && !sc.tstart[rs]) rs--;
    let rn = j + 1;
    while (rn < sc.tight.length && !sc.tstart[rn]) rn++;
    if (INNOCENT[sc.tight.slice(rs, rn)]) continue;
    out.push({
      s: sc.nc[sc.tmap[j]].o,
      e: sc.nc[sc.tmap[end - 1]].o + 1,
      ent: ents[gi] || ents[0],
    });
    j = end - 1;
  }
  return out;
}

/* one regex per set, alternatives ordered longest-first so "shithead" is
   never eaten by "shit" before it gets its chance. */
function buildMatcher(ents) {
  const ord = ents.slice().sort((a, b) => b.p.length - a.p.length);
  const starts = [],
    seen = {};
  ord.forEach((e) => {
    const c = e.p[0];
    if (!seen[c]) {
      seen[c] = 1;
      starts.push(c);
    }
  });
  return {
    ents: ord,
    starts: starts,
    re: new RegExp(ord.map((e) => "(" + e.p + ")").join("|"), "y"),
  };
}

const SLUR_M = buildMatcher(SLUR_WORDS);

/* ------------------------------------------------------------------ *
 * check(text) -> { blocked, reasons, hits }
 *   blocked  true when the gateway must reject before storage
 *   reasons  human readable, safe to return to the composer
 *   hits     [{kind, s, e}] offsets into the ORIGINAL text
 * ------------------------------------------------------------------ */
function check(text, opts) {
  const o = opts || {};
  const blockSlurs = o.blockSlurs !== false;
  const blockFonts = o.blockStyledFonts !== false;
  const blockSafety = o.blockSafetyTerms !== false;

  const reasons = [];
  const hits = [];
  const push = (kind, s, e) => {
    hits.push({ kind: kind, s: s, e: e });
    if (reasons.indexOf(kind) < 0) reasons.push(kind);
  };

  if (!text || typeof text !== "string") return { blocked: false, reasons, hits };

  /* 1. the slur gate — hard block, every spelling, embedded or not */
  if (blockSlurs) {
    const m = scanMatches(text, SLUR_M.ents, SLUR_M.re, SLUR_M.starts, true);
    if (m.length) push(SLUR_HIT, m[0].s, m[0].e);
  }

  /* 2. styled unicode — exists only to sneak past the reader-side filter */
  if (blockFonts && hasStyledFont(text)) push(FONT_HIT, 0, text.length);

  /* 3. safety terms — word-boundary only, so "assassin" and "thug" are safe */
  if (blockSafety) {
    const words = wb(text);
    for (let i = 0; i < FILTER_TERMS.length; i++) {
      const t = FILTER_TERMS[i];
      if (t.indexOf(" ") > -1) {
        if (text.toLowerCase().indexOf(t) > -1) hits.push({ kind: t, s: 0, e: 0 });
      } else if (words.indexOf(t) > -1) hits.push({ kind: t, s: 0, e: 0 });
      if (hits.length && hits[hits.length - 1].kind === t)
        if (reasons.indexOf(t) < 0) reasons.push(t);
    }
  }

  const blocked =
    (blockSlurs && reasons.indexOf(SLUR_HIT) > -1) ||
    (blockFonts && reasons.indexOf(FONT_HIT) > -1) ||
    (blockSafety &&
      reasons.some((r) => r !== SLUR_HIT && r !== FONT_HIT));

  return { blocked: blocked, reasons: reasons, hits: hits };
}

/* the message the composer is shown. matches gateWhy() in the prototype. */
function explain(res) {
  if (!res.blocked) return "";
  if (res.reasons.indexOf(SLUR_HIT) > -1)
    return "Racial slurs are blocked outright, in every spelling, before anything is stored.";
  if (res.reasons.indexOf(FONT_HIT) > -1)
    return "Styled characters are blocked at the gate. They exist to get past the filter, not to be read.";
  return (
    res.reasons.filter((r) => r !== SLUR_HIT && r !== FONT_HIT).join(", ") +
    " is on the blocked list."
  );
}

module.exports = {
  check,
  explain,
  hasStyledFont,
  textScan,
  scanMatches,
  /* exported for the sync test — do not use these in route handlers */
  _internals: {
    INVIS,
    FONT_RANGES,
    COMBINING,
    MARKS,
    LEET,
    INNOCENT,
    FONT_HIT,
    SLUR_HIT,
    FILTER_TERMS,
    SLUR_A,
    SLUR_E,
    SLUR_WORDS,
    wb,
  },
};
