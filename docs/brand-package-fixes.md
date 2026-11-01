# Brand package fixes for approval

The November 2026 audit found the ROWMI brand package disagrees with itself in the places below. RECALL had to pick a side, so this file records what it uses and what to change in the package so the next app doesn't have to choose. Nothing in the package has been edited.

**Rule used:** `tokens/rowmi.css` wins on values, `docs/rowmi-ui-guidelines.html` wins on behaviour.

**Paths** are relative to `rowmi-brand-package-v1/`. G = `docs/rowmi-ui-guidelines.html`, B = `docs/rowmi-brand-book.html`, S = `skill/rowmi-design/SKILL.md`, K = `skill/rowmi-design/rowmi-kit.html` (the SKILL.md starter kit is the same code, so change both), T = `tokens/rowmi.css`, J = `tokens/rowmi.json`, R = `README.md`. Line numbers are from the audited package. The brand book's source is `source/brand-book/book-template.html`: edit that, then rebuild.

## Needs your decision first

RECALL followed the skill over the rule in these two, so approve the direction before anything else.

| Item | What RECALL does | Option A | Option B |
|---|---|---|---|
| **C6 Soft shadows** | No soft shadows anywhere, following S403 and T43. This goes against G623. | **Recommended:** delete the soft shadow from G220 and G623 so the frame stays the only depth. | Keep G623 and change S403 and T43 to allow one soft shadow on floating layers. RECALL would then add it to sheets and menus. |
| **C8 Five dog clicks** | Five quick clicks give bubbles, following S37 and J145. One click gives a woof and a hop, following G980. | **Recommended:** change G980 to "five quick taps start bubbles" and move the awoo to something else. | Keep the G980 awoo and give bubbles only the typed word. RECALL would then change its five-click handler. |

## Tokens and colour

| # | Conflict | RECALL uses | Edit |
|---|---|---|---|
| C2 | S409 says to use `tokens/rowmi.css` names, but the kit uses others: K13 `--paper`, `--raised`, `--frame:#C9CED6`, K12 `--shell-deep`, B1427 `--f-text`, `--radius`. T43 defines `--frame` as a shadow, not a colour. | Kit names (`--paper`, `--raised`, `--frame`, `--shell-deep`), with `--border-strong`, `--success`, `--warning`, the `-soft` tokens, `--ease` and `--t-*` from T. | Rewrite K and the S starter kit onto T names, and rename T's shadow to `--frame-drop`. B1427 moves to T names too. |
| C3 | Dark ink: T57 `#F4F5F7`, K24 `#ECEEF1`. | `#F4F5F7` | K24 and its duplicate dark block: `--ink:#F4F5F7`. |
| C12 | Blue: B1140 "Selection only", T10. G580 uses it for Info, K229 for a glint, B1303 for a bubble tint. | Selection and focus only. Info uses `--muted`. Bubbles keep the kit colours. | G580: Info uses `--text-medium`. K229 and B1303: use a non-signal tint. |
| C23 | S486 "wordmark in Paper #F4F5F7", T5 Paper `#ECEEF1`. | Both are in use: the page ground is `#ECEEF1`, and the dark wordmark is `#F4F5F7` to match `logo/`. | S486: "wordmark in On Ink #F4F5F7". |
| C11 | Rust: G505 and S399 reserve it for Rommel, G550 lists progress and G1032 says it lights up what's live. | Progress uses `--shell`. The Now line is tan, which falls under G1032. | G550: remove "progress". Add to S399: "and the one live marker". |
| C11b | A glyph: G560, G759 rust vs G563, K58, S431 shell. | Shell | G560 and G759: A glyph uses the app's shell. |

## Type

| # | Conflict | RECALL uses | Edit |
|---|---|---|---|
| C14 | Silkscreen sizes: T37, R28 "8, 16, 24, 32, 64"; G597 "8, 16, 24 or 32"; B575 four sizes. | 16, 24, 32 | G597 and B575: use the T37 list. |
| C14b | Tab labels: G590, B354 Pixel 16; G328 Plex 13. | Plex 13, matching the Page slide specimen. | G590 and B354: "Plex Mono 13 in tab trays". Add 13 to the S type scale, which currently has 12, 14, 15, 20. |
| C14c | Lead: G591, G99 17 px; S438, J72, B1124 20 px. | Not used | G591 and G99: 20 px. |
| C14d | Body: S438 15 (14 dense), K32 15, G593 14. Line height G55 1.6, K32 1.55. | 14 px, 1.5 | G593: "15, or 14 in dense apps". Choose one line height; 1.55 matches the kit. RECALL can stay on 14 as a dense app, but its 1.5 needs moving to the chosen value. |

