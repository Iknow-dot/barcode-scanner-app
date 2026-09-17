# iOS redesign — phase 5: orders, scanner, catalog

Date: 2026-09-18 · Status: approved

## Context

The last phase of the redesign described in
`2026-09-17-ios-redesign-phase1-theme-foundation-design.md`. Phases 1–4 (theme,
navigation shell, order sheets, client lookup) are implemented; phases 1–3 are
pushed.

Three screens are still on antd defaults inside an otherwise iOS-styled app.
Canvas artboards: "Orders", "Scanner", "Catalog".

Because these are three independent screens, this spec has **three plans**
executed in order: **5a orders**, **5b scanner**, **5c catalog**. Each ends
with a working, committable app.

## What is already true (from the code map)

- `UserDashboard.js` has **no test file at all**, so none of the orders tab's
  fetching, filtering or row rendering is pinned. Pure logic in this codebase
  lives in small tested modules (`tabSelection.js`, `addFlow.js`,
  `activeOrderBarView.js`, …); this phase follows that pattern, extracting view
  models and testing those rather than testing JSX.
- `BarcodeScanner.js` has **no test coverage whatsoever**, uses
  `document.getElementById` plus a 100 ms `setTimeout` instead of a ref,
  compares `html5-qrcode` state against **magic numbers 2 and 3**, and hard-codes
  `z-index: 2000/2010` — which collides with antd's `Modal.confirm`.
- `FindProductDrawer.js` is well covered (`catalogBrowse.test.js`,
  `categoryTileStyle.test.js`, `FindProductDrawer.test.js`) including two
  stale-response race guards. Its "load more", "all warehouses" and "scan
  instead" controls are untested.
- `orderStatusColor.js` is **shared with the admin dashboard** and pinned by a
  test asserting it never uses green (green is reserved for the accent).
- The backend's order list already filters on `status`, `created_by`,
  `customer_search`, `order_number` and a date range, and is **unpaginated**.

## 5a — Orders

- **Three status segments** replace today's implicit "my drafts unless you
  search": `ღია` (draft) · `დადასტურებული` (confirmed) · `დასრულებული`
  (completed), filled with the accent when selected. Each is a real query —
  the backend takes `status` — so the list stops being a client-side filter
  over an unbounded fetch. `ღია` keeps today's meaning: the current user's own
  drafts (`created_by` = me), minus the active order. The other two are
  org-wide, matching what the search already does.
- **Per-row status tags disappear.** The segment states which status you are
  looking at, so a tag on every row repeats it. This also settles the shared-
  util problem: `orderStatusColor.js` stays exactly as it is for the admin
  dashboard, and the consultant list simply stops calling it.
- **Rows become `.if-group` / `.if-row`**: a 40 px circle holding the
  customer's initials (a cart glyph for a retail order), the customer name in
  semibold, `#1048 · 3 პროდუქტი` beneath it, then the total in semibold with a
  relative time under it, and a chevron. The group's separators inset past the
  avatar (68 px).
- **Date section headers** group the rows: `დღეს`, `გუშინ`, then a date.
  Relative times (`ახლახან`, `25 წუთის წინ`, `2 სთ წინ`, then a clock time for
  older rows, then nothing once the date header carries it) come from a pure
  `ordersListView.js` so they are testable without a clock in the component.
- The search field becomes the phase 4 `.if-search` primitive with the
  placeholder `კლიენტით ძიება`, and searches **within** the selected segment.
- Loading and empty states keep today's distinction (`t.noIncompleteOrders`
  when idle on `ღია`, `t.noOrders` for a search that found nothing) and gain
  per-segment empty copy.
- **Both fetches get a stale-response guard** (the monotonic sequence ref
  already used in `FindProductDrawer` and the phase 4 lookup). Today a fast
  segment switch or a burst of keystrokes can let an older response land last.
- `fetchIncompleteOrders` assumes a bare array while the search path already
  unwraps `{results}` — both paths adopt the defensive unwrap, so enabling
  pagination on the backend can no longer make the list throw inside a
  swallowed `catch`.
- Row actions are unchanged: tap resumes a draft, the printer icon prints, the
  trash icon deletes a draft behind its confirm, and each stops propagation.

## 5b — Scanner

- The chrome moves onto tokens and the phase 2–4 primitives: a glass close
  button and a glass torch button in the navbar, the corner brackets and the
  brand scan line as they are, the hint as a glass pill, and a **`ხელით ძებნა`
  glass pill at the bottom** — the canvas's manual-search escape hatch, which
  today only exists on Home and in the empty cart.
- The camera flip control is **kept** although the canvas omits it: removing a
  capability is not a styling decision. It sits beside the torch.
- **`z-index` comes from `src/theme/layers.js`.** The scanner is full-screen
  camera, so it gets its own named layer above the bars and below antd's
  overlays, retiring the hand-written 2000/2010 and the documented collision
  with `Modal.confirm`.
- **The camera error stops being a raw `err.message`.** A pure
  `cameraError.js` maps the failure to one of: permission denied, no camera
  found, camera busy, or unknown — each with its own message, and a retry
  button for the recoverable ones. The raw message is kept as secondary text
  so a field report still carries it.
- **The start path stops depending on `getElementById` + a 100 ms timeout**: a
  ref, and the library's own state enum imported rather than the magic numbers
  2 and 3, so a version bump cannot silently break stop/start.
- `BarcodeScanner.css`'s literals become tokens, except the camera overlay's
  deliberate blacks and whites (already sanctioned in CLAUDE.md). The
  colour-literal guard is extended to cover this stylesheet so the next
  literal is caught.
- First tests for this component: the error mapping (pure), and that opening
  starts the scanner exactly once and closing stops it, with `html5-qrcode`
  mocked.

## 5c — Catalog

- The catalog **becomes a full tab screen** rather than a bottom drawer: the
  canvas shows it as the trailing search tab's destination, with the tab bar
  and the active-order bar in place. `FindProductDrawer`'s three entry points
  (the search tab, Home's manual-search button, the empty cart's) all select
  that tab instead of opening a drawer.
- Consequences to handle explicitly: the input's autofocus currently rides on
  the Drawer's `afterOpenChange`, which will no longer fire; and both
  stale-response guards (`browseSeqRef`, `searchSeqRef`) must survive the move
  — their existing tests are the gate.
- The search field becomes `.if-search` with a **trailing scan glyph** that
  opens the scanner (the canvas's shortcut), the "all warehouses" toggle
  becomes an `.if-group` row with a switch, and the category tiles keep their
  fixed pastels and fixed ink exactly as they are — that was a deliberate
  phase 1 decision, and making them token-driven would render the labels
  near-invisible in dark mode.
- Product rows adopt `.if-row` with the existing 56 px thumb, keeping
  `ProductImage`'s unmount-on-error behaviour and the signed proxy paths
  untouched (the frontend must never rebuild those URLs).
- The untested controls gain tests as they move: "load more", the warehouse
  toggle, and the scan shortcut.

## Out of scope

The admin dashboard (`SystemAdminDashboard/`), which keeps
`orderStatusColor.js` and its tags. The invoice template editor. Anything
touching the signed image-URL contract. Backend pagination for orders —
5a makes the frontend safe for it, but enabling it is a separate change.

## Verification

At 393×852 in light and dark: each orders segment including an empty one, a
search inside a segment, the date grouping across a day boundary, the scanner's
four error states (permission denied is the one to see), the catalog as a tab
with its tiles, a drill-down, a search, and "load more".
