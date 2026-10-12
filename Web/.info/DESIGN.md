# Afterbell — Design System

name: afterbell
feeling: informal, fun
theme: chill
one line: a school notebook that learned to run apps.

Everything below describes what is already built in `index.html` (the `<style>`
block, lines 14–561). This file is documentation, not a spec to chase — if the
CSS and this file disagree, the CSS wins.

---

## 1. The core idea

Paper and ink. The whole app looks like things cut, stamped and taped onto a
page: cards have hard borders and hard offset shadows, labels look like they
were typed on a school computer, headings look printed in a textbook. Nothing
is glassy, nothing is soft-blurred, nothing floats without a border.

Three layers of reference, in order of importance:

1. **Stationery** — ruled paper, sticky notes, tape, ticket stubs, ID cards
2. **Chalkboard** — dark green panels for games and anything "teacher-facing"
3. **Stamped print** — mono uppercase labels, dashed rules, perforations

---

## 2. Colour

Defined once on `:root` (`index.html:19`).

| Token       | Value      | Use                                      |
|-------------|------------|------------------------------------------|
| `--paper`   | `#EFEAE0`  | app background                           |
| `--paper2`  | `#E6DFD1`  | recessed surfaces                        |
| `--card`    | `#FCFBF6`  | card / sheet background                  |
| `--card2`   | `#F4F1E7`  | secondary fills, input wells             |
| `--ink`     | `#17170F`  | text, all borders                        |
| `--ink2`    | `#4B4A3D`  | secondary text                           |
| `--ink3`    | `#8B8878`  | muted text, mono micro-labels            |
| `--line`    | `#D8D1C0`  | light rules                              |
| `--line2`   | `#C4BBA6`  | dashed rules, chip borders               |
| `--chalk`   | `#24463A`  | primary action colour, chalkboard        |
| `--chalk2/3`| `#37604E` / `#5C8574` | chalk depth, bar stripes      |
| `--mint`    | `#CBE4D5`  | soft positive fill, avatar bg            |
| `--hl`      | `#FFD84D`  | highlighter yellow — attention only      |
| `--brick`   | `#CF3F2C`  | destructive / live / notifications       |
| `--sky`     | `#3B6EA5`  | links, verified tick                     |
| `--plum`    | `#6A4A78`  | tertiary accent                          |
| `--green`   | `#2E7D52`  | approval states                          |

Rules of thumb:

- **Yellow = look here.** Highlighter swipe, boosted posts, active nav tab,
  focus rings. Never a whole button unless it is the one thing to tap.
- **Red = live or lost.** Notifications, rejected content, record buttons,
  blocked pills. Never decoration.
- **Green = approved.** Chalk green is the default primary button and the
  "this is fine" colour.
- Colour is applied in flat blocks, never as a large gradient on UI chrome.
  Gradients only appear as *art*: avatar fills (`g1`–`g6`), cosmetics, reels.

---

## 3. Type

| Role        | Font                              | Notes                                  |
|-------------|-----------------------------------|----------------------------------------|
| Headings    | serif (`Source Serif 4`, Georgia)  | 600–700, tight letter-spacing          |
| Body        | `Inter` / system sans              | 15px base, 1.45 line-height            |
| Micro-label | mono, uppercase, `.08em` tracking  | 8.5–11px — counts, tags, section meta  |
| Data / code | mono                              | tokens, hashes, logs, calculator       |

Sizes: `h1 27 / h2 20 / h3 16`, `.lede 13.5`, `.tiny 11.5`, body 14.5–15.
Post body may switch to serif (user setting) for a "written" feel.

Signature moves:
- **`.meta`** — mono, uppercase, 10px, `--ink3`. Used everywhere; this is what
  makes the UI read as "typed on a school computer".
- **`.hl`** — highlighter swipe behind inline text (yellow band at 52–94%).
- **`.pill` / `.chip`** — mono uppercase inside a bordered capsule.

---

## 4. Shape, border, depth

- Radii: `--r: 9px` cards, `--r-s: 6px` controls, `--r-l: 14px` sheets.
  User rounding setting overrides to 0 / 9 / 16.
- Borders: **1.5px solid `--ink`** is the default for anything interactive.
  Chips/labels drop to 1.2–1.4px.
- Shadows: **hard offsets, no blur** — `--sh: 3px 3px 0`, `--sh2: 5px 5px 0`.
  Soft shadow only inside inset wells.
- Buttons **physically press**: `:active` translates 2px and kills the shadow.
- Focus: `0 0 0 3px rgba(255,216,77,.6)` — a highlighter glow, not a blue ring.

---

## 5. Texture and ornament

- **Grain**: fixed noise SVG at 5% opacity, `mix-blend-mode:multiply` over
  everything (`#grain`). Toggleable.
- **Torn paper**: bottom nav has a zigzag SVG top edge, drawn as `#nav:before`.
- **Ruled lines**: `.ruled` gives a real notebook line grid (24px baseline).
- **Dashed rules**: `border-bottom: 1.5px dashed` separates list rows — never
  a solid hairline.
