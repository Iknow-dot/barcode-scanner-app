# iOS redesign phase 5b — scanner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the full-screen scanner on the design system — glass controls, tokens, a manual-search escape hatch — and fix the three structural weaknesses the code map found while the file is open anyway.

**Architecture:** A pure `cameraError.js` classifies start failures so the UI can offer the right message and a retry; `BarcodeScanner.js` keeps its single start/stop effect but addresses its container by ref and the library's own state enum; `theme/layers.js` owns its z-index.

**Tech Stack:** React 18 (CRA), `html5-qrcode`, Jest + React Testing Library, the `--if-*` tokens and `ios.css` primitives from phases 1–4.

**Spec:** `docs/superpowers/specs/2026-09-18-ios-redesign-phase5-orders-scanner-catalog-design.md` (phase 5b section)

## Global Constraints

- All paths under `barcode-scanner-frontend/`. Test command from that
  directory: `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`.
  Baseline: 76 suites / 653 tests passing.
- **`BarcodeScanner.js` has no test coverage today.** Nothing here will fail a
  test if it breaks — every change needs its own test, and the camera must be
  exercised through a mocked `html5-qrcode`.
- Never modify `addFlow.js`, `addFlow.test.js`, `clientCreateRecovery.js`,
  `clientCreateRecovery.test.js`, `orderStatusColor.js` or its test.
- Colours come from `src/theme/tokens.css`. The camera overlay's deliberate
  blacks and whites stay literal — CLAUDE.md already sanctions them — but
  everything else becomes a token, and the guard is extended so the next
  literal is caught.
- Strings via `useLanguage()`'s `t`, in both `ka` and `en`, each key exactly
  once per locale. Grep before adding.
- The Jest run is pinned to `Asia/Tbilisi` in `jest.globalSetup.js`; never add
  a per-file `process.env.TZ`.
- Commit per task, `git add` by path only (the checkout is shared), never
  push. After each commit run `git show --stat`; if files you did not stage
  appear, soft-reset and recommit only yours. Trailer:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: Classify camera failures

**Files:**
- Create: `src/components/UserDashboard/cameraError.js`
- Test: `src/components/UserDashboard/cameraError.test.js`
- Modify: `src/i18n/translations.js`

**Interfaces:**
- Produces:
  ```js
  export const CAMERA_ERROR_KINDS = ['permission', 'notFound', 'busy', 'unknown'];
  export const classifyCameraError = (error) => ({kind, messageKey, canRetry, detail});
  ```
  `detail` carries the original message so a field report still has it;
  `canRetry` is false only for `permission` (the browser will not re-prompt
  once denied in the same page load — the consultant must change a setting).
- Consumes: nothing. Pure module, no React.

- [ ] **Step 1: Write the failing tests.** `html5-qrcode` surfaces the
browser's own `getUserMedia` errors, so classify on `error.name` first and the
message only as a fallback:

```js
it('names a denied permission', () => {
    expect(classifyCameraError({name: 'NotAllowedError', message: 'Permission denied'}))
        .toMatchObject({kind: 'permission', canRetry: false});
    expect(classifyCameraError({name: 'PermissionDeniedError'})).toMatchObject({kind: 'permission'});
});

it('names a missing camera', () => {
    expect(classifyCameraError({name: 'NotFoundError'})).toMatchObject({kind: 'notFound', canRetry: false});
    expect(classifyCameraError({name: 'DevicesNotFoundError'})).toMatchObject({kind: 'notFound'});
});

it('names a camera another app is holding', () => {
    expect(classifyCameraError({name: 'NotReadableError'})).toMatchObject({kind: 'busy', canRetry: true});
    expect(classifyCameraError({name: 'TrackStartError'})).toMatchObject({kind: 'busy'});
});

it('falls back to unknown, keeping the original text', () => {
    const result = classifyCameraError({message: 'Something odd'});
    expect(result).toMatchObject({kind: 'unknown', canRetry: true, detail: 'Something odd'});
});

it('survives a plain string or a null', () => {
    expect(classifyCameraError('boom')).toMatchObject({kind: 'unknown', detail: 'boom'});
    expect(classifyCameraError(null)).toMatchObject({kind: 'unknown'});
});
```

- [ ] **Step 2: Run them and watch them fail** (module not found).

- [ ] **Step 3: Implement it**, then add the four messages to both locales:
`cameraPermissionDenied` (tell the consultant to allow camera access in the
browser's site settings), `cameraNotFound`, `cameraBusy`, `cameraError`, plus
`retry` and `scanManualSearch` if grep shows they do not already exist.

- [ ] **Step 4: Tests green, then commit**

```bash
git add src/components/UserDashboard/cameraError.js src/components/UserDashboard/cameraError.test.js src/i18n/translations.js
git commit -m "feat(scanner): classify camera start failures"
```

---

### Task 2: Give the scanner a named layer and token colours

**Files:**
- Modify: `src/theme/layers.js`
- Modify: `src/components/UserDashboard/BarcodeScanner.css`
- Test: `src/theme/layers.test.js` (create if absent), `src/theme/iosCss.test.js`

**Interfaces:**
- Produces: `LAYER_SCANNER` (and whatever the chrome above it needs), exported from `layers.js`.
- Consumes: nothing.

- [ ] **Step 1: Read `src/theme/layers.js` first.** It already documents the
bands (bars 100, sheets 900 with a step, antd overlays 1000) and carries a
comment noting that `BarcodeScanner.css`'s hand-written `2000`/`2010`
coincides with antd's `Modal.confirm`. Add the scanner's own band **above**
antd's overlay base, because the camera is full-screen and must cover
everything — but write down in the comment what that means for a confirm
dialog opened while the scanner is up, and make the chrome's layer relative
to the scanner's rather than another magic number.

- [ ] **Step 2: Write the failing test** in `layers.test.js`: the scanner's
layer is above `ANTD_OVERLAY_BASE`, its chrome is above the scanner surface,
and the exported numbers are ordered as documented.

- [ ] **Step 3: Replace the literals in `BarcodeScanner.css`.** The z-indexes
come from `layers.js` (either as CSS custom properties set from JS, or by
moving those rules to inline styles fed by the constants — pick one, say
which in the report, and keep the stylesheet readable). Colours: the camera
overlay's blacks/whites stay (they sit over a live camera feed, not over the
themed page), but the chrome that is not over the feed uses tokens, and the
scan line's hand-copied `rgba(66, 174, 117, 0.6)` becomes a token-derived
value rather than a duplicate of `--if-brand`'s rgb.

