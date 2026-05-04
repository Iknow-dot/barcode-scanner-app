# Order Panel Two-Step Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the mobile `OrderPanel` drawer into two sequential steps — Products (items + total) on step 1, Delivery (delivery section + order notes) on step 2 — without changing any backend behavior.

**Architecture:** Add a single `step` state inside `OrderPanel.js`. Render an Ant Design `Steps` indicator above the existing customer-info bar. Conditionally render the items block or the delivery+notes block in the middle region. Replace the bottom CTA with an action bar that swaps between "Next →" (step 1) and "← Back / Proceed to payment" (step 2). Add `destroyOnHidden` to the parent order `<Drawer>` so reopening always lands on step 1.

**Tech Stack:** React 18, Ant Design 6 (`Steps`, `Drawer`, `Button`, `Flex`, `Popconfirm`), existing i18n (`useLanguage`), existing `orderService` autosave.

---

## File Structure

- `barcode-scanner-frontend/src/i18n/translations.js` — add 4 new translation keys to both `ka` and `en` blocks. Existing keys (`proceedToPayment`, `confirmProceedToPayment`, `saveForLater`) reused.
- `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js` — add `step` state, `Steps` indicator, conditional middle, action bar, sync-effect reset.
- `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js` — add `destroyOnHidden` prop to the order drawer.

No backend changes, no migrations, no test file changes.

---

### Task 1: Add i18n keys

Add four new keys for the step labels and navigation buttons. Place them in both the Georgian (`ka`) and English (`en`) blocks alongside the other order-related keys (right after `proceedToPayment`).

**Files:**
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` around line 319 (Georgian block) and line 799 (English block)

- [ ] **Step 1: Add Georgian keys after line 319 (`proceedToPayment` in `ka` block)**

Open `barcode-scanner-frontend/src/i18n/translations.js`. Find the line:

```js
        proceedToPayment: 'გადახდაზე გადასვლა',
```

Insert the following four lines immediately after it (preserving the existing 8-space indentation):

```js
        stepProducts: 'პროდუქტები',
        stepDelivery: 'მიწოდება',
        nextStep: 'შემდეგი',
        backStep: 'უკან',
```

- [ ] **Step 2: Add English keys after line 799 (`proceedToPayment` in `en` block)**

Find the line:

```js
        proceedToPayment: 'Proceed to Payment',
```

Insert the following four lines immediately after it (preserving the existing 8-space indentation):

```js
        stepProducts: 'Products',
        stepDelivery: 'Delivery',
        nextStep: 'Next',
        backStep: 'Back',
```

- [ ] **Step 3: Verify both insertions**

Run:

```bash
grep -n "stepProducts\|stepDelivery\|nextStep\|backStep" barcode-scanner-frontend/src/i18n/translations.js
```

Expected output: 8 lines total (4 in `ka` block, 4 in `en` block).

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/i18n/translations.js
git commit -m "i18n(orders): keys for 2-step order drawer flow"
```

---

### Task 2: Make order drawer unmount on close

Add `destroyOnHidden` to the order `<Drawer>` so that `OrderPanel` unmounts whenever the drawer closes. This guarantees that every reopen starts at step 1 (because `useState(1)` initializes fresh on remount). The neighbouring search drawer already uses this prop (line 877), so the pattern is established.

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js` around line 982-989

- [ ] **Step 1: Add the prop**

Open `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`. Find the order drawer block (it's the second `<Drawer>` in the file, with `className="m-order-drawer"`). The current props block looks like this:

```jsx
                placement="bottom"
                closable={true}
                open={orderDrawerVisible && showOrderPanel}
                onClose={closeOrderDrawer}
                height="85vh"
                className="m-order-drawer"
                styles={{
                    body: {padding: 0, overflow: 'hidden'},
                }}
```

Replace it with (adds `destroyOnHidden` between `className` and `styles`):

```jsx
                placement="bottom"
                closable={true}
                open={orderDrawerVisible && showOrderPanel}
                onClose={closeOrderDrawer}
                height="85vh"
                className="m-order-drawer"
                destroyOnHidden
                styles={{
                    body: {padding: 0, overflow: 'hidden'},
                }}
```

- [ ] **Step 2: Verify the prop is in place**

Run:

```bash
grep -A1 'className="m-order-drawer"' barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js
```

Expected output should show `destroyOnHidden` on the line right after the `className` line.

- [ ] **Step 3: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js
git commit -m "refactor(dashboard): unmount order drawer content on close"
```

---

### Task 3: Add `Steps` import to `OrderPanel`

