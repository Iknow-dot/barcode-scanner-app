# iOS redesign — phase 4: client lookup

Date: 2026-09-18 · Status: approved

## Context

Phase 4 of the redesign described in
`2026-09-17-ios-redesign-phase1-theme-foundation-design.md`. Phases 1–3
(theme, navigation shell, order sheets) are implemented and pushed.

This phase replaces `components/UserDashboard/ClientLookupModal.js` (789
lines, an antd `Modal` holding three stacked lookup fields and a create
form) with a sheet built on the phase 3 `IosSheet`, matching the canvas
artboards "Lookup B: 3 tabs (default)" and "New client".

The user picked the 3-tab variant over one smart field, two tabs and
number-pad-first. The reason three fields collapse to one: 1C resolves an
identification number and a phone through the **same** `IDPhone` criterion,
so ID and phone are one search with two keyboards, and a name is the only
genuinely different search (`Name`, matched upstream with LIKE, so it
usually returns several clients).

### What this phase must not break

`ClientLookupModal.js` has **no tests of its own**. Two pure modules around
it are fully covered and are the regression gate — both stay unchanged:

- `clientCreateRecovery.js` — `isIndeterminateFailure` / `lookupKeyFor` /
  `recoverCreatedClient`. This is the only thing standing between a flaky
  network and a duplicate client, because CreateClient is a non-idempotent
  write with no upstream transaction id.
- `addFlow.js` — the pending-scan-pick machine (`startAdd`, `orderStarted`,
  `lookupClosed`, `orderStartFailed`). It is invisible from inside the
  modal but load-bearing at the call site: a scan with no active order
  opens the lookup, and cancelling must drop the held pick.

## Decisions

### Lookup step

- **A sheet, not a modal.** `IosSheet` with `level={1}`, because the
  change-customer entry point opens it over the order sheet (`level 0`).
  Title `კლიენტის მოძიება`, leading close button, no trailing action.
- **Three segmented tabs**: `პირადი ნომერი` · `ტელეფონი` · `სახელი`,
  selected tab filled with the accent (phase 1 rule). The tab chooses one
  criterion — the sheet sends exactly one of `identification_number`,
  `phone`, `name` to `clientService.checkClient`. This replaces today's
  "send all three trimmed values together"; the backend's ID > phone > name
  precedence still exists but no longer has to arbitrate, because only one
  criterion is ever populated.
- **One search field** under the tabs, with a search glyph, the typed
  value, and a trailing clear (×) that empties the field and the results.
  The tab sets the keyboard: `inputMode="numeric"` for ID and phone,
  default text for name. Switching tabs clears the field and the results
  (a value typed for one criterion is never valid for another).
- **When a search runs**, per tab:
  | Tab | Trigger | Threshold | Debounce |
  |---|---|---|---|
  | ID | automatic | ≥ 9 digits, digits only | 1500 ms |
  | Phone | automatic | matches `^5\d{8}$` after normalizing `+995`/`995`/leading `0` | 1500 ms |
  | Name | explicit: the keyboard's return key, or the trailing search button that replaces the × once the value is long enough | ≥ 3 characters | none |
  Names stay explicit for the reason the current code gives: a name is
  never complete mid-typing, so an auto-search fires on every pause, and
  each one is an upstream LIKE query. 9 digits is the shortest legal-entity
  tax ID, and 1C cross-matches shorter numbers against the phone column.
  The de-dupe guard that stops the same value re-firing on an unrelated
  re-render carries over.
- **Results** render as one inset grouped list: name in semibold, then
  `identification number · phone` and the address in secondary text, with a
  chevron. A section header above it counts them (`3 კლიენტი`). The last
  row of the same group is always `+ კლიენტის შექმნა` in accent text — so
  creating is reachable whether the search found nothing, one client or
  several.
- **Exactly one match still auto-selects** and closes the sheet, as today,
  for every tab. Losing that would add a tap to the most common path.
- **The client-side filter box over the results is dropped.** It existed
  because the old modal could not refine a search without retyping three
  fields; the tabbed search field now does that job. Its two strings
  (`filterClientsPlaceholder`, `noClientsMatchFilter`) go with it.
- **`გაგრძელება კლიენტის გარეშე`** is a plain (non-accent) button in the
  sheet's bottom action bar, rendered only when the `onRetail` callback is
  supplied — that single prop is still the whole difference between the
  "new order" and "change customer" instances.
- **Errors** keep their code-driven messages (`EXTERNAL_SERVICE_*`,
  `CLIENT_ALREADY_EXISTS`, `CLIENT_CREATE_UNVERIFIED`) and
  `CLIENT_NOT_FOUND` stays a navigation signal, not an error: it carries
  the typed value into the create step.

### Create step

Same sheet, second step (a step, not a stacked sheet — the back button
returns to the lookup with its field and results intact).

