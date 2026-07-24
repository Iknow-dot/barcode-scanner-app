# Unified Product Search & Category Navigation Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three disconnected product-finding UIs on the user dashboard with one "Find product" drawer (smart search box + drill-down category browse), replace the admin Catalog tab's sidebar tree with a toolbar Cascader + filter chip, and make search match `article` everywhere.

**Architecture:** Frontend-heavy rework on two components (`UserDashboard.js`, `CatalogTab.js`) with logic extracted into small pure modules (`catalogBrowse.js`, `cascaderOptions.js`) plus a new `FindProductDrawer.js` component. Two small backend query extensions (no migrations): the catalog typeahead gains SKU + exact-barcode matching and returns `article`; the catalog list endpoint's `q` gains `article__icontains`.

**Tech Stack:** Django 6 + DRF (backend, SQLite in tests), React 18 (CRA) + Ant Design 6, jest via `react-scripts test`.

**Spec:** `docs/superpowers/specs/2026-07-24-unified-search-and-category-rework-design.md`

## Global Constraints

- Repo root: `C:\Users\tavkh\PycharmProjects\barcode-scanner-app`. Backend commands run from `backend/`; frontend commands from `barcode-scanner-frontend/`.
- No model changes, no migrations, no endpoint URL changes.
- Backend error responses keep the `{"code": "...", "detail": "..."}` shape (no new error responses are added by this plan).
- Every DRF view keeps BOTH its permission class AND org-scoped queryset filtering (`organization=request.user.organization`) — never rely on just one.
- `company_user` must only ever see `is_active=True` products on catalog read endpoints; `internal_admin` gets 403 (permission `IsCompanyUserOrAdmin` — do not change it).
- Tests run on SQLite (the `connection.vendor != "postgresql"` branches are what CI exercises). Keep the Postgres trigram branch compiling but understand tests won't hit it.
- Every new user-facing string must be added to BOTH the Georgian (first) and English (second) blocks of `src/i18n/translations.js`.
- CRA invocations must keep `--openssl-legacy-provider` (already baked into `package.json` scripts — just use `npm test` / `npm start`, don't call `react-scripts` directly).
- Frontend test command (non-interactive): `npm test -- --watchAll=false`.
- Backend test command: `python manage.py test core -v 1` (or a specific class with `core.tests.<ClassName>`).
- Commit style follows the repo history: `feat(catalog): ...`, `test(catalog): ...`, `refactor(...)`. End commit messages with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer.

---

### Task 1: Backend — typeahead matches article/SKU/exact-barcode and returns `article`

**Files:**
- Modify: `backend/core/views.py:1416-1449` (`CatalogProductSearchAPIView`)
- Modify: `backend/core/serializers.py:574-579` (`CatalogProductSerializer`)
- Test: `backend/core/tests.py` (new class, add after `CatalogCategoryTreeTests` which ends at line 3603)

**Interfaces:**
- Consumes: existing models `Product` (fields `sku`, `article`, `name`, `price`, `is_active`, `image_urls`, `category`), `ProductBarcode` (`product`, `barcode`), URL name `catalog-product-search`.
- Produces: `GET /api/v1/catalog/products/search/?q=` rows now shaped `{sku, article, name, price, image, category_path}` and matching on name (trigram/icontains) OR `article__icontains` OR `sku__icontains` OR exact `barcodes__barcode`. Task 4's drawer relies on `article` being present in each row.

- [ ] **Step 1: Write the failing tests**

Append to `backend/core/tests.py` (after the `CatalogCategoryTreeTests` class, using the same imports already present at the top of the file — `Organization`, `User`, `Product`, `ProductBarcode`, `APIClient`, `reverse`, `override_settings`, `TestCase`):

```python
@override_settings(SECURE_SSL_REDIRECT=False)
class CatalogProductTypeaheadTests(TestCase):
    """GET /api/v1/catalog/products/search/ — the smart-box typeahead must
    match name, article, sku (substrings) and exact barcodes, org-scoped,
    active-only, and include `article` in each row."""

    def setUp(self):
        self.org = Organization.objects.create(
            name="Org A", identification_number="A1",
            web_service_url="https://a.example", employees_count=5,
        )
        self.user = User.objects.create_user(
            username="u1", password="pw", role=User.Role.COMPANY_USER, organization=self.org,
        )
        self.api = APIClient()
        self.api.force_authenticate(self.user)
        self.url = reverse("catalog-product-search")
        self.pan = Product.objects.create(
            organization=self.org, sku="PAN-1", name="Frying pan", article="ART-7",
        )
        ProductBarcode.objects.create(product=self.pan, barcode="4860001234567")
        Product.objects.create(organization=self.org, sku="POT-1", name="Stock pot", article="AR-9")

    def _skus(self, q):
        return [r["sku"] for r in self.api.get(self.url, {"q": q}).json()]

    def test_matches_article_substring(self):
        self.assertEqual(self._skus("art-7"), ["PAN-1"])

    def test_matches_sku_substring(self):
        # "PAN" also hits the name "Frying pan" — the same product must not
        # come back twice (regression guard for the barcode-join distinct()).
        self.assertEqual(self._skus("PAN"), ["PAN-1"])

    def test_matches_exact_barcode(self):
        self.assertEqual(self._skus("4860001234567"), ["PAN-1"])

    def test_partial_barcode_does_not_match(self):
        self.assertEqual(self._skus("48600012"), [])

    def test_rows_include_article(self):
        row = self.api.get(self.url, {"q": "Frying"}).json()[0]
        self.assertEqual(row["article"], "ART-7")

    def test_inactive_products_excluded(self):
        Product.objects.create(
            organization=self.org, sku="GONE-1", name="Old pan", article="ART-7X", is_active=False,
        )
        self.assertEqual(self._skus("ART-7"), ["PAN-1"])

    def test_scoped_to_own_org(self):
        org_b = Organization.objects.create(
            name="Org B", identification_number="B1",
            web_service_url="https://b.example", employees_count=5,
        )
        Product.objects.create(organization=org_b, sku="B-PAN", name="B pan", article="ART-7B")
        self.assertEqual(self._skus("ART-7"), ["PAN-1"])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `backend/`): `python manage.py test core.tests.CatalogProductTypeaheadTests -v 2`
Expected: `test_matches_sku_substring`, `test_matches_exact_barcode`, `test_rows_include_article` FAIL (sku/barcode don't match; `article` key absent → `KeyError`). `test_matches_article_substring` may already pass (article matching exists) — that's fine.

- [ ] **Step 3: Implement the view + serializer changes**

In `backend/core/views.py`, replace the body of `CatalogProductSearchAPIView.get` (lines 1420-1449) with:

```python
    def get(self, request: Request) -> Response:
        q = (request.query_params.get("q") or "").strip()
        if not q:
            return Response([])

        qs = Product.objects.filter(
            organization=request.user.organization, is_active=True,
        ).select_related("category")
        # Smart-box matching: fuzzy on name, substring on article/sku, exact
        # on barcode. One box on the frontend covers all four identifiers.
        ident_q = (
            models.Q(article__icontains=q)
            | models.Q(sku__icontains=q)
            | models.Q(barcodes__barcode=q)
        )
        if connection.vendor == "postgresql":
            from django.contrib.postgres.search import TrigramSimilarity
            qs = (
                qs.annotate(rank=TrigramSimilarity("name", q))
                .filter(models.Q(rank__gt=0.1) | ident_q)
                .order_by("-rank")
            )
        else:  # SQLite dev fallback
            qs = qs.filter(models.Q(name__icontains=q) | ident_q).order_by("name")

        rows = [
            {
                "sku": p.sku, "article": p.article, "name": p.name, "price": p.price,
                "image": signed_image_paths(request.user.organization_id, p.sku, len(p.image_urls))[0]
                if p.image_urls else None,
                "category_path": p.category.path_names if p.category_id else [],
            }
            for p in qs.distinct()[:20]
        ]
        return Response(CatalogProductSerializer(rows, many=True).data)
```

In `backend/core/serializers.py`, replace `CatalogProductSerializer` (lines 574-579) with:

```python
class CatalogProductSerializer(serializers.Serializer):
    sku = serializers.CharField()
    article = serializers.CharField(allow_blank=True, required=False)
    name = serializers.CharField()
    price = serializers.DecimalField(max_digits=12, decimal_places=2, allow_null=True)
    image = serializers.CharField(allow_null=True)
    category_path = serializers.JSONField(required=False)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python manage.py test core.tests.CatalogProductTypeaheadTests -v 2`
Expected: all 7 tests PASS.

Also run the neighbors that share this view: `python manage.py test core.tests.ScanResponseCategoryAttributeTests -v 1`
Expected: PASS (breadcrumb test unaffected).

- [ ] **Step 5: Commit**

```bash
git add backend/core/views.py backend/core/serializers.py backend/core/tests.py
git commit -m "feat(catalog): typeahead matches sku + exact barcode and returns article"
```

---

### Task 2: Backend — list endpoint `q` matches article

**Files:**
- Modify: `backend/core/views.py:1564` (OpenApiParameter description) and `backend/core/views.py:1589-1593` (`CatalogProductListAPIView.get_queryset` q filter)
- Test: `backend/core/tests.py` (extend `CatalogProductListTests`, class starts at line 3361)

**Interfaces:**
- Consumes: `CatalogProductListAPIView` as it exists after Task 1 (Task 1 does not touch it).
- Produces: `GET /api/v1/catalog/products/list/?q=` matches `article__icontains` in addition to name/sku/exact-barcode. The dedicated `article` query param is untouched and stays functional.

- [ ] **Step 1: Write the failing test**

Add inside `CatalogProductListTests` (after `test_search_matches_name_sku_barcode`, line 3388):

```python
    def test_search_matches_article(self):
        Product.objects.create(organization=self.org, sku="WOK-1", name="Wok", article="AR-55")
        Product.objects.create(organization=self.org, sku="LID-1", name="Lid", article="ZZ-11")
        self.assertEqual(self.api.get(self.url, {"q": "ar-55"}).json()["count"], 1)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `python manage.py test core.tests.CatalogProductListTests.test_search_matches_article -v 2`
Expected: FAIL — `AssertionError: 0 != 1` (q doesn't match article yet).

- [ ] **Step 3: Implement**

In `backend/core/views.py`, replace the q filter block (lines 1589-1593):

```python
        q = (params.get("q") or "").strip()
        if q:
            qs = qs.filter(
                models.Q(name__icontains=q) | models.Q(sku__icontains=q)
                | models.Q(article__icontains=q) | models.Q(barcodes__barcode=q)
            ).distinct()
```

And update the schema line 1564 to match:

```python
        OpenApiParameter("q", str, description="Search name/sku/article (substring) or an exact barcode."),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python manage.py test core.tests.CatalogProductListTests core.tests.CatalogProductListFilterTests -v 1`
Expected: all PASS (including the pre-existing `test_article_filter`, which proves the dedicated `article` param still works alongside).

- [ ] **Step 5: Commit**

```bash
git add backend/core/views.py backend/core/tests.py
git commit -m "feat(catalog): product-list q search matches article"
```

---

### Task 3: Frontend — `catalogBrowse` drill-down helpers (TDD)

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/catalogBrowse.js`
- Test: `barcode-scanner-frontend/src/components/UserDashboard/catalogBrowse.test.js`

**Interfaces:**
- Consumes: nothing (pure functions over the JSON returned by `GET /api/v1/catalog/categories/tree/`: nodes `{id: number, name: string, product_count: number, children: node[]}`).
- Produces (Task 4 imports exactly these):
  - `findNode(nodes, id)` → node object or `null`
  - `nodeForStack(nodes, stack)` → node for the last stack entry, or `null` for the empty stack (root)
  - `childrenForStack(nodes, stack)` → array of child nodes (top-level nodes for the empty stack)
  - `breadcrumbForStack(nodes, stack)` → array of names root→current (empty for root)
  - `parentStack(stack)` → new stack with the last entry removed
  - A "stack" is `number[]` of node ids from root to the current node; `[]` means root.

- [ ] **Step 1: Write the failing tests**

Create `barcode-scanner-frontend/src/components/UserDashboard/catalogBrowse.test.js`:

```js
import {
  findNode,
  nodeForStack,
  childrenForStack,
  breadcrumbForStack,
  parentStack,
} from './catalogBrowse';

const TREE = [
  {
    id: 1, name: 'Beverages', product_count: 74,
    children: [
      {id: 2, name: 'Coffee', product_count: 38, children: []},
      {id: 3, name: 'Tea', product_count: 24, children: []},
    ],
  },
  {id: 9, name: 'Snacks', product_count: 112, children: []},
];

test('findNode finds nested nodes and returns null for unknown ids', () => {
  expect(findNode(TREE, 3).name).toBe('Tea');
  expect(findNode(TREE, 999)).toBeNull();
  expect(findNode(undefined, 1)).toBeNull();
});

test('nodeForStack resolves the last stack entry; empty stack is root (null)', () => {
  expect(nodeForStack(TREE, [1, 2]).name).toBe('Coffee');
  expect(nodeForStack(TREE, [])).toBeNull();
});

test('childrenForStack returns roots for [] and children for a node', () => {
  expect(childrenForStack(TREE, []).map((n) => n.name)).toEqual(['Beverages', 'Snacks']);
  expect(childrenForStack(TREE, [1]).map((n) => n.name)).toEqual(['Coffee', 'Tea']);
  expect(childrenForStack(TREE, [1, 2])).toEqual([]);
  expect(childrenForStack(TREE, [999])).toEqual([]);
});

test('breadcrumbForStack returns names root→current', () => {
  expect(breadcrumbForStack(TREE, [])).toEqual([]);
  expect(breadcrumbForStack(TREE, [1, 2])).toEqual(['Beverages', 'Coffee']);
  // A stale id mid-stack truncates rather than throwing.
  expect(breadcrumbForStack(TREE, [1, 999])).toEqual(['Beverages']);
});

test('parentStack drops exactly one level and does not mutate', () => {
  const stack = [1, 2];
  expect(parentStack(stack)).toEqual([1]);
  expect(parentStack([])).toEqual([]);
  expect(stack).toEqual([1, 2]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `barcode-scanner-frontend/`): `npm test -- --watchAll=false catalogBrowse`
Expected: FAIL — `Cannot find module './catalogBrowse'`.

- [ ] **Step 3: Write the implementation**

Create `barcode-scanner-frontend/src/components/UserDashboard/catalogBrowse.js`:

```js
// Pure helpers for drill-down navigation over the category tree returned by
// GET /api/v1/catalog/categories/tree/ (nodes: {id, name, product_count, children}).
// A "stack" is the array of node ids from root to the current node; [] = root.

export function findNode(nodes, id) {
    for (const n of nodes || []) {
        if (n.id === id) return n;
        const hit = findNode(n.children, id);
        if (hit) return hit;
    }
    return null;
}

export function nodeForStack(nodes, stack) {
    return stack.length ? findNode(nodes, stack[stack.length - 1]) : null;
}

export function childrenForStack(nodes, stack) {
    if (!stack.length) return nodes || [];
    const node = nodeForStack(nodes, stack);
    return node ? node.children || [] : [];
}

export function breadcrumbForStack(nodes, stack) {
    const names = [];
    let level = nodes || [];
    for (const id of stack) {
        const node = level.find((n) => n.id === id);
        if (!node) return names;
        names.push(node.name);
        level = node.children || [];
    }
    return names;
}

export function parentStack(stack) {
    return stack.slice(0, -1);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --watchAll=false catalogBrowse`
Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/catalogBrowse.js barcode-scanner-frontend/src/components/UserDashboard/catalogBrowse.test.js
git commit -m "feat(catalog): drill-down navigation helpers for the category tree"
```

---

### Task 4: Frontend — `FindProductDrawer` component + i18n keys

**Files:**
- Create: `barcode-scanner-frontend/src/components/UserDashboard/FindProductDrawer.js`
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` (add 2 keys to each language block)

**Interfaces:**
- Consumes: Task 3 helpers (`childrenForStack`, `nodeForStack`, `breadcrumbForStack`, `parentStack`); `catalogService.searchByName(q)` / `.categoryTree()` / `.listProducts(params)` / `.imageUrl(path)` from `../../api`; typeahead rows `{sku, article, name, price, image, category_path}` (Task 1); list rows `{sku, article, name, price, images[], ...}`.
- Produces: `<FindProductDrawer open onClose onSelectProduct onScan allWarehouses onAllWarehousesChange orderMode />`
  - `open: boolean` — drawer visibility (controlled by parent)
  - `onClose(): void`
  - `onSelectProduct(sku: string): void` — called after the component clears its query; parent runs the live-stock flow
  - `onScan(): void` — parent closes drawer and opens the camera scanner
  - `allWarehouses: boolean`, `onAllWarehousesChange(checked: boolean): void`
  - `orderMode: boolean` — shows the "order mode" tag in the title
  - New i18n keys used: `t.findProductPlaceholder`, `t.productsLabel` (plus existing `t.productSearch`, `t.orderMode`, `t.allWarehouses`, `t.scanInstead`, `t.scan`, `t.allCategories`, `t.loadMore`, `t.noResults`, `t.noProductsFound`).

- [ ] **Step 1: Add the i18n keys**

In `barcode-scanner-frontend/src/i18n/translations.js`, add to the **Georgian** block (next to the other catalog keys, after `nameSearch` at line 514):

```js
        findProductPlaceholder: 'დასახელება, არტიკული ან შტრიხკოდი',
        productsLabel: 'პროდუქტები',
```

And to the **English** block (after `nameSearch` at line 1125):

```js
        findProductPlaceholder: 'Name, article, or barcode',
        productsLabel: 'Products',
```

- [ ] **Step 2: Write the component**

Create `barcode-scanner-frontend/src/components/UserDashboard/FindProductDrawer.js`:

```jsx
import React, {useState, useEffect, useMemo, useCallback, useRef} from 'react';
import {Button, Drawer, Empty, Flex, Input, List, Spin, Switch, Tag, Typography} from 'antd';
import {LeftOutlined, QrcodeOutlined, RightOutlined, SearchOutlined, ShoppingCartOutlined} from '@ant-design/icons';
import {catalogService} from '../../api';
import {useLanguage} from '../../i18n/LanguageContext';
import {childrenForStack, nodeForStack, breadcrumbForStack, parentStack} from './catalogBrowse';

const {Text} = Typography;

const PAGE_SIZE = 25;

// Unified "Find product" drawer: a smart search box (name / article / sku /
// barcode typeahead) on top, drill-down category browsing below. Replaces the
// old barcode/article search drawer, the inline name-search field, and the
// separate category-browse drawer.
const FindProductDrawer = ({
    open,
    onClose,
    onSelectProduct,
    onScan,
    allWarehouses,
    onAllWarehousesChange,
    orderMode,
}) => {
    const {t} = useLanguage();
    const inputRef = useRef(null);

    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);

    const [tree, setTree] = useState([]);
    const [treeLoaded, setTreeLoaded] = useState(false);
    // Drill-down position: array of category ids root→current; [] = root.
    const [stack, setStack] = useState([]);
    const [rows, setRows] = useState([]);
    const [count, setCount] = useState(0);
    const [page, setPage] = useState(1);
    const [browseLoading, setBrowseLoading] = useState(false);

    // Lazy-load the category tree the first time the drawer opens.
    useEffect(() => {
        if (!open || treeLoaded) return;
        let cancelled = false;
        (async () => {
            const res = await catalogService.categoryTree();
            if (!cancelled && res.success) {
                setTree(res.data || []);
                setTreeLoaded(true);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [open, treeLoaded]);

    // Debounced smart search — same 300ms pattern as the old name search.
    useEffect(() => {
        const trimmed = query.trim();
        if (!trimmed) {
            setResults([]);
            setSearchLoading(false);
            return;
        }
        const handle = setTimeout(async () => {
            setSearchLoading(true);
            try {
                const res = await catalogService.searchByName(trimmed);
                setResults(res.success && Array.isArray(res.data) ? res.data : []);
            } finally {
                setSearchLoading(false);
            }
        }, 300);
        return () => clearTimeout(handle);
    }, [query]);

    const currentId = stack.length ? stack[stack.length - 1] : null;

    const fetchProducts = useCallback(async (categoryId, pageNum) => {
        setBrowseLoading(true);
        try {
            const res = await catalogService.listProducts({
                category: categoryId, page: pageNum, page_size: PAGE_SIZE,
            });
            if (res.success) {
                const list = res.data.results || [];
                setRows((prev) => (pageNum === 1 ? list : [...prev, ...list]));
                setCount(res.data.count ?? list.length);
                setPage(pageNum);
            }
        } finally {
            setBrowseLoading(false);
        }
    }, []);

    // (Re)load the branch's products whenever the drill-down position moves.
    // At the root there is no product list (it would be the whole catalog).
    useEffect(() => {
        setRows([]);
        setCount(0);
        setPage(1);
        if (currentId != null) fetchProducts(currentId, 1);
    }, [currentId, fetchProducts]);

    const children = useMemo(() => childrenForStack(tree, stack), [tree, stack]);
    const crumb = useMemo(() => breadcrumbForStack(tree, stack), [tree, stack]);
    const parentNode = useMemo(() => nodeForStack(tree, parentStack(stack)), [tree, stack]);

    const searching = query.trim().length > 0;

    const handleSelect = (sku) => {
        setQuery('');
        setResults([]);
        onSelectProduct(sku);
    };

    const focusInput = (visible) => {
        if (visible && inputRef.current) inputRef.current.focus();
    };

    const renderProductRow = (item, metaParts) => (
        <List.Item onClick={() => handleSelect(item.sku)} style={{cursor: 'pointer'}}>
            <List.Item.Meta
                avatar={item.image || (item.images && item.images[0]) ? (
                    <img
                        src={catalogService.imageUrl(item.image || item.images[0])}
                        alt={item.name}
                        style={{width: 36, height: 36, objectFit: 'cover', borderRadius: 6}}
                    />
                ) : undefined}
                title={item.name}
                description={
                    <Text type="secondary" style={{fontSize: 12}}>
                        {metaParts.filter(Boolean).join(' · ')}
                    </Text>
                }
            />
        </List.Item>
    );

    return (
        <Drawer
            title={
                <Flex align="center" gap={8}>
                    <SearchOutlined style={{fontSize: 18, color: '#1677ff'}}/>
                    <span style={{fontWeight: 600}}>{t.productSearch}</span>
                    {orderMode && (
                        <Tag color="blue" style={{marginLeft: 8}}>
                            <ShoppingCartOutlined/> {t.orderMode}
                        </Tag>
                    )}
                </Flex>
            }
            placement="bottom"
            height="85%"
            closable
            open={open}
            onClose={onClose}
            className="search-drawer"
            afterOpenChange={focusInput}
            styles={{body: {paddingTop: 12, paddingBottom: 24}}}
        >
            <div style={{maxWidth: 500, margin: '0 auto'}}>
                <Flex gap={8}>
                    <Input
                        ref={inputRef}
                        size="large"
                        placeholder={t.findProductPlaceholder}
                        prefix={<SearchOutlined style={{opacity: 0.4}}/>}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        allowClear
                    />
                    <Button
                        size="large"
                        icon={<QrcodeOutlined/>}
                        onClick={onScan}
                        style={{flex: 'none'}}
                    >
                        {t.scanInstead || t.scan}
                    </Button>
                </Flex>

                <Flex justify="space-between" align="center" style={{margin: '10px 2px 6px'}}>
                    <Text type="secondary" style={{fontSize: 13}}>{t.allWarehouses}</Text>
                    <Switch checked={allWarehouses} onChange={onAllWarehousesChange}/>
                </Flex>

                {searching ? (
                    <Spin spinning={searchLoading} size="small">
                        {results.length === 0 && !searchLoading ? (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={<Text type="secondary" style={{fontSize: 13}}>{t.noResults}</Text>}
                                style={{margin: '24px 0'}}
                            />
                        ) : (
                            <List
                                size="small"
                                dataSource={results}
                                renderItem={(item) => renderProductRow(item, [
                                    item.article,
                                    (item.category_path || []).join(' › '),
                                    item.price != null ? `${item.price} ₾` : '',
                                ])}
                            />
                        )}
                    </Spin>
                ) : (
                    <>
                        {stack.length > 0 && (
                            <>
                                <Text type="secondary" style={{fontSize: 12, display: 'block', margin: '4px 2px'}}>
                                    {[t.allCategories, ...crumb].join(' › ')}
                                </Text>
                                <Button
                                    type="link"
                                    icon={<LeftOutlined/>}
                                    onClick={() => setStack(parentStack(stack))}
                                    style={{paddingLeft: 0}}
                                >
                                    {parentNode ? parentNode.name : t.allCategories}
                                </Button>
                            </>
                        )}
                        <List
                            size="small"
                            dataSource={children}
                            renderItem={(node) => (
                                <List.Item
                                    onClick={() => setStack([...stack, node.id])}
                                    style={{cursor: 'pointer'}}
                                    extra={<RightOutlined style={{fontSize: 12, opacity: 0.4}}/>}
                                >
                                    <Text>{node.name}</Text>
                                    <Text type="secondary" style={{fontSize: 12, marginLeft: 8}}>
                                        {node.product_count}
                                    </Text>
                                </List.Item>
                            )}
                        />
                        {currentId != null && (
                            <div style={{marginTop: 8}}>
                                <Text type="secondary" style={{fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4}}>
                                    {t.productsLabel}{count ? ` · ${count}` : ''}
                                </Text>
                                <Spin spinning={browseLoading} size="small">
                                    {rows.length === 0 && !browseLoading ? (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={t.noProductsFound}
                                            style={{margin: '16px 0'}}
                                        />
                                    ) : (
                                        <>
                                            <List
                                                size="small"
                                                dataSource={rows}
                                                renderItem={(item) => renderProductRow(item, [
                                                    item.article,
                                                    item.price != null ? `${item.price} ₾` : '',
                                                ])}
                                            />
                                            {rows.length < count && (
                                                <Button
                                                    block
                                                    onClick={() => fetchProducts(currentId, page + 1)}
                                                    loading={browseLoading}
                                                    style={{marginTop: 8}}
                                                >
                                                    {t.loadMore}
                                                </Button>
                                            )}
                                        </>
                                    )}
                                </Spin>
                            </div>
                        )}
                    </>
                )}
            </div>
        </Drawer>
    );
};

export default FindProductDrawer;
```

- [ ] **Step 3: Verify it compiles and existing tests still pass**

Run: `npm test -- --watchAll=false`
Expected: all existing suites PASS (the new component isn't imported anywhere yet, but jest/babel will surface syntax errors via the build if any test imports break; a clean run confirms nothing regressed).

- [ ] **Step 4: Commit**

```bash
git add barcode-scanner-frontend/src/components/UserDashboard/FindProductDrawer.js barcode-scanner-frontend/src/i18n/translations.js
git commit -m "feat(catalog): unified find-product drawer (smart search + drill-down browse)"
```

---

### Task 5: Frontend — wire the drawer into UserDashboard, remove the three old entry points

**Files:**
- Modify: `barcode-scanner-frontend/src/components/UserDashboard/UserDashboard.js`
- Delete: `barcode-scanner-frontend/src/components/UserDashboard/ProductDisplay.js`
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` (remove dead keys)

**Interfaces:**
- Consumes: `<FindProductDrawer>` from Task 4 with its exact prop contract.
- Produces: `UserDashboard` with a single product-finding entry point. `handleSearch` (the live-stock flow), the scanner, the order flow, and the daily snapshot are untouched.

All edits below reference the file as it exists at HEAD (line numbers from the current 1596-line file). Apply top-to-bottom.

- [ ] **Step 1: Trim imports and add the new one**

In the antd import block (lines 36-57), delete these four names: `Form,`, `Segmented,`, `Switch,`, `Tree,` (all other names stay). In the icons block (lines 58-78), delete `BarcodeOutlined,`, `NumberOutlined,`, and `FolderOpenOutlined,`. After the `AddToCartSheet` import (line 6), add:

```js
import FindProductDrawer from './FindProductDrawer';
```

- [ ] **Step 2: Replace form/disableScan state with `allWarehouses`, drop name-search and browse state**

Delete line 93 (`const [form] = Form.useForm();`) and line 95 (`const [disableScan, setDisableScan] = useState(false);`). In their place (right after the `loading` state on line 94), add:

```js
    const [allWarehouses, setAllWarehouses] = useState(false);
```

Delete the name-search state block (lines 109-114, the comment + `nameQuery`/`nameResults`/`nameSearchLoading`) and the browse state block (lines 116-123, the comment + all seven `browse*` states).

- [ ] **Step 3: Delete the name-search debounce effect**

Delete lines 274-294 (the effect commented "Debounced catalog name search. Mirrors the customer-search debounce pattern above..."). Keep the customer-search effect above it.

- [ ] **Step 4: Rewire the handlers off the removed form**

Replace `handleScanResult` (lines 426-434) with:

```js
    const handleScanResult = useCallback((decodedText) => {
        setScannerOpen(false);
        handleSearch({
            search: decodedText,
            searchType: 'barcode',
            allWarehouses,
            fromScan: true,
        });
    }, [handleSearch, allWarehouses]);
```

Replace `handleNameResultSelect` and the entire browse-handler section (lines 444-500: `handleNameResultSelect`, `openBrowse`, `fetchBrowseProducts`, `handleBrowseCategorySelect`, `handleBrowseProductSelect`, `browseTreeData`) with:

```js
    // Selecting a product in the Find-product drawer (typeahead or category
    // browse) closes it and runs the same scan flow as an exact sku lookup.
    const handleSelectFromCatalog = useCallback((sku) => {
        setDrawerVisible(false);
        handleSearch({
            search: sku,
            searchType: 'article',
            allWarehouses,
        });
    }, [handleSearch, allWarehouses]);
```

Replace `handleResearchFromHistory` (lines 502-508) with:

```js
    const handleResearchFromHistory = useCallback((entry) => {
        handleSearch({
            search: entry.search,
            searchType: entry.searchType,
            allWarehouses,
        });
    }, [handleSearch, allWarehouses]);
```

- [ ] **Step 5: Remove the inline name-search block from the scan tab**

In `renderScanTab`, delete lines 943-1007 — from the comment `{/* Name search — search-as-you-type against the catalog by product name; ... */}` through the closing `)}` of the `{!scannerOpen && (<div className="m-name-search" ...>...</div>)}` block. The `{/* Empty product state — daily snapshot */}` block that follows stays.

- [ ] **Step 6: Replace the Search Drawer with FindProductDrawer and delete the browse drawer**

Replace the entire old Search Drawer JSX (lines 1278-1389, from `{/* Search Drawer */}` through its closing `</Drawer>`) with:

```jsx
            {/* Unified Find-product drawer: smart search + category browse */}
            <FindProductDrawer
                open={drawerVisible}
                onClose={() => setDrawerVisible(false)}
                onSelectProduct={handleSelectFromCatalog}
                onScan={handleOpenScanner}
                allWarehouses={allWarehouses}
                onAllWarehousesChange={setAllWarehouses}
                orderMode={!!showOrderPanel}
            />
```

Delete the category-browse drawer JSX entirely (lines 1449-1504, from `{/* Category-tree catalog browser */}` through its closing `</Drawer>`).

- [ ] **Step 7: Delete the dead stub component**

```bash
git rm barcode-scanner-frontend/src/components/UserDashboard/ProductDisplay.js
```

- [ ] **Step 8: Remove now-dead i18n keys**

First verify each key is referenced nowhere outside `translations.js` (run from `barcode-scanner-frontend/`):

```bash
grep -rn "nameSearch\|browseCatalog\|selectCategoryHint\|catalogBrowseTitle\|selectSearchType\|enterSearchText\|searchPlaceholder" src --include="*.js" | grep -v "i18n/translations.js"
```

Expected: no output. Then delete these seven keys from BOTH language blocks of `src/i18n/translations.js`: `nameSearch`, `browseCatalog`, `selectCategoryHint`, `catalogBrowseTitle`, `selectSearchType`, `enterSearchText`, `searchPlaceholder`. (If the grep shows a hit for any key, keep that key and note it in the commit body.) Keys `article`, `barcode`, `scanInstead`, `allWarehouses`, `loadMore`, `noProductsFound`, `noResults`, `productSearch`, `orderMode` are still used — do not remove them.

- [ ] **Step 9: Verify the app compiles and tests pass**

Run: `npm test -- --watchAll=false`
Expected: all suites PASS.

Then run: `npm start` briefly (or rely on the jest/babel pass) to confirm no unused-variable ESLint errors abort the CRA build; fix any leftover unused imports it reports (CRA treats warnings as errors only in CI builds — clean them regardless).

- [ ] **Step 10: Commit**

```bash
git add -A barcode-scanner-frontend/src
git commit -m "refactor(scanner): single find-product drawer replaces name search + browse drawer"
```

---

### Task 6: Frontend — `cascaderOptions` helpers (TDD)

**Files:**
- Create: `barcode-scanner-frontend/src/components/SystemAdminDashboard/cascaderOptions.js`
- Test: `barcode-scanner-frontend/src/components/SystemAdminDashboard/cascaderOptions.test.js`

**Interfaces:**
- Consumes: category-tree JSON nodes `{id, name, product_count, children}`.
- Produces (Task 7 imports exactly these):
  - `toCascaderOptions(nodes)` → antd Cascader options `[{value: number, label: 'Name (count)', children?: [...]}]` — `children` omitted for leaves so no expand arrow renders
  - `categoryPathLabels(nodes, id)` → array of names root→node, or `null` if the id isn't in the tree

- [ ] **Step 1: Write the failing tests**

Create `barcode-scanner-frontend/src/components/SystemAdminDashboard/cascaderOptions.test.js`:

```js
import {toCascaderOptions, categoryPathLabels} from './cascaderOptions';

const TREE = [
  {
    id: 1, name: 'Beverages', product_count: 74,
    children: [{id: 2, name: 'Coffee', product_count: 38, children: []}],
  },
  {id: 9, name: 'Snacks', product_count: 112, children: []},
];

test('toCascaderOptions maps value/label and recurses', () => {
  const opts = toCascaderOptions(TREE);
  expect(opts[0]).toMatchObject({value: 1, label: 'Beverages (74)'});
  expect(opts[0].children[0]).toMatchObject({value: 2, label: 'Coffee (38)'});
});

test('toCascaderOptions omits children for leaves', () => {
  const opts = toCascaderOptions(TREE);
  expect(opts[0].children[0].children).toBeUndefined();
  expect(opts[1].children).toBeUndefined();
});

test('toCascaderOptions handles empty/missing input', () => {
  expect(toCascaderOptions([])).toEqual([]);
  expect(toCascaderOptions(undefined)).toEqual([]);
});

test('categoryPathLabels returns root→node names or null', () => {
  expect(categoryPathLabels(TREE, 2)).toEqual(['Beverages', 'Coffee']);
  expect(categoryPathLabels(TREE, 9)).toEqual(['Snacks']);
  expect(categoryPathLabels(TREE, 999)).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- --watchAll=false cascaderOptions`
Expected: FAIL — `Cannot find module './cascaderOptions'`.

- [ ] **Step 3: Write the implementation**

Create `barcode-scanner-frontend/src/components/SystemAdminDashboard/cascaderOptions.js`:

```js
// Category-tree nodes ({id, name, product_count, children}) → antd Cascader
// options. Children are omitted for leaves so no expand arrow renders.
export function toCascaderOptions(nodes) {
    return (nodes || []).map((n) => ({
        value: n.id,
        label: `${n.name} (${n.product_count})`,
        ...(n.children && n.children.length ? {children: toCascaderOptions(n.children)} : {}),
    }));
}

// Root→node display names for a category id (for the filter chip), or null
// when the id isn't in the tree.
export function categoryPathLabels(nodes, id) {
    for (const n of nodes || []) {
        if (n.id === id) return [n.name];
        const rest = categoryPathLabels(n.children, id);
        if (rest) return [n.name, ...rest];
    }
    return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- --watchAll=false cascaderOptions`
Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add barcode-scanner-frontend/src/components/SystemAdminDashboard/cascaderOptions.js barcode-scanner-frontend/src/components/SystemAdminDashboard/cascaderOptions.test.js
git commit -m "feat(catalog): cascader option helpers for the admin category filter"
```

---

### Task 7: Frontend — CatalogTab: sidebar tree → toolbar Cascader + category chip

**Files:**
- Modify: `barcode-scanner-frontend/src/components/SystemAdminDashboard/CatalogTab.js`
- Modify: `barcode-scanner-frontend/src/i18n/translations.js` (update `searchCatalog`, remove `categoriesLabel` if dead)

**Interfaces:**
- Consumes: Task 6 helpers (`toCascaderOptions`, `categoryPathLabels`); the list endpoint whose `q` now matches article (Task 2).
- Produces: CatalogTab with no sidebar; `category` filter driven by a `categoryPath: number[]` Cascader state; article filter UI removed (backend param untouched). Sync card, table, detail drawer unchanged.

All edits reference the current 396-line file.

- [ ] **Step 1: Swap imports**

Line 7-9 antd import: remove `Tree,` and add `Cascader,`. Line 8: remove `Grid,` (only `useBreakpoint` used it). Delete line 13 (`const {useBreakpoint} = Grid;`). After the `formatRelativeTime` import (line 5), add:

```js
import {toCascaderOptions, categoryPathLabels} from './cascaderOptions';
```

- [ ] **Step 2: Drop tree mapping + article filter constants**

Delete `toTreeData` (lines 27-32). Replace `EMPTY_FILTERS` (line 34) with:

```js
const EMPTY_FILTERS = {price_min: null, price_max: null, dates: null, attrs: {}};
```

- [ ] **Step 3: Rework state**

Delete line 39 (`const screens = useBreakpoint();`). Replace lines 42-43 (`treeData` and `category` state) with:

```js
    const [tree, setTree] = useState([]);            // raw category-tree nodes
    const [categoryPath, setCategoryPath] = useState([]); // Cascader value: ids root→selected
```

Immediately after the state declarations (after `debounceRef`, line 56), add:

```js
    const category = categoryPath.length ? categoryPath[categoryPath.length - 1] : null;
    const cascaderOpts = useMemo(() => toCascaderOptions(tree), [tree]);
```

and extend the React import (line 1) with `useMemo`:

```js
import React, {useState, useEffect, useCallback, useRef, useMemo} from 'react';
```

- [ ] **Step 4: Store the raw tree and replace the select handler**

Replace `fetchTree` (lines 63-66) with:

```js
    const fetchTree = useCallback(async () => {
        const res = await catalogService.categoryTree();
        if (res.success) setTree(res.data || []);
    }, []);
```

Replace `onTreeSelect` (lines 127-132) with:

```js
    const onCategoryChange = (path) => {
        const next = path || [];
        setCategoryPath(next);
        setPage(1);
        fetchList({category: next.length ? next[next.length - 1] : null, page: 1});
    };
```

In `buildParams` (lines 68-87): the `cat` line (75-76) stays as-is (it reads `category`, which is now the derived const from Step 3 — the dependency array on line 87 keeps `category` and still re-creates the callback when the selection changes), but delete the article line (line 80: `if (f.article) params.article = f.article;`).

- [ ] **Step 5: Remove the article filter UI**

Delete the article chip line (line 180: `if (applied.article) activeFilterTags.push(...)`). In `filterPanel` (lines 188-214), delete the article `<Input .../>` (lines 199-200). Everything else in the popover stays.

- [ ] **Step 6: Replace the sidebar layout with the toolbar Cascader**

Delete the `treePanel` const (lines 245-256). Replace the layout block — from `<Flex gap={16} align="flex-start" vertical={!screens.md}>` (line 285) down to its closing `</Flex>` (line 341) — keeping everything that was inside the inner `<div style={{flex: 1, ...}}>` but unwrapping it (toolbar order per spec §4.1: search · Cascader · Filters · Segmented):

```jsx
            <div style={{width: '100%'}}>
                <Flex gap={12} wrap="wrap" align="center" style={{marginBottom: 12}}>
                    <Input
                        placeholder={t.searchCatalog}
                        prefix={<SearchOutlined style={{opacity: 0.4}}/>}
                        allowClear
                        value={q}
                        onChange={(e) => onSearchChange(e.target.value)}
                        style={{maxWidth: 360, flex: '1 1 240px'}}
                    />
                    <Cascader
                        options={cascaderOpts}
                        value={categoryPath}
                        onChange={onCategoryChange}
                        changeOnSelect
                        showSearch
                        allowClear
                        placeholder={t.allCategories}
                        style={{minWidth: 220}}
                    />
                    <Popover content={filterPanel} trigger="click" open={filterOpen}
                             onOpenChange={setFilterOpen} placement="bottomLeft">
                        <Button icon={<FilterOutlined/>}>
                            {t.filtersLabel}{activeFilterTags.length ? ` (${activeFilterTags.length})` : ''}
                        </Button>
                    </Popover>
                    <Segmented
                        value={activeFilter}
                        onChange={onFilterChange}
                        options={[
                            {label: t.catalogAll, value: 'all'},
                            {label: t.catalogActiveOnly, value: 'active'},
                            {label: t.catalogInactiveOnly, value: 'inactive'},
                        ]}
                    />
                </Flex>

                {(category || activeFilterTags.length > 0) && (
                    <Space wrap style={{marginBottom: 12}}>
                        {category && (
                            <Tag closable onClose={(e) => {
                                e.preventDefault();
                                onCategoryChange([]);
                            }}>
                                {t.colCategory}: {(categoryPathLabels(tree, category) || []).join(' / ')}
                            </Tag>
                        )}
                        {activeFilterTags.map((f) => (
                            <Tag key={f.label} closable onClose={(e) => {
                                e.preventDefault();
                                removeFilter(f.patch);
                            }}>{f.label}</Tag>
                        ))}
                    </Space>
                )}

                <Table
                    dataSource={rows}
                    columns={columns}
                    loading={loading}
                    size="middle"
                    scroll={{x: 'max-content'}}
                    onRow={(record) => ({onClick: () => setSelected(record), style: {cursor: 'pointer'}})}
                    onChange={onTableChange}
                    pagination={{
                        current: page, pageSize, total: count,
                        showSizeChanger: true, pageSizeOptions: ['25', '50', '100'],
                    }}
                    locale={{emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t.noProductsFound}/>}}
                />
            </div>
```

(The `{/* chips block from Step 5 goes here */}` comment marks where the Step 5 JSX lands — don't leave the comment in the final code.)

- [ ] **Step 7: Update i18n copy**

In `src/i18n/translations.js`:
- Georgian line 466: `searchCatalog: 'ძებნა: სახელი / SKU / შტრიხკოდი / არტიკული',`
- English line 1077: `searchCatalog: 'Search: name / SKU / barcode / article',`
- Check `categoriesLabel` usage: `grep -rn "categoriesLabel" src --include="*.js" | grep -v translations` — if no output, delete the key from both blocks.

- [ ] **Step 8: Verify tests pass and the tab compiles**

Run: `npm test -- --watchAll=false`
Expected: all suites PASS (including Task 6's `cascaderOptions` tests). Fix any unused-import warnings the build reports (e.g. `Card` is still used by the sync card — keep it; `Empty` still used by the table locale — keep it).

- [ ] **Step 9: Commit**

```bash
git add barcode-scanner-frontend/src/components/SystemAdminDashboard/CatalogTab.js barcode-scanner-frontend/src/i18n/translations.js
git commit -m "refactor(catalog): admin category filter as toolbar cascader with chip"
```

---

### Task 8: Verification — full suites, tenancy review, manual pass

**Files:**
- No new files. Fixes discovered here are amended into small follow-up commits.

**Interfaces:**
- Consumes: everything above.
- Produces: green backend + frontend suites, tenancy sign-off on the two modified DRF views, and a manually verified dev-stack run of both dashboards.

- [ ] **Step 1: Full backend suite**

Run (from `backend/`): `python manage.py test`
Expected: all tests PASS.

- [ ] **Step 2: Full frontend suite**

Run (from `barcode-scanner-frontend/`): `npm test -- --watchAll=false`
Expected: all suites PASS.

- [ ] **Step 3: Tenancy review**

Dispatch the project's `tenancy-reviewer` agent over the Task 1 + Task 2 changes to `backend/core/views.py` (org scoping, permission classes, company_user active-only forcing, and the barcode-join `.distinct()`). Address any CONFIRMED findings before proceeding.

- [ ] **Step 4: Manual dev-stack verification**

Start the stack (backend `python manage.py runserver 0.0.0.0:8080`, frontend `npm start`), then verify:

1. **User dashboard** (company_user): bottom-bar Search opens the Find-product drawer; empty box shows top-level categories; drilling shows breadcrumb + back row + branch products with Load more; typing "art"-style queries returns typeahead rows showing article; clearing the box returns to the same drill position; tapping a product closes the drawer and shows the hero + warehouse stock; the Scan buttons still open the camera; the inline name-search field and Browse-catalog link are gone.
2. **Admin Catalog tab** (company_admin): no sidebar; Cascader filters by any level (subtree counts match the old tree's rolled-up numbers); type-to-search in the Cascader jumps across path labels; the selected category renders as a removable chip; the main search box finds products by article substring; the Filters popover no longer has an Article field; price/date/attribute filters and chips still work; sync card, table, and detail drawer unchanged.

- [ ] **Step 5: Final commit (only if fixes were needed)**

```bash
git add -A
git commit -m "fix(catalog): post-verification fixes for unified search rework"
```

---

## Self-Review Notes

- **Spec coverage:** §3 (drawer) → Tasks 3-5; §4 (admin) → Tasks 6-7; §5.1 → Task 1; §5.2 → Task 2; §3.5 removals + ProductDisplay deletion → Task 5; §4.4 popover article removal → Task 7; §7 testing → per-task TDD + Task 8.
- **Naming:** `handleSelectFromCatalog` (Task 5) matches the prop `onSelectProduct` (Task 4); `catalogBrowse` exports consumed in Task 4 match Task 3's definitions verbatim; `toCascaderOptions`/`categoryPathLabels` in Task 7 match Task 6.
- **Deliberate non-changes:** `POST /product/search/` untouched; `article` query param kept server-side; `searchType: 'article'` payload value kept (it's the existing exact-sku lookup contract).