Pull the `Steps` component into the existing antd import block.

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js` around line 7-27

- [ ] **Step 1: Update the antd imports**

Open `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js`. The current import block is:

```js
import {
    Card,
    Tag,
    Typography,
    Flex,
    Button,
    InputNumber,
    Empty,
    Popconfirm,
    Space,
    Badge,
    Radio,
    Input,
    DatePicker,
    TimePicker,
    Divider,
    Collapse,
    Select,
    Dropdown,
    Modal,
} from 'antd';
```

Replace it with (adds `Steps` alphabetically before `Tag`):

```js
import {
    Card,
    Steps,
    Tag,
    Typography,
    Flex,
    Button,
    InputNumber,
    Empty,
    Popconfirm,
    Space,
    Badge,
    Radio,
    Input,
    DatePicker,
    TimePicker,
    Divider,
    Collapse,
    Select,
    Dropdown,
    Modal,
} from 'antd';
```

- [ ] **Step 2: Verify**

Run:

```bash
grep -n "    Steps," barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js
```

Expected: one match.

(No commit yet — Tasks 3 through 7 ship together as a single feature commit at the end of Task 7.)

---

### Task 4: Add `step` state and reset logic

Add a `useState` for `step` (initial value 1) inside the `OrderPanel` component, and extend the existing `initialOrder.id` change branch of the sync effect to reset `step` to 1 when the active order changes.

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js` around lines 902-930

- [ ] **Step 1: Add the `step` state declaration**

Find the existing line (around line 903):

```js
    const [deliveryExpanded, setDeliveryExpanded] = useState(
        initialOrder?.delivery_type === 'delivery' ? ['delivery'] : []
    );
```

Insert the following line **immediately above** it (so `step` is the first state in the component, matching the natural top-down order):

```js
    const [step, setStep] = useState(1);
```

The block becomes:

```js
    const [step, setStep] = useState(1);
    const [deliveryExpanded, setDeliveryExpanded] = useState(
        initialOrder?.delivery_type === 'delivery' ? ['delivery'] : []
    );
```

- [ ] **Step 2: Reset `step` in the id-change branch of the sync effect**

Find the existing effect (around line 916-930):

```js
    useEffect(() => {
        // Always sync if order ID changed (different order loaded)
        if (initialOrder?.id !== lastOrderIdRef.current) {
            setLocalOrder(initialOrder);
            lastOrderIdRef.current = initialOrder?.id;
            lastItemCountRef.current = initialOrder?.items?.length || 0;
            return;
        }
        // Sync if items were added from outside (item count increased externally)
        const newItemCount = initialOrder?.items?.length || 0;
        if (newItemCount !== lastItemCountRef.current) {
            setLocalOrder(initialOrder);
            lastItemCountRef.current = newItemCount;
        }
    }, [initialOrder]);
```

Replace it with (adds `setStep(1)` inside the id-change branch only — items-added externally does NOT reset the step):

```js
    useEffect(() => {
        // Always sync if order ID changed (different order loaded)
        if (initialOrder?.id !== lastOrderIdRef.current) {
            setLocalOrder(initialOrder);
            lastOrderIdRef.current = initialOrder?.id;
            lastItemCountRef.current = initialOrder?.items?.length || 0;
            setStep(1);
            return;
        }
        // Sync if items were added from outside (item count increased externally)
        const newItemCount = initialOrder?.items?.length || 0;
        if (newItemCount !== lastItemCountRef.current) {
            setLocalOrder(initialOrder);
            lastItemCountRef.current = newItemCount;
        }
    }, [initialOrder]);
```

- [ ] **Step 3: Verify**

Run:

```bash
grep -n "const \[step, setStep\]\|setStep(1)" barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js
```

Expected: 2 lines — one declaration, one `setStep(1)` inside the effect.

(No commit yet — continues into Task 5.)

---

### Task 5: Render the `Steps` indicator below the customer-info bar

Add a two-item `Steps` component immediately below the customer-info bar. Tapping a step item navigates; step 2 is disabled when the cart is empty.

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js` around lines 1029-1035

- [ ] **Step 1: Insert the `Steps` indicator**

Find the existing block (around line 1029-1035):

```jsx
            {/* Customer info (in drawer mode) */}
            {isMobileDrawer && (
                <Flex align="center" gap={8} className="m-customer-bar">
                    <UserOutlined style={{color: '#1677ff'}}/>
                    <Text strong>{localOrder.customer_name}</Text>
                </Flex>
            )}
```

Replace it with (adds the `Steps` component after the customer bar, **outside** the `isMobileDrawer` conditional so the indicator shows in both rendering modes):

```jsx
            {/* Customer info (in drawer mode) */}
            {isMobileDrawer && (
                <Flex align="center" gap={8} className="m-customer-bar">
                    <UserOutlined style={{color: '#1677ff'}}/>
                    <Text strong>{localOrder.customer_name}</Text>
                </Flex>
            )}

            {/* Step indicator */}
            <Steps
                current={step - 1}
                size="small"
                onChange={(idx) => {
                    const target = idx + 1;
                    if (target === 2 && !hasItems) return;
                    setStep(target);
                }}
                items={[
                    {title: t.stepProducts},
                    {title: t.stepDelivery, disabled: !hasItems},
                ]}
                style={{margin: '8px 0 12px'}}
            />