## Components

| # | Conflict | RECALL uses | Edit |
|---|---|---|---|
| C1 | Keys: G763 `Ctrl`+`Tab`, G759 `Enter`, G760 `Esc`; S508 letters; B800 `[` `]`. | All of them. | G759-763: list both the primary key and the alias. S508 and B800: reference that table. Note that browsers keep `Ctrl`+`Tab`, so it works in desktop apps only. |
| C4 | Focus ring: G768 2 px; K36 3 px; B24 3 px offset 3. | 2 px, offset 2 | K36 and B24: 2 px, offset 2. |
| C5 | Primary drop and hover: G171 `--border-strong`, G172 `brightness(1.25)`; K54 `--drop`; B87 `--muted`, B88 `#2A2E36`. | `--border-strong` drop. Hover per G172, adjusted so it works on dark mode's light primary. | K54 and B87-88: match G171-172. G172: state what hover does on a light primary. |
| C7 | Empty and loading dog: G535, G782 Idle; S34, S511 Sleepy; G806 skeletons vs S34 launch bar; J136 sleepy means offline. | Sleepy for empty, launch bar for loading. | G535, G782: Sleepy. G806: skeleton for content lists, launch bar for app load. J136: "offline or empty". |
| C7b | One Rommel: S401 one per screen; K104 and K115 show two. | One. The header stays Idle when a panel has its own dog. | K: the state dog replaces the header reaction. Add the rule to S34. |
| C15 | Buttons: G168 44 px, 14 px, `.1s`, G180 glyph 20 Plex 11; B84 48/15, B90 glyph 22; K57 glyph 24 pixel 16; S505 44-48, Plex 15. | 44 px, 14 px, glyph 24 pixel 16. | G180: glyph 24, pixel 16 (G168 unchanged). B84, B90 and S505: match G168 and K57. |
| C15b | Press: G320, B86 `.97,.94`; K53, B160 `.97`. | `.97,.94` | K53 and B160. |
| C15c | Danger: G175 `--on-danger`, border-strong drop; K55 `#FFFFFF`, frame drop. K55 fails in dark. | G175 | K55. |
| C16 | Spacing: G1176 4 px scale; K41 gap 14, K52 gap 10, K67 `10px 14px`. | The 4 px scale in most places. The toast and the button gap still use the kit's values. | K: move to 12 or 16, 8 or 12, and `8px 12px`. RECALL then matches when it next takes the kit. |
| C25 | About icon: G675 one set; K107 custom path. | `info` from the sprite | K107: use `icons/svg/info.svg`. |

## Motion

| # | Conflict | RECALL uses | Edit |
|---|---|---|---|
| C8b | Bubbles length: J145, B981, B1002 7 s; S37, K267 9 s. | 9 s | J145, B981 and B1002: 9 s. |
| C9c | Reduced motion: G922 and B733 keep the woof; J126 keep the sound; S500 unclear. | Sound stays, motion goes. | S500: "motion stops, sound stays". |
| C17 | Switch `.18s` 1.8 overshoot at G291 vs `.12s` at G196 vs 1.56 at T48. Breathe 1.06 at G312 vs 1.05 at B397. Brackets 14/4 at G307 vs 10/3 at G206. Slide `.28s` 32-40 px at B359, B527 vs 260 ms 24 px at J102. | `.18s` switch, G307 brackets, 260 ms and 24 px slide. | G196 to `.18s`. B397 to 1.06. G206: bracket specimen at 14/4, or note it as the small tile size. B359 and B527 to 260 ms, 24 px. Add the switch's 1.8 curve to T as `--ease-snap`. |
| C18 | Success: G995 240 ms two-pixel hop; G890 three frames, yips twice; G335 `.3s`; G978 one yip for big success only. | G995, with a yip only for big success. | G890 and G335: match G995 and G978. |
| C19 | G1008 "Only good news bounces", yet K67's error toast springs in. | Kit toast spring on every toast. | K: error toasts use `--ease`, no overshoot. RECALL then changes with the kit. |
| C20 | Boot: G916 "no fades", then a ghost; B200 `opacity:.22`; K has no ghost. K78 `min(92vw,640px)` gives fractional dots. K87 name is 8 units scaled, J119 Silkscreen 24. | Ghost as B200. Boot width set to whole dots by script. Name per J119. | G916: "no fades, except the ghost frame". K78 and K87: whole-dot width and the J119 name size, and add the ghost. |

