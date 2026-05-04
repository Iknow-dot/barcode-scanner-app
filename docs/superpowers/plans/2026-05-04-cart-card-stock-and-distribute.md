# Cart Card — Stock + Auto-Distribute + Reset-Price Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the cart's `OrderItemGroupCard` into a tap-to-expand card that displays remaining stock per warehouse, exposes a total-quantity input that auto-distributes the requested quantity across the user's assigned warehouses (then others) by stock-desc, and offers ↺ reset-price actions both per-warehouse and group-shared.

**Architecture:** Lazy-fetch SKU stock from the existing product-search endpoint (with a new `include_images=false` flag to skip the slow base64 image inlining) when the user first interacts with the card. A pure `distributeStock` function computes a target distribution; an async apply step diffs the target against current group items and issues `add_item` / `update_item` / `remove_item` calls in parallel. The `OrderItemCard` early-return is dropped — every group, single-warehouse or multi-, renders through the same `OrderItemGroupCard` code path.

**Tech Stack:** React 18, Ant Design 6 (`InputNumber`, `Button`, `Tag`, `Flex`, `Tooltip`, `Modal`), existing `orderService` (`addOrderItem`, `updateOrderItem`, `removeOrderItem`, `bulkUpdateOrderItems`), existing `productService.searchProduct`, existing `groupItemsBySku`, `AuthContext` for `userWarehouses`. Backend Django/DRF (`ProductSearchAPIView`).

---

## File Structure

- **Backend**
  - `backend/core/views.py` — `ProductSearchAPIView.post` reads `include_images` from `request.data` (default `True`); when `False`, the base64 inlining loop is skipped and `images` is returned as `[]`.
- **Frontend**
  - `barcode-scanner-frontend/src/api/services/productService.js` — `searchProduct` signature changes from `(sku, searchType, warehouseCodes)` to a single options object `{sku, searchType, warehouseCodes, includeImages = true}`.
  - `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js` — update the single existing `searchProduct` caller to pass an options object.
  - `barcode-scanner-frontend/src/components/UserDashboard/inheritFromGroup.js` (NEW) — pure helper that reads the override-inheritable fields from a group object (price override, discount, unit). Replaces the body of `UserDashboard.js`'s `inheritFromExistingGroup` and is reused by the cart card's auto-distribute add path.
  - `barcode-scanner-frontend/src/components/UserDashboard/distributeStock.js` (NEW) — pure function `distributeStock(target, warehouses, assignedCodes) → Map<warehouse_code, qty>`.
  - `barcode-scanner-frontend/src/components/UserDashboard/distributeStock.test.js` (NEW) — Jest unit tests.
  - `barcode-scanner-frontend/src/i18n/translations.js` — five new keys in both `ka` and `en` blocks (`totalQuantity`, `stockRemaining`, `exceedsStock`, `resetPrice`, `assignedWarehouse`).
  - `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js` — large diff: delete `OrderItemCard`, update `WarehouseSubRow` (stock + ↺ + assigned indicator), update `SharedDiscountControl` (group ↺), refactor `OrderItemGroupCard` (single rendering path, click-to-expand header zone, stock-fetch hook, total-quantity input with ⚠ caption, debounced auto-distribute apply).

---

### Task 1: Backend — `include_images` flag on `ProductSearchAPIView`

Add an opt-out for the heavy base64 image fetch loop. Default behavior is unchanged.

**Files:**
- Modify: `backend/core/views.py:285-341`

- [ ] **Step 1: Add a Django test exercising the flag**

Open `backend/core/tests.py` (or wherever `ProductSearchAPIView` is tested — `grep -rn "ProductSearchAPIView\|product/search\|product_search" backend/core/tests*`). If a tests file for this view doesn't exist, create `backend/core/tests/test_product_search.py`.

Add this test, using the same patching style the existing core tests use for `ConsultWebExchangeClient.get_stock_and_prices` (search the codebase: `grep -n "get_stock_and_prices" backend/core/tests*`). If no test exists at all, here's a self-contained test:

```python
from unittest.mock import patch

from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from core.models import Organization, Warehouse
from users.models import User


class ProductSearchIncludeImagesTests(APITestCase):
    def setUp(self):
        self.org = Organization.objects.create(
            name="Org",
            web_service_url="https://example.invalid/",
            web_service_username="x",
        )
        self.org.encrypt_password("y")
        self.org.save()
        self.user = User.objects.create_user(
            username="u", password="p",
            role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.warehouse = Warehouse.objects.create(
            organization=self.org, code="W1", name="Main",
        )
        self.warehouse.users.add(self.user)
        self.client.force_authenticate(self.user)

    @patch("core.views.ConsultWebExchangeClient")
    def test_include_images_false_skips_image_fetch(self, mock_client_cls):
        mock_client_cls.return_value.get_stock_and_prices.return_value = {
            "sku": "SKU1",
            "sku_name": "Name",
            "article": "A1",
            "price": "10.00",
            "stock": [{"warehouse": "W1", "warehouse_name": "Main", "quantity": 5, "price": "10.00"}],
            "img_url": ["https://example.invalid/img.jpg"],
        }
        response = self.client.post(
            reverse("product_search"),
            {"sku": "SKU1", "is_barcode": True, "warehouses": ["W1"], "include_images": False},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["images"], [])
```

The expected behavior: when `include_images=False`, the response has `images=[]` and the test does NOT make HTTP image fetches (the `httpx.get` loop is skipped).

If the URL name `product_search` doesn't exist, find the actual name with `grep -n "product_search\|name=" backend/backend/urls.py backend/core/urls.py`.

- [ ] **Step 2: Run the test to verify it fails**

Run from the repo root:

```bash
cd backend && python manage.py test core.tests.ProductSearchIncludeImagesTests -v 2
```

Expected: FAIL — current code always tries to fetch the image and returns it base64-encoded; the assertion `images == []` fails.

- [ ] **Step 3: Implement the flag**

Open `backend/core/views.py`. Find the `ProductSearchAPIView.post` method (around line 290). Replace the existing image-fetch block (lines 314-338) with a guard that respects `include_images`.

Find:

```python
        # Convert img_url to Base64-encoded images
        if 'img_url' in product_data:
            base64_images = []
            for url in product_data['img_url']:
                try:
                    if not url:
                        logging.warning(f"Empty image URL for product with barcode {sku}")
                        continue
                    https_url = _convert_to_https(url)
                    image_response = httpx.get(https_url)
                    if image_response.status_code == 200:
                        base64_string = base64.b64encode(image_response.content).decode('utf-8')
                        base64_images.append({
                            "original_url": https_url,
                            "base64": f"data:image/jpeg;base64,{base64_string}"
                        })
                    else:
                        logging.warning(
                            f"Failed to fetch image from {https_url}: Status code {image_response.status_code}")
                except Exception as e:
                    logging.error(f"Error fetching image from {url}: {e}")

            # Add Base64 images to product data
            product_data['images'] = base64_images
            del product_data['img_url']
```

Replace with:

```python
        # Convert img_url to Base64-encoded images. include_images defaults
        # to True (backward-compatible); set to False from low-bandwidth
        # callers like the cart card's stock-only fetch.
        include_images = bool(request.data.get('include_images', True))
        if 'img_url' in product_data:
            if include_images:
                base64_images = []
                for url in product_data['img_url']:
                    try:
                        if not url:
                            logging.warning(f"Empty image URL for product with barcode {sku}")
                            continue
                        https_url = _convert_to_https(url)
                        image_response = httpx.get(https_url)
                        if image_response.status_code == 200:
                            base64_string = base64.b64encode(image_response.content).decode('utf-8')
                            base64_images.append({
                                "original_url": https_url,
                                "base64": f"data:image/jpeg;base64,{base64_string}"
                            })
                        else:
                            logging.warning(
                                f"Failed to fetch image from {https_url}: Status code {image_response.status_code}")
                    except Exception as e:
                        logging.error(f"Error fetching image from {url}: {e}")
                product_data['images'] = base64_images
            else:
                product_data['images'] = []
            del product_data['img_url']
```

- [ ] **Step 4: Re-run the test to verify it passes**

```bash
cd backend && python manage.py test core.tests.ProductSearchIncludeImagesTests -v 2
```

Expected: PASS.

- [ ] **Step 5: Run the full core test suite for regressions**

```bash
cd backend && python manage.py test core -v 2
```

Expected: every test passes (the change is additive).

- [ ] **Step 6: Commit**

```bash
git add backend/core/views.py backend/core/tests*.py
git commit -m "feat(product-search): include_images flag to skip base64 inlining"
```

---

### Task 2: Frontend — `productService.searchProduct` options-object signature

Change the function signature from positional to an options object so callers can pass `includeImages: false` without ordering issues. Update the single existing caller.

**Files:**
- Modify: `barcode-scanner-frontend/src/api/services/productService.js`
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js:185-195`

- [ ] **Step 1: Replace `searchProduct` body**

Open `barcode-scanner-frontend/src/api/services/productService.js`. Replace the entire file contents with:

```js
import api from '../request';
import API_ENDPOINTS from '../endpoints';

/**
 * Search for a product by SKU or barcode.
 *
 * @param {object} params
 * @param {string} params.sku - The SKU or barcode value
 * @param {string} params.searchType - 'barcode' or 'article'
 * @param {string[]|string} [params.warehouseCodes] - Warehouse codes to search in. Empty array → all warehouses.
 * @param {boolean} [params.includeImages=true] - When false, server skips the slow base64 image inlining and returns images=[].
 */
export const searchProduct = ({sku, searchType, warehouseCodes, includeImages = true}) => {
    const is_barcode = searchType === 'barcode';

    let warehouses;
    if (Array.isArray(warehouseCodes)) {
        warehouses = warehouseCodes;
    } else if (typeof warehouseCodes === 'string' && warehouseCodes.length > 0) {
        warehouses = warehouseCodes.split(',').map(c => c.trim()).filter(Boolean);
    } else {
        warehouses = [];
    }

    return api.post(API_ENDPOINTS.product_search, {
        sku,
        is_barcode,
        warehouses,
        include_images: includeImages,
    });
};
```

- [ ] **Step 2: Update the existing caller**

Open `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`. Find the existing call (around line 195):

```js
            const result = await productService.searchProduct(search, searchType, warehouseCodes);
```

Replace with:

```js
            const result = await productService.searchProduct({
                sku: search,
                searchType,
                warehouseCodes,
            });
```

(Don't pass `includeImages` here — the scan flow wants images, and `true` is the default.)

- [ ] **Step 3: Verify only one caller exists**

```bash
grep -rn "searchProduct\b" barcode-scanner-frontend/src/
```

Expected: exactly two matches — the export in `productService.js` and the import-and-call in `UserDashboard.js`. If anything else shows up, update those callers too.

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/api/services/productService.js barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js
git commit -m "refactor(product-service): searchProduct takes options object"
```

---

### Task 3: Extract `inheritFromGroup` util

`UserDashboard.js`'s `inheritFromExistingGroup(sku)` does two things: looks up the group by SKU and reads inheritable fields. The cart card already has the group object — it doesn't need the lookup. Extract the field-reading half so both callers share it.

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/inheritFromGroup.js`
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js:456-484`

- [ ] **Step 1: Create the util**

Create `barcode-scanner-frontend/src/components/UserDashboard/inheritFromGroup.js` with:

```js
/**
 * Read the override-inheritable fields from a grouped order item. Returns
 * an object suitable for spreading into an addOrderItem payload.
 *
 * @param {object} group - A group object as produced by groupItemsBySku.
 * @param {boolean} canApplyDiscount - Whether the current user has discount permission.
 * @returns {object} Partial payload — possibly {discounted_price, discount_percent, unit}.
 */
const inheritFromGroup = (group, canApplyDiscount) => {
    if (!group) return {};
    const inherited = {};
    if (canApplyDiscount) {
        if (!group.isMixedPrice && group.sharedDiscountedPrice != null) {
            inherited.discounted_price = group.sharedDiscountedPrice;
        }
        if (!group.isMixedDiscount && parseFloat(group.sharedDiscountPercent || 0) > 0) {
            inherited.discount_percent = group.sharedDiscountPercent;
        }
    }
    if (!group.isMixedUnit && group.sharedUnit) {
        inherited.unit = group.sharedUnit;
    }
    return inherited;
};

export default inheritFromGroup;
```

- [ ] **Step 2: Wire `UserDashboard.js`'s `inheritFromExistingGroup` to use the util**

Open `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`. Find:

```js
    const inheritFromExistingGroup = (sku) => {
        const order = activeOrderRef.current;
        if (!order || !Array.isArray(order.items)) return {};
        const groups = groupItemsBySku(order.items);
        const group = groups.find((g) => g.sku === sku);
        if (!group) return {};
        // Only inherit when the group is genuinely shared. Mixed → start
        // fresh at the warehouse's catalog price.
        const inherited = {};
        const canApplyDiscount = !!authData?.user?.can_apply_discount;
        if (canApplyDiscount) {
            if (!group.isMixedPrice && group.sharedDiscountedPrice != null) {
                inherited.discounted_price = group.sharedDiscountedPrice;
            }
            if (!group.isMixedDiscount && parseFloat(group.sharedDiscountPercent || 0) > 0) {
                inherited.discount_percent = group.sharedDiscountPercent;
            }
        }
        // unit inherits regardless of discount permission
        if (!group.isMixedUnit && group.sharedUnit) {
            inherited.unit = group.sharedUnit;
        }
        // Note: we deliberately don't inherit `price` (the line's catalog
        // price); only the override fields and unit. When the user has lost
        // discount permission, we drop those override fields too — the new
        // line is added at catalog price and the group will read as
        // "mixed", which is the right visible feedback.
        return inherited;
    };
```

Replace with:

```js
    const inheritFromExistingGroup = (sku) => {
        const order = activeOrderRef.current;
        if (!order || !Array.isArray(order.items)) return {};
        const group = groupItemsBySku(order.items).find((g) => g.sku === sku);
        return inheritFromGroup(group, !!authData?.user?.can_apply_discount);
    };
```

Add the import near the other imports (look for the existing `import groupItemsBySku from './groupItemsBySku';` and add the new import right under it):

```js
import inheritFromGroup from './inheritFromGroup';
```

- [ ] **Step 3: Verify**

```bash
grep -n "inheritFromGroup\|inheritFromExistingGroup" barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js
```

Expected: 3 lines — one import, one declaration, one body call to `inheritFromGroup(group, ...)`.

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/inheritFromGroup.js barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js
git commit -m "refactor(cart): extract inheritFromGroup util"
```

---

### Task 4: i18n keys

**Files:**
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` around line 320 (Georgian) and line 804 (English)

- [ ] **Step 1: Add Georgian keys**

Find the Georgian `proceedToPayment` block (the 4 `step*`/`*Step` keys we added earlier are right after it). After `backStep: 'უკან',` insert:

```js
        totalQuantity: 'რაოდენობა',
        stockRemaining: 'ნაშთი',
        exceedsStock: (n) => `აღემატება ნაშთს (${n} ცალი)`,
        resetPrice: 'ფასის აღდგენა',
        assignedWarehouse: 'მინიჭებული',
```

- [ ] **Step 2: Add English keys**

Find the English `backStep: 'Back',` line. After it, insert:

```js
        totalQuantity: 'Total quantity',
        stockRemaining: 'In stock',
        exceedsStock: (n) => `exceeds ${n} in stock`,
        resetPrice: 'Reset price',
        assignedWarehouse: 'Assigned',
```

- [ ] **Step 3: Verify**

```bash
grep -n "totalQuantity\|stockRemaining\|exceedsStock\|resetPrice\|assignedWarehouse" barcode-scanner-frontend/src/i18n/translations.js
```

Expected: 10 lines — 5 in `ka` block, 5 in `en` block.

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/i18n/translations.js
git commit -m "i18n(orders): keys for cart-card stock + reset-price"
```

---

### Task 5: `distributeStock` pure function (TDD)

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/distributeStock.js`
- Create: `barcode-scanner-frontend/src/components/UserDashboard/distributeStock.test.js`

- [ ] **Step 1: Write the failing tests**

Create `barcode-scanner-frontend/src/components/UserDashboard/distributeStock.test.js` with:

```js
import distributeStock from './distributeStock';

const wh = (code, quantity) => ({warehouse: code, quantity});

describe('distributeStock', () => {
    test('target fits in one assigned warehouse', () => {
        const result = distributeStock(5, [wh('W1', 10), wh('W2', 8)], new Set(['W1']));
        expect([...result.entries()]).toEqual([['W1', 5]]);
    });

    test('target spans multiple assigned warehouses, biggest first (stock-desc)', () => {
        const result = distributeStock(15, [wh('W1', 5), wh('W2', 12), wh('W3', 4)], new Set(['W1', 'W2']));
        // Assigned tier: W2 (12) > W1 (5). Allocate 12 from W2, then 3 from W1.
        expect([...result.entries()]).toEqual([['W2', 12], ['W1', 3]]);
    });

    test('target spills into non-assigned tier after assigned exhausted', () => {
        const result = distributeStock(20, [wh('W1', 10), wh('W2', 8), wh('W3', 15)], new Set(['W1']));
        // Assigned tier: W1 (10). Non-assigned tier (stock-desc): W3 (15) > W2 (8).
        // Take 10 from W1, then 10 from W3.
        expect([...result.entries()]).toEqual([['W1', 10], ['W3', 10]]);
    });

    test('target exceeds total stock — returns max allocatable', () => {
        const result = distributeStock(50, [wh('W1', 10), wh('W2', 5)], new Set(['W1']));
        expect([...result.entries()]).toEqual([['W1', 10], ['W2', 5]]);
    });

    test('zero / negative target returns empty map', () => {
        expect([...distributeStock(0, [wh('W1', 10)], new Set(['W1'])).entries()]).toEqual([]);
        expect([...distributeStock(-3, [wh('W1', 10)], new Set(['W1'])).entries()]).toEqual([]);
    });

    test('no assigned warehouses falls back entirely to non-assigned (stock-desc)', () => {
        const result = distributeStock(8, [wh('W1', 3), wh('W2', 6)], new Set());
        expect([...result.entries()]).toEqual([['W2', 6], ['W1', 2]]);
    });

    test('empty warehouses list returns empty map', () => {
        expect([...distributeStock(5, [], new Set(['W1'])).entries()]).toEqual([]);
    });

    test('warehouses with zero stock are skipped', () => {
        const result = distributeStock(5, [wh('W1', 0), wh('W2', 8)], new Set(['W1']));
        expect([...result.entries()]).toEqual([['W2', 5]]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd barcode-scanner-frontend && CI=true npm test -- --testPathPattern=distributeStock --watchAll=false
```

Expected: FAIL — `Cannot find module './distributeStock'`.

- [ ] **Step 3: Implement the function**