```

- [ ] **Step 2: Verify the indicator block exists**

Run:

```bash
grep -n "Step indicator\|current={step - 1}" barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js
```

Expected: 2 matches (the comment and the `current` prop).

(No commit yet — continues into Task 6.)

---

### Task 6: Make the middle region step-conditional and replace the bottom CTA with the action bar

This is the substantive UI swap. The items list + total block becomes step-1-only. The `DeliverySection` + `NotesSection` block becomes step-2-only. The single `Proceed to Payment` button is replaced with an action bar that swaps between "Next →" (step 1) and "← Back / Proceed to payment" (step 2).

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js` around lines 1037-1112

- [ ] **Step 1: Wrap the items section in a step-1 guard**

Find the items section (around lines 1037-1071):

```jsx
            {/* Items */}
            {hasItems ? (
                <>
                    <div className="m-order-items-list">
                        {groups.map((group) => (
                            <OrderItemGroupCard
                                key={group.sku}
                                group={group}
                                orderId={localOrder.id}
                                onLocalOrderUpdate={handleLocalOrderUpdate}
                                notify={notify}
                                t={t}
                                unitOptions={unitOptions}
                                discountConfig={discountConfig}
                            />
                        ))}
                    </div>

                    {/* Order Total */}
                    <div className="m-order-total-bar">
                        <Text style={{fontSize: 15}}>{t.orderTotal}:</Text>
                        <Title level={4} style={{margin: 0, color: '#52c41a'}}>
                            {localOrder.total} ₾
                        </Title>
                    </div>
                </>
            ) : (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                        <span style={{opacity: 0.6}}>{t.scanToAddProduct}</span>
                    }
                    style={{margin: '24px 0'}}
                />
            )}
```

Replace it with (wraps the entire `hasItems ? … : <Empty/>` ternary in `step === 1 && (…)`):

```jsx
            {/* Step 1 — Products */}
            {step === 1 && (
                hasItems ? (
                    <>
                        <div className="m-order-items-list">
                            {groups.map((group) => (
                                <OrderItemGroupCard
                                    key={group.sku}
                                    group={group}
                                    orderId={localOrder.id}
                                    onLocalOrderUpdate={handleLocalOrderUpdate}
                                    notify={notify}
                                    t={t}
                                    unitOptions={unitOptions}
                                    discountConfig={discountConfig}
                                />
                            ))}
                        </div>

                        {/* Order Total */}
                        <div className="m-order-total-bar">
                            <Text style={{fontSize: 15}}>{t.orderTotal}:</Text>
                            <Title level={4} style={{margin: 0, color: '#52c41a'}}>
                                {localOrder.total} ₾
                            </Title>
                        </div>
                    </>
                ) : (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={
                            <span style={{opacity: 0.6}}>{t.scanToAddProduct}</span>
                        }
                        style={{margin: '24px 0'}}
                    />
                )
            )}
```

- [ ] **Step 2: Wrap the delivery + notes section in a step-2 guard**

Find the block (around lines 1073-1090):

```jsx
            {/* Delivery Conditions */}
            <Divider style={{margin: '12px 0 8px'}}/>
            <DeliverySection
                order={localOrder}
                onLocalOrderUpdate={handleLocalOrderUpdate}
                notify={notify}
                t={t}
                deliveryExpanded={deliveryExpanded}
                setDeliveryExpanded={setDeliveryExpanded}
            />

            {/* Order Notes */}
            <NotesSection
                order={localOrder}
                onLocalOrderUpdate={handleLocalOrderUpdate}
                notify={notify}
                t={t}
            />
```

Replace it with (wraps both sections in `step === 2 && (…)`, drops the `Divider` since the `Steps` indicator already separates the regions):

```jsx
            {/* Step 2 — Delivery + Notes */}
            {step === 2 && (
                <>
                    <DeliverySection
                        order={localOrder}
                        onLocalOrderUpdate={handleLocalOrderUpdate}
                        notify={notify}
                        t={t}
                        deliveryExpanded={deliveryExpanded}
                        setDeliveryExpanded={setDeliveryExpanded}
                    />

                    {/* Order Notes */}
                    <NotesSection
                        order={localOrder}
                        onLocalOrderUpdate={handleLocalOrderUpdate}
                        notify={notify}
                        t={t}
                    />
                </>
            )}
```

- [ ] **Step 3: Replace the single CTA with the step-aware action bar**

Find the existing primary CTA block (around lines 1092-1112):