- **Tilt**: sticky notes, boost tags and stickers rotate ±1–1.2°. Anything
  "pinned" is slightly crooked; anything structural is straight.
- **Perforation**: `.ticketStub` punches half-circle notches out of both edges.
- **Tape**: yellow translucent rectangle on desk notes, `--hl` at 55%.

Ornament budget: high, but only on objects that are meant to feel physical.
Plain text rows stay plain.

---

## 6. Layout

- Desktop: the app is a **392×824 phone mock** centred on a graph-paper desk,
  with rotated sticky notes beside it. This is a preview frame, not a responsive
  layout.
- Under 560px the frame disappears and the app goes full-bleed.
- Screen padding 14px; `--nav-h: 62px` bottom nav reserved via `.pad`.
- Building blocks: `.card`, `.stack` (12px vertical rhythm), `.row`,
  `.sect` (serif h2 + flex rule + mono meta), `.scroller` (edge-bleeding
  horizontal rails), `.grid2` / `.grid3`.
- Content rhythm inside a card: header row → body → dashed rule → action row.

---

## 7. Motion

Short, physical, never floaty.

| Element        | Motion                            | Time     |
|----------------|-----------------------------------|----------|
| screen entry   | fade + 9px rise (`slide`)         | 260ms    |
| bottom sheet   | slide up (`up`)                   | 280ms    |
| toast          | scale in (`pop`)                  | 200ms    |
| buttons        | translate on `:active`            | instant  |
| toggles        | knob slide + fill                 | 160ms    |
| poll fill      | width ease                        | 550ms    |

- Easing: `cubic-bezier(.22,.8,.3,1)` — fast out, soft landing.
- Screen changes must **not** reset scroll or caret; the morph renderer exists
  exactly for that.
- Ambient loops (cosmetic borders, auras, splash bar) are slow, 2.5–7s.
- `prefers-reduced-motion` and the `data-anim="off"` setting kill all of it.

---

## 8. Themes and personalisation

Everything is CSS custom properties on `:root`, swapped through data attributes
so no component ever hardcodes a colour.

- **8 app themes**: Classroom paper (default), Chalk & ink, Ink & highlighter,
  Rose register, Mint noticeboard, Brown paper, Cobalt lab, Terminal,
  Sunset bus. Four are dark.
- **6 accents**: Chalkboard, Binder, Ink purple, Study blue, Pencil rust,
  Old rose — these only remap the `--chalk*` / `--mint` family, so the primary
  action colour is personal while the paper stays paper.
- **Density**: compact / cozy / roomy → padding and stack gaps only.
- **Typeface**: system / serif / mono / rounded → swaps `--sans`.
- **Rounding**: sharp (0) / soft (9) / round (16).
- **Toggles**: grain, torn nav edge, animation, shadows (flat).

The user-facing knobs are deliberately *re-skins of the same system*, not new
styles. Do not add a theme that introduces a colour outside the token set.

---

## 9. Component vocabulary

| Component     | Look                                                        |
|---------------|-------------------------------------------------------------|
| `.btn`        | bordered, hard shadow, presses down. `.pri` chalk, `.brick` red, `.hl` yellow |
| `.pill`       | mono uppercase capsule. variants: solid, hl, mint, brick, chalk, grey, warn |
| `.chip`       | filter chip; `.on` inverts to ink fill                       |
| `.seg`        | bordered segmented control, active segment inverts           |
| `.sw`         | toggle — chalk fill when on, mint knob                       |
| `.field`      | bordered input, inset well, yellow focus glow                |
| `.notice`     | left 5px ink bar, tinted fill (yellow / brick / mint / plum) |
| `.avatar`     | circle, 1.5px ink border, serif initial or gradient `g1`–`g6` |
| `.stat`       | small bordered number box, serif figure + mono key           |
| `.bar`        | bordered track, diagonal chalk stripes as fill               |
| `.ticketStub` | notched card for tickets and receipts                        |
| `.idcard`     | striped header + holes — the profile card                    |
| `.chalkboard` | dark green inset panel, used for games and mod surfaces      |
| `.empty`      | centred muted block with serif title                         |

Sheets: bottom-anchored, top border only, drag handle bar, scrim at 42% ink.
Toasts: ink-filled, mono uppercase yellow title, bottom above the nav.

---

## 10. Voice in the UI

Copy is informal and a little conspiratorial — "the bell rings, the corridor
empties", "there is no registration endpoint to attack". Micro-labels stay
terse and factual. Never use corporate phrasing (engage, seamless, discover).
Never use emoji as UI iconography; icons are the inline SVG set (`I(name)`).

---

## 11. Doing design work here

- Change tokens, not one-off hex values. If you need a colour that does not
  exist, add a token first.
- Every new screen is built from the existing primitives above. If something
  needs a new primitive, add it to the primitives block, not to the screen.
- Keep the mono-for-labels / serif-for-headings split. Breaking it is the
  fastest way to make a screen look foreign.
- Still to do, waiting on an actual designer: icon set polish, a mascot,
  banner art, and badge art for the perk economy.