- [ ] **Step 4: Extend the colour-literal guard** so `BarcodeScanner.css` is
scanned too, with an explicit allowlist for the overlay literals you kept —
so the next stray literal fails a test rather than shipping.

- [ ] **Step 5: Suite green, then commit**

```bash
git add src/theme/layers.js src/theme/layers.test.js src/theme/iosCss.test.js src/components/UserDashboard/BarcodeScanner.css
git commit -m "feat(scanner): own the scanner's layer and put its chrome on tokens"
```

---

### Task 3: Restructure the scanner and give it its first tests

**Files:**
- Modify: `src/components/UserDashboard/BarcodeScanner.js`
- Test: `src/components/UserDashboard/BarcodeScanner.test.js` (new)

**Interfaces:**
- Consumes: `cameraError.js` (Task 1), `layers.js` (Task 2), `IosIcon`.
- Produces: `BarcodeScanner({open, onScan, onClose, onManualSearch})` — the new
  optional `onManualSearch` renders the bottom pill; Task 4 wires it.

- [ ] **Step 1: Write the failing tests** against a mocked `html5-qrcode`:

```js
jest.mock('html5-qrcode', () => {
    const start = jest.fn(() => Promise.resolve());
    const stop = jest.fn(() => Promise.resolve());
    return {
        __mock: {start, stop},
        Html5QrcodeScannerState: {NOT_STARTED: 1, SCANNING: 2, PAUSED: 3},
        Html5Qrcode: jest.fn().mockImplementation(() => ({
            start, stop,
            getState: () => 2,
            getRunningTrackCameraCapabilities: () => ({torchFeature: () => ({isSupported: () => false})}),
        })),
    };
});
```

Cases: opening starts the camera exactly once (not twice — the effect must not
double-start); closing stops it; a start rejection renders the classified
message and, for a retryable kind, a retry control that starts it again; a
denied permission renders its own message and **no** retry; the first decode
calls `onScan` once even if the library fires the callback repeatedly;
`onManualSearch` renders the pill only when supplied, and tapping it calls the
handler.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement.** Three structural changes, each of which the code
map flagged:
  - Address the container by **ref**, not `document.getElementById` plus a
    100 ms `setTimeout`. If the library insists on an element id, keep the id
    on the ref'd node and read it from the ref, so a restyle that reorders or
    delays the markup cannot silently no-op the start.
  - Import **`Html5QrcodeScannerState`** and compare against it instead of the
    literals `2` and `3` (verified: the package exports it, SCANNING is 2 and
    PAUSED is 3 today — the point is that a version bump must not change
    behaviour silently).
  - Route start failures through `classifyCameraError` and render the kind's
    message, its retry when `canRetry`, and the raw `detail` as secondary text.
  Keep the existing re-entrancy guard, the torch probe, the flip control and
  the one-shot decode ref exactly as they behave now.

- [ ] **Step 4: Restyle the chrome** to the canvas
(`.claude/ios-mockups/src/Scanner.body.html`): glass close and torch buttons in
the navbar (flip beside them — the canvas omits it, but removing a capability
is not a styling decision), the corner brackets and brand scan line as they
are, the hint as a glass pill, and the `ხელით ძებნა` glass pill at the bottom.

- [ ] **Step 5: Tests green, then commit**

```bash
git add src/components/UserDashboard/BarcodeScanner.js src/components/UserDashboard/BarcodeScanner.test.js
git commit -m "feat(scanner): ref-addressed start, classified errors and the iOS chrome"
```

---

### Task 4: Wire the manual-search pill

**Files:**
- Modify: `src/components/UserDashboard/UserDashboard.js:839-843`

**Interfaces:**
- Consumes: `BarcodeScanner`'s new `onManualSearch` prop.

- [ ] **Step 1: Pass the handler.** `UserDashboard` already opens the catalog
search from Home and from the empty cart (`handleOpenSearch` /
`handleEmptyCartSearch` — read them). The pill must close the scanner and open
that search, in that order, so the camera is released before the drawer opens.

- [ ] **Step 2: Check the flag.** Those entry points are gated on
`catalogEnabled` (`authData.product_catalog_enabled`). Pass `onManualSearch`
only when the flag is on, so an org without the catalog does not get a pill
that opens nothing. Say in the report which flag you keyed on.

- [ ] **Step 3: Run the full suite, then commit**

```bash
git add src/components/UserDashboard/UserDashboard.js
git commit -m "feat(scanner): open manual search from the scanner"
```
