# iOS redesign phase 4 — client lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 789-line `ClientLookupModal` with an `IosSheet` whose lookup step has three tabs over one search field, and whose create step puts every label above its field.

**Architecture:** A pure view model (`clientLookupView.js`) holds the tab table, validation and projections; `ClientLookupSheet.js` renders the two steps on the phase 3 `IosSheet`; `ClientCreateForm.js` holds the create fields. `clientCreateRecovery.js`, `addFlow.js` and `AddressMapPicker.js` are reused unchanged.

**Tech Stack:** React 18 (CRA), antd 6, Jest + React Testing Library, the `--if-*` token/`ios.css` primitives from phases 1–3.

**Spec:** `docs/superpowers/specs/2026-09-18-ios-redesign-phase4-client-lookup-design.md`

## Global Constraints

- All paths are under `barcode-scanner-frontend/`. Test command:
  `CI=true npx react-scripts --openssl-legacy-provider test --watchAll=false`.
  Baseline is 70 suites / 495 tests passing.
- **Never modify `clientCreateRecovery.js`, `clientCreateRecovery.test.js`,
  `addFlow.js` or `addFlow.test.js`.** They are the regression gate.
- No literal colours. Every colour is a `var(--if-*)` token
  (`src/theme/tokens.css`); `noLegacyBlue.test.js` and `palette.test.js`
  enforce it.
- Georgian is the primary locale: every user-visible string goes through
  `useLanguage()`'s `t`, added to **both** `ka` and `en` in
  `src/i18n/translations.js`. No duplicate keys (a later duplicate silently
  wins — two were removed in phase 3).
- The sheet's props stay exactly `{open, onSelect, onClose, onRetail}`;
  `onRetail` is optional and its presence is the only difference between the
  two call sites.
- Exactly one criterion reaches `clientService.checkClient` per search.
- Constants keep their current values and their rationale comments:
  `AUTO_LOOKUP_DEBOUNCE_MS = 1500`, `AUTO_LOOKUP_MIN_ID_DIGITS = 9`,
  `NAME_MIN_CHARS = 3`, `ADDRESS_SEARCH_DEBOUNCE_MS = 300`,
  `ADDRESS_SEARCH_MIN_CHARS = 3`, `CREATE_RECOVERY_RETRY_MS = 2500`.
- The stock antd `Modal`/`Form` plumbing does not come along: the sheet owns
  its own state. `Form.useForm()` is allowed inside the create step only if
  it earns its place.
- Commit per task, staging by path (another session shares this checkout).
  Never push. Trailer:
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

---

### Task 1: Strings and the two missing primitives

**Files:**
- Modify: `src/i18n/translations.js`
- Modify: `src/theme/ios.css`
- Test: `src/theme/iosCss.test.js`

**Interfaces:**
- Produces: the `t` keys `lookupByIdTab`, `lookupByPhoneTab`, `lookupByNameTab`, `lookupIdPlaceholder`, `lookupPhonePlaceholder`, `lookupNamePlaceholder`, `clientsFoundCount`, `createClientRow`, `clearSearch`, `searchAction`; the CSS classes `.if-search`, `.if-search-input`, `.if-search-trail`, `.if-banner`.
- Consumes: nothing.

- [ ] **Step 1: Add the strings to both locales**

In `src/i18n/translations.js`, add to `ka` and `en`. Georgian values are
fixed by the canvas — use them verbatim:

```js
// ka
lookupByIdTab: 'პირადი ნომერი',
lookupByPhoneTab: 'ტელეფონი',
lookupByNameTab: 'სახელი',
lookupIdPlaceholder: 'პირადი ან საიდენტიფიკაციო ნომერი',
lookupPhonePlaceholder: '5XX XX XX XX',
lookupNamePlaceholder: 'გვარი ან სახელი',
clientsFoundCount: 'კლიენტი',       // rendered as "3 კლიენტი"
createClientRow: 'კლიენტის შექმნა',
clearSearch: 'გასუფთავება',
searchAction: 'ძებნა',
// en
lookupByIdTab: 'ID number', lookupByPhoneTab: 'Phone', lookupByNameTab: 'Name',
lookupIdPlaceholder: 'Personal or tax ID', lookupPhonePlaceholder: '5XX XX XX XX',
lookupNamePlaceholder: 'Last or first name', clientsFoundCount: 'clients',
createClientRow: 'Create client', clearSearch: 'Clear', searchAction: 'Search',
```

Do **not** remove `filterClientsPlaceholder` or `noClientsMatchFilter` here:
`ClientLookupModal.js` still renders them until Task 5 deletes it, and
removing them now would leave the running app with `undefined` placeholders
between commits. Task 5 removes them together with the modal.