Create `barcode-scanner-frontend/src/components/UserDashboard/distributeStock.js`:

```js
/**
 * Allocate a target quantity across warehouses, filling the user's assigned
 * tier first (stock-desc), then non-assigned warehouses (also stock-desc).
 * Pure: no React, no API.
 *
 * @param {number} target - Desired total quantity.
 * @param {Array<{warehouse: string, quantity: number}>} warehouses - Stock entries from product-search response.
 * @param {Set<string>} assignedCodes - Warehouse codes the current user is assigned to.
 * @returns {Map<string, number>} warehouse_code → allocated qty (only entries with qty > 0).
 */
const distributeStock = (target, warehouses, assignedCodes) => {
    const result = new Map();
    if (!Number.isFinite(target) || target <= 0) return result;

    const positiveStock = (warehouses || []).filter((w) => Number(w.quantity) > 0);
    const assigned = positiveStock.filter((w) => assignedCodes.has(w.warehouse));
    const others = positiveStock.filter((w) => !assignedCodes.has(w.warehouse));
    const byStockDesc = (a, b) => Number(b.quantity) - Number(a.quantity);
    assigned.sort(byStockDesc);
    others.sort(byStockDesc);

    let remaining = target;
    for (const entry of [...assigned, ...others]) {
        if (remaining <= 0) break;
        const take = Math.min(remaining, Number(entry.quantity));
        if (take > 0) {
            result.set(entry.warehouse, take);
            remaining -= take;
        }
    }
    return result;
};

export default distributeStock;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd barcode-scanner-frontend && CI=true npm test -- --testPathPattern=distributeStock --watchAll=false
```

Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/distributeStock.js barcode-scanner-frontend/src/components/UserDashboard/distributeStock.test.js
git commit -m "feat(cart): distributeStock pure function for cart auto-distribute"
```

---

### Task 6: `OrderPanel.js` — full card refactor

This task is the substantive UI work. It bundles: drop the `OrderItemCard` early-return and delete the component; add stock-fetch hook to `OrderItemGroupCard`; add click-to-expand header zone; add total-quantity input with debounced auto-distribute apply and ⚠ exceeds caption; update `WarehouseSubRow` to render stock + assigned indicator + override-↺; update `SharedDiscountControl` to render group ↺. Everything ships as a single feature commit because the deleted-component path requires a coherent replacement.

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js` (substantial — `OrderItemCard` block deleted, `WarehouseSubRow` extended, `SharedDiscountControl` extended, `OrderItemGroupCard` body rebuilt for the unified rendering path).

- [ ] **Step 1: Add new imports for the icons used by ↺ and ⚠**

Open `barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js`. Find the existing `@ant-design/icons` import block (lines 28-41):

```js
import {
    ShoppingCartOutlined,
    DeleteOutlined,
    UserOutlined,
    SaveOutlined,
    DollarOutlined,
    CarOutlined,
    ShopOutlined,
    EnvironmentOutlined,
    CommentOutlined,
    MinusOutlined,
    PlusOutlined,
    MoreOutlined,
} from '@ant-design/icons';
```

Replace with:

```js
import {
    ShoppingCartOutlined,
    DeleteOutlined,
    UserOutlined,
    SaveOutlined,
    DollarOutlined,
    CarOutlined,
    ShopOutlined,
    EnvironmentOutlined,
    CommentOutlined,
    MinusOutlined,
    PlusOutlined,
    MoreOutlined,
    UndoOutlined,
    WarningOutlined,
} from '@ant-design/icons';
```

Find the existing `import {orderService} from '../../api';` line near the top of the file (around line 4). Replace with:

```js
import {orderService, productService} from '../../api';
```

Then find the existing `import groupItemsBySku from './groupItemsBySku';` line. After it, add two more local imports:

```js
import distributeStock from './distributeStock';
import inheritFromGroup from './inheritFromGroup';
```

- [ ] **Step 2: Update `WarehouseSubRow` — accept `stock`, `assigned`, render indicator + override-↺**

Find the existing `WarehouseSubRow` component (lines 95-163). Replace it with:

```jsx
const WarehouseSubRow = memo(({item, stock, assigned, orderId, onLocalOrderUpdate, notify, t}) => {
    const [overrideOpen, setOverrideOpen] = useState(false);

    const handleQuantityChange = useCallback(async (newQuantity) => {
        if (newQuantity < 1) return;
        const result = await orderService.updateOrderItem(orderId, item.id, {quantity: newQuantity});
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const handleOverrideSave = useCallback(async (val) => {
        const result = await orderService.updateOrderItem(orderId, item.id, {
            discounted_price: val == null ? null : val,
            discount_percent: 0,
        });
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const handleResetPrice = useCallback(async () => {
        const result = await orderService.updateOrderItem(orderId, item.id, {
            discounted_price: null,
            discount_percent: 0,
        });
        if (result.success) onLocalOrderUpdate(result.data);
        else notify.error(t.orderError, result.error);
    }, [orderId, item.id, onLocalOrderUpdate, notify, t]);

    const hasOverride = item.discounted_price != null || parseFloat(item.discount_percent || 0) > 0;

    return (
        <Flex align="center" wrap="wrap" gap={8} className="m-warehouse-subrow">
            <Tag color={assigned ? 'green' : 'blue'} style={{fontSize: 10, marginInlineEnd: 0}}>
                {item.warehouse_name}
                {assigned && <span style={{marginLeft: 4}}>✓</span>}
            </Tag>

            <div className="m-qty-stepper">
                <Button size="small" icon={<MinusOutlined/>}
                        onClick={() => handleQuantityChange(item.quantity - 1)}
                        disabled={item.quantity <= 1}
                        className="m-qty-btn"/>
                <InputNumber min={1} value={item.quantity} size="small"
                             onChange={handleQuantityChange}
                             className="m-qty-input"
                             controls={false} inputMode="numeric" pattern="[0-9]*"/>
                <Button size="small" icon={<PlusOutlined/>}
                        onClick={() => handleQuantityChange(item.quantity + 1)}
                        className="m-qty-btn"/>
            </div>

            {stock != null && (
                <Text type="secondary" style={{fontSize: 11}}>
                    {t.stockRemaining}: {stock}
                </Text>
            )}

            <Text type="secondary" style={{fontSize: 12}}>
                @ {item.effective_price} ₾
            </Text>
            <Text strong style={{fontSize: 13, color: '#52c41a'}}>
                = {item.line_total} ₾
            </Text>

            <Button type="link" size="small" onClick={() => setOverrideOpen((v) => !v)}>
                {overrideOpen ? (t.cancel || 'Cancel') : (t.overridePrice || 'Override price')}
            </Button>

            {hasOverride && (
                <Button type="text" size="small" icon={<UndoOutlined/>} onClick={handleResetPrice}
                        title={t.resetPrice} aria-label={t.resetPrice}/>
            )}

            {overrideOpen && (
                <InputNumber
                    min={0}
                    max={parseFloat(item.price || 0)}
                    defaultValue={parseFloat(item.discounted_price ?? item.price)}
                    size="small"
                    addonAfter="₾"
                    controls={false}
                    inputMode="decimal"
                    onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        handleOverrideSave(Number.isFinite(v) ? v : null);
                        setOverrideOpen(false);
                    }}
                />
            )}
        </Flex>
    );
});

WarehouseSubRow.displayName = 'WarehouseSubRow';
```