## Sound

| # | Conflict | RECALL uses | Edit |
|---|---|---|---|
| C9 | Startup: G921 785/1049 Hz with 1796 Hz blips, one rendered sample; K196 784/1047, synthesised. | `sounds/startup.wav` | K196: play the WAV. |
| C9b | G1021 "No sound at launch before the first input"; G925 "Nothing on this screen happens in silence"; S36 plays startup. | Plays only if the browser already allows audio. | G925: "when audio is allowed". Keep G1021 as the rule for browsers. |
| C10 | UI sounds: G1292-1299 and the WAVs vs K187-195 synth values. The kit also lacks sniff, tag, whine, grr, awoo, click, on, off. | The WAVs | K187-195: replace the synth with WAV playback. Update the kit's sound table and SKILL.md. |
| C10b | Length: G1019 under 150 ms (chime under 400); S496 under half a second except awoo. | WAV lengths | S496: match G1019. |

## App frame and website

| # | Conflict | RECALL uses | Edit |
|---|---|---|---|
| C13 | G1059, G1088 hub bar with tabs and an action bar, dog at 20 px; S29, S506, K header only, 30 or 40 px. | Tabs in the shell header (RECALL exception), desktop action bar per G1089, header dog 40 px. | G1059 and G1086: the header holds the dog and may hold the tabs. S29, S506 and K: add the action bar. |
| C21 | About: G1093 from Settings; S35 header or Settings. | Both | G1093: "header or Settings". |
| C21b | Website: G1106 "Made by ROWMI", G1101 version pill; S10 dedication in the footer, version only by the download button. | Not applicable | Align G1101 and G1106 with S10. |

## Logo and package scope

| # | Conflict | RECALL uses | Edit |
|---|---|---|---|
| C22 | Logo sizes: R45 20, 40, 80, 120, 160; G524 20, 30, 40, 60, 80, 140; S484 "mark 16 px" contradicts itself. | 40 header, 80 and 96 bubbles | R45 and G524: one list of multiples of 10, which should include 30 and 60 since the header rule allows 30. S484: "minimum 20 px". |
| C24 | Scope: S8, T33 include Howl, S429 says five apps; J17-41 four shells, S431 "these four"; G464 "v0.1" vs R1 "v1.0". | Not applicable | J: add Howl's shell. S431: "these five". G464: v1.0. Add RECALL's `#6AA8F5` shell to T, J and the S colour table. |

## RECALL's kept exceptions

These are deliberate differences from the package. They aren't contradictions, so nothing changes unless you want it to.

| Exception | Why |
|---|---|
| Shell `#6AA8F5` sits close to dark Cursor Blue `#7AA7F2`, against "far from blue" | Your choice for RECALL. Black on it is 7.2:1. Focus rings on the shell are black so they stay visible. |
| Phone hides the L and R keys and puts tabs along the bottom | Swiping thumbs reach the bottom bar, and keys take space a 375 px header doesn't have. No document forbids it. |
| Today's queue and sheet lists use tighter tiles than the 12 px padding | The full tile costs too much height and width in those panes. Styling is otherwise the same. |
| Command subtabs have a static ink block, not a sliding one | They vary in width and can wrap, so one indicator can't slide cleanly. They do slide the page and stop at the ends. |
| App name is 24 px at phone width, not 32 | 32 px doesn't fit beside the header buttons. 24 is an allowed Silkscreen size. |
| No hub bar: tabs live in the shell header | RECALL needs the vertical space, and the skill and kit show header-only apps. See C13. |
| Native `<select>` dropdowns stay | Their lists are the platform's, so a controller can move past one but can't open it. |
| Quest art has its own palette and hand-drawn knight and bosses | The package has no equivalent art. The flag reuses `icons/svg/flag.svg`. |