```jsx
            {/* Primary CTA — Save / Delete are in the actions menu (top-right) */}
            <div className="m-order-actions">
                <Popconfirm
                    title={t.confirmProceedToPayment}
                    onConfirm={onProceedToPayment}
                    okText={t.yes}
                    cancelText={t.no}
                    disabled={!hasItems}
                >
                    <Button
                        type="primary"
                        icon={<DollarOutlined/>}
                        disabled={!hasItems}
                        className="m-order-action-btn"
                        size="large"
                        block
                    >
                        {t.proceedToPayment}
                    </Button>
                </Popconfirm>
            </div>
```

Replace it with (step 1 → single Next button, full width, disabled when no items; step 2 → Back + Proceed in a row, Proceed keeps the Popconfirm):

```jsx
            {/* Action bar — step-aware */}
            <div className="m-order-actions">
                {step === 1 ? (
                    <Button
                        type="primary"
                        disabled={!hasItems}
                        onClick={() => setStep(2)}
                        className="m-order-action-btn"
                        size="large"
                        block
                    >
                        {t.nextStep} →
                    </Button>
                ) : (
                    <Flex gap={8}>
                        <Button
                            onClick={() => setStep(1)}
                            size="large"
                            style={{flex: 1}}
                        >
                            ← {t.backStep}
                        </Button>
                        <Popconfirm
                            title={t.confirmProceedToPayment}
                            onConfirm={onProceedToPayment}
                            okText={t.yes}
                            cancelText={t.no}
                            disabled={!hasItems}
                        >
                            <Button
                                type="primary"
                                icon={<DollarOutlined/>}
                                disabled={!hasItems}
                                size="large"
                                style={{flex: 2}}
                            >
                                {t.proceedToPayment}
                            </Button>
                        </Popconfirm>
                    </Flex>
                )}
            </div>
```

- [ ] **Step 4: Verify the three blocks are in place**

Run:

```bash
grep -n "Step 1 — Products\|Step 2 — Delivery\|Action bar — step-aware" barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js
```

Expected: 3 matches.

(No commit yet — continues into Task 7.)

---

### Task 7: Manual verification + single feature commit

Boot the dev stack and walk through every state transition. Once the manual checks pass, commit Tasks 3–7 together.

- [ ] **Step 1: Start the dev stack**

Run (in a separate terminal so it stays running):

```bash
docker-compose up --build -d
```

Wait for the frontend to be reachable at `http://localhost:3000` and the backend at `http://localhost:8080`.

- [ ] **Step 2: Walk the golden path**

Log in as a `company_user`, open an existing order or create a new one (scan a product or use manual search to add an item to a customer's order).

Verify:

1. Tap the cart FAB to open the order drawer. The drawer opens at **step 1**: items list + order total visible; bottom button reads "Next →".
2. Tap "Next →". Drawer transitions to **step 2**: `DeliverySection` (pickup/delivery radio + conditional address/date/time/notes) and `NotesSection` (collapsible) visible. Bottom row shows "← Back" (left) and "Proceed to Payment" (right, primary).
3. Tap "← Back". Returns to step 1.
4. From step 1, tap the "Delivery" item in the `Steps` indicator. Jumps to step 2.
5. From step 2, tap the "Products" item in the `Steps` indicator. Jumps to step 1.

- [ ] **Step 3: Walk the empty-cart path**

Remove all items from the order (use the trash icon on each item card from step 1).

Verify:

1. The "Next →" button on step 1 becomes disabled.
2. Tapping the "Delivery" step in the indicator does nothing (and the step is rendered as disabled — greyed out).
3. The empty `<Empty/>` placeholder shows on step 1.

- [ ] **Step 4: Walk the delivery-edit path**

Re-add an item, navigate to step 2, switch the radio to "Delivery", fill in an address, pick a date and a time-from. Then:

1. Tap "← Back" to step 1; the cart still shows the item.
2. Close the drawer (tap outside or use the close button); the cart FAB still shows the item count.
3. Tap the cart FAB to reopen — it lands on **step 1** (not step 2). Tap "Next →" and verify the address/date/time you entered are still populated (autosave intact).

- [ ] **Step 5: Walk the Proceed-to-Payment path**

From step 2, tap "Proceed to Payment". The Popconfirm appears. Tap "Yes". The order proceeds through the existing `onProceedToPayment` callback unchanged (no regression in the payment flow).

- [ ] **Step 6: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js
git commit -m "feat(orders): split order drawer into Products + Delivery steps"
```

- [ ] **Step 7: Final state check**

Run:

```bash
git log --oneline -5
```

Expected: three new commits on top of the spec commit (`44767a3`):

1. `i18n(orders): keys for 2-step order drawer flow`
2. `refactor(dashboard): unmount order drawer content on close`
3. `feat(orders): split order drawer into Products + Delivery steps`