- [ ] **Step 2: Add the search field and info banner to `ios.css`**

The phase 3 primitives already cover the sheet, groups, rows, segmented
control (`.if-seg`), buttons and `.if-field-label` / `.if-field-input`. Two
are missing. Append near the other form primitives:

```css
/* Search field in a sheet header. The accent ring marks focus rather than
   a border colour change, so the field reads as active at a glance. */
.if-search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 44px;
    padding: 0 12px;
    border-radius: 12px;
    background: var(--if-bg);
    color: var(--if-label-3);
}
.if-search:focus-within { box-shadow: 0 0 0 2px var(--if-tint); }
.if-search-input.ant-input {
    border: none;
    background: transparent;
    padding: 0;
    font-size: 17px;
    color: var(--if-label);
    box-shadow: none;
}
.if-search-trail {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    height: 44px;
    margin-right: -12px;
    border: none;
    background: transparent;
    color: var(--if-label-3);
    cursor: pointer;
}
.if-search-trail.is-action { color: var(--if-tint-text); font-weight: 600; }

/* Informational banner inside a sheet (the not-found notice). */
.if-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 4px 16px 0;
    padding: 10px 14px;
    border-radius: 14px;
    background: var(--if-tint-soft);
    color: var(--if-tint-text);
}
.if-banner-text { color: var(--if-label); font-size: 15px; }
```

- [ ] **Step 3: Extend the stylesheet test**

`src/theme/iosCss.test.js` already parses `ios.css`. Add a case asserting
the four new classes exist and that no rule in the added block contains a
`#` literal colour.

- [ ] **Step 4: Run the suite and commit**

```bash
git add src/i18n/translations.js src/theme/ios.css src/theme/iosCss.test.js
git commit -m "feat(client-lookup): add the lookup strings, search field and info banner"
```

---

### Task 2: The lookup view model

**Files:**
- Create: `src/components/UserDashboard/clientLookupView.js`
- Test: `src/components/UserDashboard/clientLookupView.test.js`

**Interfaces:**
- Produces:
  ```js
  export const LOOKUP_TABS = ['id', 'phone', 'name'];          // order = display order
  export const AUTO_LOOKUP_DEBOUNCE_MS = 1500;
  export const AUTO_LOOKUP_MIN_ID_DIGITS = 9;
  export const NAME_MIN_CHARS = 3;
  export const tabConfig = (tab) => ({labelKey, placeholderKey, inputMode, trigger}); // trigger: 'auto' | 'submit'
  export const normalizePhone = (value) => string;             // strips +995 / 995 / leading 0
  export const isSearchable = (tab, value) => boolean;
  export const lookupArgs = (tab, value) => object;            // exactly one key
  export const clientRow = (client) => ({key, title, meta, address});
  export const countLabel = (count, t) => string;              // "3 კლიენტი"
  export const createSeed = (tab, value) => ({identification_number, phone, first_name, last_name});
  ```
- Consumes: nothing (pure module, no React, no antd).

- [ ] **Step 1: Write the failing tests**

`clientLookupView.test.js`, covering the spec's Tests section:

```js
describe('isSearchable', () => {
    it('needs nine digits on the id tab', () => {
        expect(isSearchable('id', '12345678')).toBe(false);
        expect(isSearchable('id', '123456789')).toBe(true);
        expect(isSearchable('id', '12345678x')).toBe(false); // digits only
    });
    it('accepts a mobile number in every written form', () => {
        ['599451230', '0599451230', '+995599451230', '995599451230']
            .forEach((v) => expect(isSearchable('phone', v)).toBe(true));
        expect(isSearchable('phone', '59945123')).toBe(false);
        expect(isSearchable('phone', '499451230')).toBe(false); // must start with 5
    });
    it('needs three characters on the name tab', () => {
        expect(isSearchable('name', 'ბე')).toBe(false);
        expect(isSearchable('name', 'ბერ')).toBe(true);
    });
});

describe('lookupArgs', () => {
    it('sends exactly one criterion', () => {
        expect(lookupArgs('id', ' 123456789 ')).toEqual({identification_number: '123456789'});
        expect(lookupArgs('phone', '0599451230')).toEqual({phone: '599451230'});
        expect(lookupArgs('name', ' ბერიძე ')).toEqual({name: 'ბერიძე'});
    });
});

describe('createSeed', () => {
    it('splits a typed name on the first space only', () => {
        expect(createSeed('name', 'გიორგი ბერიძე ჯგუფი'))
            .toMatchObject({first_name: 'გიორგი', last_name: 'ბერიძე ჯგუფი'});
        expect(createSeed('name', 'ბერიძე')).toMatchObject({first_name: 'ბერიძე', last_name: ''});
    });
    it('seeds the identifier fields from the other tabs', () => {
        expect(createSeed('id', '123456789')).toMatchObject({identification_number: '123456789'});
        expect(createSeed('phone', '0599451230')).toMatchObject({phone: '599451230'});
    });
});

describe('clientRow', () => {
    it('joins the identifier and phone with a middot and tolerates gaps', () => {
        expect(clientRow({name: 'ანა', identification_number: '01', phone: '599'}).meta)
            .toBe('01 · 599');
        expect(clientRow({name: 'ანა', phone: '599'}).meta).toBe('599');
        expect(clientRow({name: 'ანა'}).meta).toBe('');
    });
});
```