- [ ] **Step 3: Update `SharedDiscountControl` — accept `onResetGroup` and render group ↺**

Find `SharedDiscountControl` (lines 167-232). Replace with:

```jsx
const SharedDiscountControl = memo(({group, maxDiscountPercent, applyBulk, onResetGroup, t}) => {
    const [mode, setMode] = useState(
        group.sharedDiscountedPrice != null ? 'price' : 'percent'
    );
    const sharedPercent = parseFloat(group.sharedDiscountPercent || 0);
    const sharedPrice = group.sharedDiscountedPrice
        ? parseFloat(group.sharedDiscountedPrice)
        : null;

    const onPercentChange = (val) => {
        applyBulk(
            {discount_percent: val || 0, discounted_price: null},
            group.isMixedDiscount,
            (it) => `${it.discount_percent}%`,
            `${val || 0}%`,
        );
    };
    const onPriceChange = (val) => {
        applyBulk(
            {discounted_price: val ?? null, discount_percent: 0},
            group.isMixedDiscount,
            (it) => (it.discounted_price ? `${it.discounted_price} ₾` : `${it.discount_percent}%`),
            val == null ? '—' : `${val} ₾`,
        );
    };

    const hasGroupOverride =
        group.isMixedDiscount ||
        (group.sharedDiscountedPrice != null) ||
        (parseFloat(group.sharedDiscountPercent || 0) > 0);

    return (
        <Flex align="center" gap={4}>
            <Select
                value={mode}
                onChange={(m) => {
                    setMode(m);
                    if (m === 'percent') onPriceChange(null);
                    else onPercentChange(0);
                }}
                options={[{label: '%', value: 'percent'}, {label: '₾', value: 'price'}]}
                size="small"
                className="m-discount-mode"
            />
            {mode === 'percent' ? (
                <InputNumber
                    min={0}
                    max={Math.min(100, maxDiscountPercent)}
                    value={group.isMixedDiscount ? undefined : sharedPercent}
                    placeholder={group.isMixedDiscount ? (t.mixed || 'Mixed') : undefined}
                    size="small"
                    onChange={onPercentChange}
                    className="m-discount-input"
                    controls={false} inputMode="decimal" addonAfter="%"
                />
            ) : (
                <InputNumber
                    min={0}
                    value={group.isMixedDiscount ? undefined : sharedPrice}
                    placeholder={group.isMixedDiscount ? (t.mixed || 'Mixed') : t.setPrice}
                    size="small"
                    onChange={onPriceChange}
                    className="m-discount-input"
                    controls={false} inputMode="decimal" addonAfter="₾"
                />
            )}
            {hasGroupOverride && (
                <Button type="text" size="small" icon={<UndoOutlined/>}
                        onClick={onResetGroup}
                        title={t.resetPrice} aria-label={t.resetPrice}/>
            )}
        </Flex>
    );
});

SharedDiscountControl.displayName = 'SharedDiscountControl';
```

- [ ] **Step 4: Delete `OrderItemCard` entirely**

Find the `OrderItemCard` block (the comment line `// Memoized order item card component` at around line 472, through `OrderItemCard.displayName = 'OrderItemCard';` around line 687). Delete the entire block. The grouped path (`OrderItemGroupCard`) will handle every group regardless of `items.length`.

- [ ] **Step 5: Refactor `OrderItemGroupCard` body**

Find the `OrderItemGroupCard` component (it starts with `const OrderItemGroupCard = memo(({` around line 234). Replace the entire component (everything from `const OrderItemGroupCard = memo(` through `OrderItemGroupCard.displayName = 'OrderItemGroupCard';`) with:

```jsx
const OrderItemGroupCard = memo(({
    group,
    orderId,
    onLocalOrderUpdate,
    notify,
    t,
    unitOptions,
    discountConfig,
    assignedCodes,
}) => {
    const [expanded, setExpanded] = useState(false);
    const {canApplyDiscount, maxDiscountPercent} = discountConfig;

    // Lazy-loaded stock for this SKU. null = not yet fetched, [] = fetched empty,
    // 'error' = fetch failed.
    const [stock, setStock] = useState(null);
    const [stockLoading, setStockLoading] = useState(false);
    const ensureStock = useCallback(async () => {
        if (stock != null || stockLoading) return;
        setStockLoading(true);
        const result = await productService.searchProduct({
            sku: group.sku,
            searchType: 'article',
            warehouseCodes: [],
            includeImages: false,
        });
        setStockLoading(false);
        if (result.success && Array.isArray(result.data?.stock)) {
            setStock(result.data.stock);
        } else {
            setStock('error');
        }
    }, [group.sku, stock, stockLoading]);

    const stockByCode = useMemo(() => {
        if (!Array.isArray(stock)) return new Map();
        return new Map(stock.map((s) => [s.warehouse, Number(s.quantity || 0)]));
    }, [stock]);

    const totalStock = useMemo(() => {
        if (!Array.isArray(stock)) return null;
        return stock.reduce((acc, s) => acc + Number(s.quantity || 0), 0);
    }, [stock]);

    const itemIds = useMemo(
        () => group.items.map((i) => i.id),
        [group.items],
    );

    const applyBulk = useCallback(async (data, mixedFlag, formatCurrent, formatNew) => {
        const doApply = async () => {
            const result = await orderService.bulkUpdateOrderItems(orderId, itemIds, data);
            if (result.success) onLocalOrderUpdate(result.data);
            else notify.error(t.orderError, result.error);
        };

        if (mixedFlag) {
            const lines = group.items.map((it) => ({
                key: it.id,
                text: `${it.warehouse_name}: ${formatCurrent(it)} → ${formatNew}`,
            }));
            Modal.confirm({
                title: t.confirmOverwriteTitle || 'Apply to all warehouses?',
                content: (
                    <div>
                        <div>{t.confirmOverwriteBody || 'The following warehouses will change:'}</div>
                        <ul style={{fontSize: 12, marginTop: 6, paddingInlineStart: 18}}>
                            {lines.map(({key, text}) => <li key={key}>{text}</li>)}
                        </ul>
                    </div>
                ),
                okText: t.yes,
                cancelText: t.no,
                onOk: doApply,
            });
            return;
        }
        await doApply();
    }, [group.items, itemIds, orderId, onLocalOrderUpdate, notify, t]);

    const handleResetGroup = useCallback(() => {
        applyBulk(
            {discount_percent: 0, discounted_price: null},
            group.isMixedDiscount,
            (it) => (it.discounted_price ? `${it.discounted_price} ₾` : `${it.discount_percent}%`),
            '—',
        );
    }, [applyBulk, group.isMixedDiscount]);

    const handleRemoveGroup = useCallback(async () => {
        const results = await Promise.all(
            itemIds.map((id) => orderService.removeOrderItem(orderId, id))
        );
        const failed = results.find((r) => !r.success);
        if (failed) {
            notify.error(t.orderError, failed.error);
            return;
        }
        const lastOrder = results[results.length - 1].data;
        if (lastOrder) onLocalOrderUpdate(lastOrder);
    }, [itemIds, orderId, onLocalOrderUpdate, notify, t]);

    // Auto-distribute: debounce typing in the total-qty input, compute the
    // target distribution, diff, and apply via parallel add/update/remove.
    const [pendingTarget, setPendingTarget] = useState(null);
    const distributeTimerRef = useRef(null);
    const onTotalQtyChange = useCallback((val) => {
        if (val == null) return;
        ensureStock();
        setPendingTarget(val);
        if (distributeTimerRef.current) clearTimeout(distributeTimerRef.current);
        distributeTimerRef.current = setTimeout(() => applyDistribution(val), 400);
    }, [ensureStock]);

    const applyDistribution = useCallback(async (target) => {
        if (!Array.isArray(stock)) return; // stock not ready; warning shows but no apply
        const distribution = distributeStock(target, stock, assignedCodes);
        const inherited = inheritFromGroup(group, canApplyDiscount);

        const itemByCode = new Map(group.items.map((it) => [it.warehouse_code, it]));
        const calls = [];
        for (const [code, qty] of distribution) {
            const existing = itemByCode.get(code);
            if (existing) {
                if (Number(existing.quantity) !== qty) {
                    calls.push(orderService.updateOrderItem(orderId, existing.id, {quantity: qty}));
                }
            } else {
                const stockEntry = stock.find((s) => s.warehouse === code);
                calls.push(orderService.addOrderItem(orderId, {
                    sku: group.sku,
                    sku_name: group.sku_name,
                    article: group.article,
                    price: stockEntry?.price ?? 0,
                    quantity: qty,
                    warehouse_code: code,
                    warehouse_name: stockEntry?.warehouse_name || '',
                    ...inherited,
                }));
            }
        }
        for (const it of group.items) {
            if (!distribution.has(it.warehouse_code)) {
                calls.push(orderService.removeOrderItem(orderId, it.id));
            }
        }
        if (calls.length === 0) return;
        const results = await Promise.all(calls);
        const failed = results.find((r) => !r.success);
        if (failed) {
            notify.error(t.orderError, failed.error);
            return;
        }
        const last = results[results.length - 1].data;
        if (last) onLocalOrderUpdate(last);
    }, [stock, assignedCodes, group, canApplyDiscount, orderId, onLocalOrderUpdate, notify, t]);

    useEffect(() => () => {
        if (distributeTimerRef.current) clearTimeout(distributeTimerRef.current);
    }, []);

    const displayedTotalQty = pendingTarget != null ? pendingTarget : group.totalQty;
    const exceeds = totalStock != null && displayedTotalQty > totalStock;

    const handleSharedPriceChange = (val) => {
        if (val == null || !Number.isFinite(val) || val < 0) return;
        applyBulk(
            {discounted_price: val, discount_percent: 0},
            group.isMixedPrice,
            (it) => `${it.effective_price} ₾`,
            `${val} ₾`,
        );
    };

    const priceArea = (
        <Flex align="center" gap={6}>
            {group.isMixedPrice ? (
                <>
                    <Text type="secondary" style={{fontSize: 12}}>
                        {group.minPrice} ₾ – {group.maxPrice} ₾
                    </Text>
                    <Tag color="orange" style={{fontSize: 10, marginInlineEnd: 0}}>
                        {t.mixed || 'Mixed'}
                    </Tag>
                    <InputNumber
                        size="small"
                        placeholder={t.setPrice}
                        controls={false}
                        addonAfter="₾"
                        onPressEnter={(e) => handleSharedPriceChange(parseFloat(e.target.value))}
                        onBlur={(e) => {
                            const v = parseFloat(e.target.value);
                            if (Number.isFinite(v)) handleSharedPriceChange(v);
                        }}
                        style={{width: 100}}
                    />
                </>
            ) : (
                <InputNumber
                    size="small"
                    value={parseFloat(group.sharedPrice)}
                    controls={false}
                    addonAfter="₾"
                    onPressEnter={(e) => handleSharedPriceChange(parseFloat(e.target.value))}
                    onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isFinite(v) && v.toFixed(2) !== Number(group.sharedPrice).toFixed(2)) {
                            handleSharedPriceChange(v);
                        }
                    }}
                    style={{width: 100}}
                />
            )}
        </Flex>
    );

    // Render an expanded row per warehouse: union of (warehouses with order
    // lines) and (warehouses with positive stock). Order lines first, then
    // remaining stock-only warehouses.
    const expandedRows = useMemo(() => {
        const rows = group.items.map((it) => ({
            key: `line-${it.id}`,
            item: it,
            stock: stockByCode.get(it.warehouse_code),
            assigned: assignedCodes.has(it.warehouse_code),
        }));
        if (Array.isArray(stock)) {
            const presentCodes = new Set(group.items.map((it) => it.warehouse_code));
            for (const s of stock) {
                if (presentCodes.has(s.warehouse)) continue;
                if (Number(s.quantity || 0) <= 0) continue;
                rows.push({
                    key: `stock-${s.warehouse}`,
                    item: null,
                    stockEntry: s,
                    stock: Number(s.quantity || 0),
                    assigned: assignedCodes.has(s.warehouse),
                });
            }
        }
        return rows;
    }, [group.items, stock, stockByCode, assignedCodes]);

    const stopPropagation = (e) => e.stopPropagation();

    return (
        <div className="m-order-item-card m-order-item-group-card">
            {/* Clickable header zone — toggles expanded */}
            <div
                role="button"
                tabIndex={0}
                onClick={() => {
                    setExpanded((v) => !v);
                    ensureStock();
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpanded((v) => !v);
                        ensureStock();
                    }
                }}
                style={{cursor: 'pointer'}}
            >
                <Flex justify="space-between" align="start" gap={8}>
                    <div style={{flex: 1, minWidth: 0}}>
                        <Text strong style={{fontSize: 14, display: 'block'}} ellipsis>
                            {group.sku_name || group.sku}
                        </Text>
                        {group.article && (
                            <Text type="secondary" style={{fontSize: 12}}>
                                {t.article}: {group.article}
                            </Text>
                        )}
                    </div>
                    <Popconfirm
                        title={t.removeFromAllWarehouses || t.confirmDelete || 'Remove product?'}
                        onConfirm={handleRemoveGroup}
                        okText={t.yes}
                        cancelText={t.no}
                    >
                        <Button type="text" danger size="small" icon={<DeleteOutlined/>}
                                onClick={stopPropagation}
                                className="m-item-delete-btn"/>
                    </Popconfirm>
                </Flex>

                {/* Warehouse summary tags */}
                <Flex align="center" wrap="wrap" gap={6} style={{marginTop: 6}}>
                    {group.items.map((it) => (
                        <Tag key={it.id} color={assignedCodes.has(it.warehouse_code) ? 'green' : 'blue'} style={{fontSize: 10}}>
                            {it.warehouse_name}
                        </Tag>
                    ))}
                </Flex>
            </div>

            {/* Controls zone — does not toggle expand */}
            <Flex align="center" gap={8} style={{marginTop: 8}}>
                <Text type="secondary" style={{fontSize: 12}}>{t.price}:</Text>
                {priceArea}
            </Flex>

            <Flex gap={8} wrap="wrap" align="center" style={{marginTop: 10}}>
                <Text type="secondary" style={{fontSize: 12}}>{t.totalQuantity}:</Text>
                <InputNumber
                    min={0}
                    value={displayedTotalQty}
                    size="small"
                    onChange={onTotalQtyChange}
                    onFocus={ensureStock}
                    controls={false}
                    inputMode="numeric"
                    style={{width: 90}}
                />
                <Select
                    value={group.sharedUnit || undefined}
                    size="small"
                    allowClear
                    showSearch
                    placeholder={group.isMixedUnit ? (t.mixed || 'Mixed') : t.unit}
                    className="m-unit-select"
                    options={unitOptions}
                    onChange={(val) => applyBulk(
                        {unit: val || ''},
                        group.isMixedUnit,
                        (it) => (it.unit || '—'),
                        (val || '—'),
                    )}
                />
                {canApplyDiscount && maxDiscountPercent > 0 && (
                    <SharedDiscountControl
                        group={group}
                        maxDiscountPercent={maxDiscountPercent}
                        applyBulk={applyBulk}
                        onResetGroup={handleResetGroup}
                        t={t}
                    />
                )}
            </Flex>

            {exceeds && (
                <Flex align="center" gap={4} style={{marginTop: 6}}>
                    <WarningOutlined style={{color: '#faad14', fontSize: 12}}/>
                    <Text type="warning" style={{fontSize: 11}}>
                        {t.exceedsStock(totalStock)}
                    </Text>
                </Flex>
            )}

            <Flex justify="end" style={{marginTop: 8}}>
                <Text strong style={{color: '#52c41a', fontSize: 15}}>
                    {group.groupLineTotal} ₾
                </Text>
            </Flex>

            {expanded && (
                <div className="m-order-item-group-expanded">
                    {stockLoading && stock == null && (
                        <Text type="secondary" style={{fontSize: 11}}>…</Text>
                    )}
                    {stock === 'error' && (
                        <Text type="secondary" style={{fontSize: 11}}>{t.stockRemaining}: —</Text>
                    )}
                    {expandedRows.map((row) => row.item ? (
                        <WarehouseSubRow
                            key={row.key}
                            item={row.item}
                            stock={row.stock}
                            assigned={row.assigned}
                            orderId={orderId}
                            onLocalOrderUpdate={onLocalOrderUpdate}
                            notify={notify}
                            t={t}
                        />
                    ) : (
                        <Flex key={row.key} align="center" gap={8} className="m-warehouse-subrow"
                              style={{opacity: 0.6}}>
                            <Tag color={row.assigned ? 'green' : 'blue'} style={{fontSize: 10}}>
                                {row.stockEntry.warehouse_name}
                                {row.assigned && <span style={{marginLeft: 4}}>✓</span>}
                            </Tag>
                            <Text type="secondary" style={{fontSize: 11}}>
                                {t.stockRemaining}: {row.stock}
                            </Text>
                        </Flex>
                    ))}
                </div>
            )}
        </div>
    );
});

OrderItemGroupCard.displayName = 'OrderItemGroupCard';
```