- Navbar: back, title `კლიენტის შექმნა`, and **`შენახვა` as a prominent
  trailing action** — the save moves out of the body and into the navbar.
- A tint-soft info banner `კლიენტი ვერ მოიძებნა — შექმენით ახალი`, shown
  only when the step was reached from a `CLIENT_NOT_FOUND`, not when the
  consultant tapped the create row deliberately.
- `ფიზიკური პირი` / `იურიდიული პირი` as a segmented control.
- **Every label sits above its field**, and the phone fields stack instead
  of sharing a row — the canvas decision, and the reason the old `Flex wrap`
  with `PHONE_FIELD_FLEX` disappears.
- Groups, in order: identification number (with the RS.ge lookup pill on
  the right of the row); `სახელი *` and `გვარი *`; `ტელეფონი`,
  `დამატებითი ტელეფონი`, `ელ. ფოსტა`; then a `მისამართი` section with the
  address autocomplete row and the inline map.
- First and last name stay the only required fields. The seed from the
  lookup keeps splitting a typed name on the first space.
- RS.ge autofill keeps its three-way outcome (`RS_GE_NOT_FOUND` / HTTP 404,
  `RS_GE_TIMEOUT` / HTTP 504, anything else) and keeps filling a name field
  only when the response actually carries it.
- The address picker keeps its 300 ms debounce, 3-character minimum and the
  sequence guard that discards a stale response, and `AddressMapPicker`
  is reused unchanged.
- Create keeps the exact payload shape and the `clientCreateRecovery`
  wiring: indeterminate failure → re-check twice (2500 ms apart) → treat a
  found client as success, warn `clientCreateUnverified` when still
  unknown, and only then report the original error. On success the upstream
  data is folded over the typed values, upstream winning.

## Files

- Create `src/components/UserDashboard/clientLookupView.js` — pure: the tab
  table (criterion, keyboard, placeholder, threshold, trigger), whether a
  value is searchable, the `checkClient` argument object for a tab, the
  result-row projection (title, `id · phone` line, address line), the count
  label, and the create-step seed for a tab's value.
- Create `src/components/UserDashboard/ClientLookupSheet.js` — the sheet and
  its two steps.
- Create `src/components/UserDashboard/ClientCreateForm.js` — the create
  step's fields, RS.ge pill and address section.
- Modify `src/components/UserDashboard/UserDashboard.js` — both call sites
  render the sheet; props unchanged (`open`, `onSelect`, `onClose`,
  `onRetail`), so `addFlow` keeps its three edges.
- Modify `src/theme/ios.css` — a search field, a label-above form row, an
  info banner and a trailing-action navbar pill, if the phase 3 primitives
  do not already cover them.
- Modify `src/i18n/translations.js` — add the tab, count and create-row
  strings; remove the two filter strings.
- Delete `src/components/UserDashboard/ClientLookupModal.js`.

## Tests

The current flow's UI is unverified, so this phase adds the coverage it
never had:

- `clientLookupView.test.js` — every tab's criterion, keyboard and
  threshold; digits-only and `^5\d{8}$` validation including the `+995`,
  `995` and leading-`0` forms; the searchable/not-searchable boundary at 8
  vs 9 digits and 2 vs 3 characters; the single-criterion argument object
  (the other two keys absent, not empty); the row projection with missing
  address or phone; the count label; the name seed splitting on the first
  space only and a single token landing in the first name.
- `ClientLookupSheet.test.js` — a tab switch clears the field and results;
  an ID reaching 9 digits searches once after the debounce (fake timers) and
  does not re-fire for the same value; the phone tab does not search on 8
  digits; the name tab does not search on a pause and does search on submit;
  exactly one match calls `onSelect` and does not render the list; several
  matches render rows and clicking one calls `onSelect`;
  `CLIENT_NOT_FOUND` moves to the create step with the value seeded; the
  create row reaches the create step with no banner; the retail button
  renders only with `onRetail`.
- `ClientCreateForm.test.js` — first and last name are required and nothing
  else is; the RS.ge pill fills names from a response and leaves them alone
  when the response omits them; each RS.ge failure branch shows its own
  message; a successful create calls `onSelect` with upstream data folded
  over the typed values; an indeterminate failure goes through
  `recoverCreatedClient` and a recovered client reports success.
- `clientCreateRecovery.test.js` and `addFlow.test.js` must pass untouched.

## Verification

At 393×852 in light and dark: the three tabs with their keyboards, a name
search returning several clients, a single-hit search closing the sheet,
the not-found path into the create form, the create form's stacked phones
and RS.ge pill, and the lookup opened over the order sheet from the
active-order bar (it must sit above it, not push it aside).

## Out of scope

Orders list, scanner and catalog (phase 5). The address map's own restyle.
`external_client_id` is dead wiring today — the modal never sets it and the
order payload always sends `''`; this phase neither fixes nor removes it.