Also assert `tabConfig('id').inputMode === 'numeric'`, `tabConfig('name').trigger === 'submit'`, `tabConfig('phone').trigger === 'auto'`, and that `countLabel(3, t)` reads `3 კლიენტი`.

- [ ] **Step 2: Run them and watch them fail** (module not found).

- [ ] **Step 3: Implement the module**

Copy `normalizePhone` and the `^5\d{8}$` rule from
`ClientLookupModal.js:79-86` and the name split from its `splitName`
(`:96-102`), keeping the explanatory comments about why 9 digits and why a
name is never auto-searched.

- [ ] **Step 4: Tests green, then commit**

```bash
git add src/components/UserDashboard/clientLookupView.js src/components/UserDashboard/clientLookupView.test.js
git commit -m "feat(client-lookup): add the tabbed lookup view model"
```

---

### Task 3: The lookup sheet

**Files:**
- Create: `src/components/UserDashboard/ClientLookupSheet.js`
- Test: `src/components/UserDashboard/ClientLookupSheet.test.js`

**Interfaces:**
- Consumes: `clientLookupView.js` (all exports), `IosSheet` (`{open, onClose, title, leading, trailing, onBack, bottomBar, level}`), `IosIcon`, `clientService.checkClient`.
- Produces: `export default ClientLookupSheet` with props `{open, onSelect, onClose, onRetail}`, and the two step constants `STEP_LOOKUP` / `STEP_CREATE`.
- **Task 3 does not import `ClientCreateForm`** (it does not exist yet). The create step renders only its banner and the navbar back/save affordances in this task; Task 4 fills in the body. Task 3's tests therefore assert the *step switch* (the create title and the presence or absence of the not-found banner), not any create field.

- [ ] **Step 1: Write the failing component tests**

Mock `../../api/services` and use fake timers. Cases, one `it` each:
switching tabs clears the field and results; an id reaching 9 digits fires
one `checkClient({identification_number})` after 1500 ms; the same value
re-rendered does not fire a second call; 8 digits fires nothing; the name
tab fires nothing on a pause but fires on submit; one match calls
`onSelect(client)` and renders no list; three matches render three rows and
a click calls `onSelect` with that row's client; `CLIENT_NOT_FOUND` moves to
the create step with the banner; the create row moves there without the
banner; `onRetail` absent renders no retail button, present renders one that
calls it.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement the sheet**

Structure:

```jsx
<IosSheet open={open} onClose={onClose} level={1}
          title={step === STEP_CREATE ? t.createCustomer : t.lookupClient}
          leading={step === STEP_CREATE ? 'back' : 'close'}
          onBack={step === STEP_CREATE ? () => setStep(STEP_LOOKUP) : undefined}
          trailing={step === STEP_CREATE ? saveAction : undefined}
          bottomBar={step === STEP_LOOKUP && onRetail ? retailButton : undefined}>
```

Lookup step: `.if-seg` Segmented of the three tabs → `.if-search` holding
the search glyph, an `Input` and the trailing control (a clear × when the
field has text, replaced by a `.is-action` search button on the name tab
once `isSearchable`) → `.if-section-header` with `countLabel` when there are
results → one `.if-group` of `.if-row` results, each ending with the
`+ კლიენტის შექმნא` row in `--if-tint-text`.

Search behaviour: one `useEffect` on `[tab, value]` that (a) returns when
`tabConfig(tab).trigger !== 'auto'`, (b) returns when `!isSearchable`,
(c) returns when the value equals the last searched value, (d) otherwise
sets a 1500 ms timer calling `runSearch`. Clear the timer on change and on
unmount. `runSearch` is also the submit handler for the name tab.