- [ ] **Step 6: Compute and pass `assignedCodes` from `OrderPanel`**

Find the `OrderPanel` component body (the line `const OrderPanel = (...) => {` — around line 894). Right after the existing `const discountConfig = useMemo(...)` block, add:

```js
    const assignedCodes = useMemo(
        () => new Set((authData?.user?.warehouses || []).map((w) => w.code)),
        [authData?.user?.warehouses],
    );
```

Find the place where `OrderItemGroupCard` is rendered (around line 1042-1052):

```jsx
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
```

Add `assignedCodes={assignedCodes}` as another prop:

```jsx
                            <OrderItemGroupCard
                                key={group.sku}
                                group={group}
                                orderId={localOrder.id}
                                onLocalOrderUpdate={handleLocalOrderUpdate}
                                notify={notify}
                                t={t}
                                unitOptions={unitOptions}
                                discountConfig={discountConfig}
                                assignedCodes={assignedCodes}
                            />
```

- [ ] **Step 7: Babel-parse the file to confirm valid JSX**

```bash
cd barcode-scanner-frontend && node -e "require('@babel/parser').parse(require('fs').readFileSync('src/components/UserDashboard/OrderPanel.js', 'utf-8'), {sourceType: 'module', plugins: ['jsx']}); console.log('OK');"
```

Expected: `OK`. Any parse error → fix the indicated line/column before continuing.

- [ ] **Step 8: Frontend build to confirm no compile-level errors**

```bash
cd barcode-scanner-frontend && NODE_OPTIONS=--openssl-legacy-provider node_modules/.bin/react-scripts build 2>&1 | tail -30
```

Expected: build succeeds. Filter for OrderPanel-related warnings:

```bash
cd barcode-scanner-frontend && NODE_OPTIONS=--openssl-legacy-provider node_modules/.bin/react-scripts build 2>&1 | grep -E "OrderPanel|distributeStock|inheritFromGroup" | head -20
```

Expected: empty (no warnings introduced by the new files).

- [ ] **Step 9: Run frontend tests**

```bash
cd barcode-scanner-frontend && CI=true npm test -- --watchAll=false
```

Expected: all tests pass. The new `distributeStock` tests run alongside the existing `groupItemsBySku` ones.

(No commit yet — manual verification first in Task 7.)

---

### Task 7: Manual verification + final commit

The cart card refactor needs eyes-on testing because the layout changed and the auto-distribute touches the live order in a single user action. Walk every path on the dev stack, then commit.

- [ ] **Step 1: Start the dev stack**

Run from the repo root:

```bash
docker-compose up --build -d
```

Wait for `http://localhost:3000` (frontend) and `http://localhost:8080` (backend).

- [ ] **Step 2: Walk the click-to-expand path**

Log in as a `company_user`, open or create an order with one product line at one warehouse.

Verify:

1. Tap anywhere on the product card's **header zone** (name + tag row) — the card expands. The single warehouse subrow appears, with "in stock: K" caption and the per-warehouse qty stepper.
2. Tap the header again — collapses.
3. Tap the **delete trash icon** in the header — does NOT toggle expand; the delete Popconfirm appears.
4. Tap the **price input** in the controls zone — does NOT toggle expand; the input gets focus.
5. Tap the **discount input / unit Select** — does NOT toggle expand.

- [ ] **Step 3: Walk the stock-display path**

With the card expanded, verify:

1. The warehouse with the order line shows "in stock: K" where K matches what the scan view's balance card reports for that warehouse.
2. Other warehouses with positive stock for this SKU appear below the order-line warehouse, dimmed, with "in stock: K" — they're available targets for auto-distribute but have no order line yet.
3. The user's assigned warehouse(s) render with a green tag and a `✓` indicator (label `assignedWarehouse` underlies this in i18n).
4. Non-assigned warehouses render with a blue tag.

- [ ] **Step 4: Walk the auto-distribute path**

In the controls zone, focus the **Total quantity** input. Type a value larger than the current group's total but smaller than the SKU's total stock across all warehouses. After ~400 ms, observe:

1. New warehouse lines appear in the card to fulfil the typed total — assigned warehouses fill first (stock-desc within tier), then non-assigned (stock-desc within tier).
2. The order total updates accordingly.
3. The expanded view (if open) reflects the new lines with their stock and assigned indicator.

Now type a value LARGER than the total stock across all warehouses:

1. The cart fills up to total stock.
2. The ⚠ "exceeds K in stock" caption appears under the input. The input keeps the user-typed value.
3. The order total is the actual fulfilled quantity, not the typed target.

Now type a value LOWER than current total:

1. Some warehouse lines reduce their qty.
2. If any line drops to 0, it is removed.

- [ ] **Step 5: Walk the manual-rebalance path**

With the card expanded, tap the +/− stepper on a per-warehouse subrow:

1. The line's qty updates.
2. The total-quantity input on the collapsed view derives from the sum and stays in sync (since `displayedTotalQty` falls back to `group.totalQty` when `pendingTarget` is null).
3. The auto-distribute does NOT fire — manual edits don't trigger distribution.

- [ ] **Step 6: Walk the reset-price path**

Per-warehouse:

1. Set an override on one warehouse subrow (use the existing "Override price" link).
2. The ↺ icon appears next to it. Tap it.
3. The override clears; the line returns to catalogue price.

Group-shared:

1. Set a shared discount on the group (use the discount control in the controls zone).
2. The ↺ icon appears next to the discount control. Tap it.
3. The discount clears for every warehouse in the group.
4. If the group is mixed-discount, the ↺ tap shows the existing "apply to all warehouses" Modal.confirm before clearing — confirm and verify all warehouses are reset.

- [ ] **Step 7: Walk the fetch-failure path**

Disconnect the network or block the product-search endpoint (e.g., kill the backend container briefly). Open a card. Verify:

1. The card stays usable — header click still toggles expand.
2. The expanded view shows "in stock: —" instead of per-warehouse stock.
3. Typing in the total-quantity input shows the warning-or-no-effect path: with no stock, the auto-distribute apply step short-circuits (`if (!Array.isArray(stock)) return;`).

Bring the backend back up.

- [ ] **Step 8: Run the linter via build to confirm no new warnings**

```bash
cd barcode-scanner-frontend && NODE_OPTIONS=--openssl-legacy-provider node_modules/.bin/react-scripts build 2>&1 | grep -E "OrderPanel|distributeStock|inheritFromGroup"
```

Expected: empty output.

- [ ] **Step 9: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/OrderPanel.js
git commit -m "feat(cart): tap-to-expand card with stock + auto-distribute + reset-price"
```

- [ ] **Step 10: Final state check**

```bash
git log --oneline -8
```

Expected: 6 new commits on top of the spec commit (`0e524c4`):

1. `feat(product-search): include_images flag to skip base64 inlining`
2. `refactor(product-service): searchProduct takes options object`
3. `refactor(cart): extract inheritFromGroup util`
4. `i18n(orders): keys for cart-card stock + reset-price`
5. `feat(cart): distributeStock pure function for cart auto-distribute`
6. `feat(cart): tap-to-expand card with stock + auto-distribute + reset-price`