`runSearch` calls `clientService.checkClient(lookupArgs(tab, value))`, then:
one match → `onSelect`; several → `setResults`; `CLIENT_NOT_FOUND` →
`setSeed(createSeed(tab, value))`, `setNotFound(true)`, `setStep(STEP_CREATE)`;
any other code → the existing `ERROR_CODE_MESSAGES` message (move that map
into this file unchanged).

Reset everything when `open` flips true, as the old modal did.

- [ ] **Step 4: Tests green, then commit**

```bash
git add src/components/UserDashboard/ClientLookupSheet.js src/components/UserDashboard/ClientLookupSheet.test.js
git commit -m "feat(client-lookup): add the lookup sheet with three tabs over one field"
```

---

### Task 4: The create form

**Files:**
- Create: `src/components/UserDashboard/ClientCreateForm.js`
- Test: `src/components/UserDashboard/ClientCreateForm.test.js`
- Modify: `src/components/UserDashboard/ClientLookupSheet.js` (render it, wire the navbar save)

**Interfaces:**
- Consumes: `clientCreateRecovery.js` (`isIndeterminateFailure`, `recoverCreatedClient`, `CREATE_RECOVERY_RETRY_MS` value from the plan), `clientService.createClient` / `checkClient` / `lookupRsGe` / `searchAddresses`, `AddressMapPicker`.
- Produces: `ClientCreateForm({seed, showNotFoundBanner, onCreated, registerSubmit})` — `registerSubmit(fn)` hands the sheet the submit function for its navbar `შენახვა` action, and `onCreated(client)` is the sheet's `onSelect`.

- [ ] **Step 1: Write the failing tests**

First and last name required, nothing else; the RS.ge pill fills both names
from a response, leaves an omitted name untouched, and shows the right
message for `RS_GE_NOT_FOUND`, `RS_GE_TIMEOUT` and a generic failure; a
successful create calls `onCreated` with upstream data folded over typed
values; an indeterminate failure runs `recoverCreatedClient` and a recovered
client reports success; an unresolvable one warns and does **not** call
`onCreated`.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement the form**

Port `handleRsGeLookup` (`ClientLookupModal.js:291-321`), `handleCreate`
(`:323-376`) and the address search (`:394-441`, keeping
`addressSearchSeq`) verbatim in behaviour. Markup: `.if-banner` when
`showNotFoundBanner`; `.if-seg` for `is_phys`; `.if-group`s of rows where
each row is `.if-field-label` above `.if-field-input`; the RS.ge control as
a 44 px tint-soft pill in the identification row's trailing slot; phones and
email each on their own row; then a `მისამართი` section with the
`AutoComplete` row and `AddressMapPicker` unchanged.

- [ ] **Step 4: Tests green, then commit**

```bash
git add src/components/UserDashboard/ClientCreateForm.js src/components/UserDashboard/ClientCreateForm.test.js src/components/UserDashboard/ClientLookupSheet.js
git commit -m "feat(client-lookup): add the create form with labels above fields"
```

---

### Task 5: Wire it in and delete the modal

**Files:**
- Modify: `src/components/UserDashboard/UserDashboard.js:1018-1033`
- Delete: `src/components/UserDashboard/ClientLookupModal.js`
- Modify: `src/i18n/translations.js` (only if Task 1 left dead keys)

**Interfaces:**
- Consumes: `ClientLookupSheet` from Task 3.

- [ ] **Step 1: Swap both call sites**

Replace the two `<ClientLookupModal …>` elements with `<ClientLookupSheet …>`,
passing the identical props (the change-customer instance still passes no
`onRetail`). Change nothing in `handleClientSelected`,
`handleChangeCustomerSelected`, `handleCloseClientLookup` or the `addFlow`
wiring.

- [ ] **Step 2: Delete the modal and check for orphans**

```bash
git rm src/components/UserDashboard/ClientLookupModal.js
```

Then grep `src/` for `ClientLookupModal`, `filterClientsPlaceholder`,
`noClientsMatchFilter` and `PHONE_FIELD_FLEX`; nothing may remain. Check the
i18n keys the old modal owned: any key no longer referenced anywhere is
deleted from both locales in the same commit.

- [ ] **Step 3: Run the full suite**

Expected: every pre-existing suite still green, `clientCreateRecovery.test.js`
and `addFlow.test.js` untouched and passing, plus the three new suites.

- [ ] **Step 4: Commit**

```bash
git add src/components/UserDashboard/UserDashboard.js src/i18n/translations.js
git commit -m "refactor(client-lookup): open the client sheet from the dashboard and remove the modal"
```
