import React, {useCallback, useEffect, useRef, useState} from 'react';
import {render, screen, fireEvent, act} from '@testing-library/react';
import CatalogView from './CatalogView';
import {LanguageProvider} from '../../i18n/LanguageContext';
import {catalogService} from '../../api';

jest.mock('../../api', () => ({
  catalogService: {
    searchByName: jest.fn(),
    categoryTree: jest.fn(),
    listProducts: jest.fn(),
    imageUrl: jest.fn((p) => `http://img.test/${p}`),
  },
}));

// jsdom lacks these browser APIs that antd touches.
beforeAll(() => {
  window.matchMedia = window.matchMedia || ((query) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  global.ResizeObserver = global.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const TREE = [
  {id: 1, name: 'Snacks', product_count: 2, children: [
    {id: 3, name: 'Salty', product_count: 1, children: []},
  ]},
  {id: 2, name: 'Beverages', product_count: 1, children: []},
];

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return {promise, resolve};
};

const searchRow = (name) => ({
  sku: `SKU-${name}`, article: `ART-${name}`, name,
  price: 10, image: null, category_path: ['Snacks'],
});

const productRow = (name) => ({
  sku: `SKU-${name}`, article: `ART-${name}`, name, price: 5, image: null,
});

const browsePage = (names, count = names.length) => ({
  success: true,
  data: {results: names.map(productRow), count},
});

// CatalogView no longer owns `stack`, `query` or the category `tree` itself
// (F1/F2 fix) — UserDashboard lifts all three, the same shape it already
// uses for OrdersView's `ordersSegment`/`ordersSearch`/etc (see
// OrdersView.test.js's own OrdersViewHarness, which this mirrors). This
// harness plays UserDashboard's part: it owns the state, fetches the tree
// itself (fetch-once, with a retry callback on failure — exactly what
// UserDashboard.js's fetchCatalogTree does), and passes everything down as
// controlled props, so the suite exercises CatalogView through the same
// contract production uses.
//
// `visible` mimics UserDashboard's `activeTab === 'catalog' && <CatalogView/>`
// conditional mount: toggling it unmounts/remounts CatalogView while the
// harness (standing in for UserDashboard) keeps its state — exactly what a
// tab switch does to the real component tree.
const CatalogViewHarness = ({
  onCommit = () => {},
  onSelectProduct = jest.fn(),
  visible = true,
  resetToken = 0,
  ...overrideProps
}) => {
  const [stack, setStack] = useState([]);
  const [query, setQuery] = useState('');
  const [tree, setTree] = useState([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState('');

  const fetchTree = useCallback(async () => {
    setTreeLoading(true);
    setTreeError('');
    const res = await catalogService.categoryTree();
    if (res.success) {
      setTree(res.data || []);
    } else {
      setTreeError(res.error || 'error');
    }
    setTreeLoading(false);
  }, []);

  // A ref, not a [treeLoading] dependency: treeLoading also returns to
  // false when a fetch FAILS, so keying the auto-fetch on it would re-fire
  // the moment a failed request settles — an auto-retry loop instead of
  // waiting for the explicit Retry button (mirrors UserDashboard.js's
  // triedCatalogTreeRef).
  const triedTreeFetchRef = useRef(false);
  useEffect(() => {
    if (triedTreeFetchRef.current) return;
    triedTreeFetchRef.current = true;
    fetchTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!visible) return null;

  return (
    <React.Profiler id="catalog-view" onRender={onCommit}>
      <LanguageProvider>
        <CatalogView
          onSelectProduct={onSelectProduct}
          onScan={jest.fn()}
          allWarehouses={false}
          onAllWarehousesChange={jest.fn()}
          resetToken={resetToken}
          stack={stack}
          onStackChange={setStack}
          query={query}
          onQueryChange={setQuery}
          tree={tree}
          treeLoading={treeLoading}
          treeError={treeError}
          onRetryTree={fetchTree}
          {...overrideProps}
        />
      </LanguageProvider>
    </React.Profiler>
  );
};

// onCommit (optional) runs synchronously after every React commit's DOM
// mutations, before passive effects — the only window where a stale-state
// flash is observable from a test.
const renderCatalog = async ({onCommit, onSelectProduct, ...props} = {}) => {
  const utils = render(<CatalogViewHarness onCommit={onCommit} onSelectProduct={onSelectProduct} {...props}/>);
  // Flush the categoryTree load so the root category list is on screen.
  await act(async () => {});
  return {
    ...utils,
    onSelectProduct,
    rerenderWith: (nextProps) => utils.rerender(
      <CatalogViewHarness onCommit={onCommit} onSelectProduct={onSelectProduct} {...props} {...nextProps}/>
    ),
  };
};

const queryInput = () => screen.getByPlaceholderText('Name, article, or barcode');
const typeQuery = (value) => fireEvent.change(queryInput(), {target: {value}});

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.setItem('language', 'en');
  jest.clearAllMocks();
  catalogService.categoryTree.mockResolvedValue({success: true, data: TREE});
  catalogService.searchByName.mockResolvedValue({success: true, data: []});
  catalogService.listProducts.mockResolvedValue(browsePage([]));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('smart search debounce', () => {
  test('waits 300ms after the last keystroke and searches once with the final query', async () => {
    await renderCatalog();

    typeQuery('pe');
    act(() => jest.advanceTimersByTime(200));
    expect(catalogService.searchByName).not.toHaveBeenCalled();

    // A new keystroke inside the window restarts the 300ms clock.
    typeQuery('pep');
    act(() => jest.advanceTimersByTime(299));
    expect(catalogService.searchByName).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(1));
    expect(catalogService.searchByName).toHaveBeenCalledTimes(1);
    expect(catalogService.searchByName).toHaveBeenCalledWith('pep');
  });

  // Adapted: the drawer wrapped its results in an antd <Spin>, which overlays
  // a spinner on top of whatever is already rendered (`.ant-spin-spinning`).
  // The screen replaces that with the same loading-vs-empty-vs-populated
  // split OrdersView.js already established for this codebase (an
  // `.if-group.if-group-empty[aria-busy]` block holding `.if-spinner`) — so
  // this checks for `.if-spinner` instead. The behaviour under test is
  // unchanged: a spinner shows, and "No results" does not, while the
  // debounce window is still pending.
  test('shows a spinner, not "No results", while the debounce window is pending', async () => {
    await renderCatalog();

    typeQuery('pe');
    // A 0ms tick lets React commit the loading state without reaching the
    // 300ms search debounce.
    act(() => jest.advanceTimersByTime(0));
    // Inside the 300ms window: no request yet, but the user is mid-search —
    // the empty state must not flash before the first response.
    expect(catalogService.searchByName).not.toHaveBeenCalled();
    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    expect(document.querySelector('.if-spinner')).toBeInTheDocument();
  });

  test('shows the empty state once a search resolves with no rows', async () => {
    const d = deferred();
    catalogService.searchByName.mockReturnValueOnce(d.promise);
    await renderCatalog();

    typeQuery('zzz');
    act(() => jest.advanceTimersByTime(300));
    await act(async () => d.resolve({success: true, data: []}));

    expect(screen.getByText('No results found')).toBeInTheDocument();
    expect(document.querySelector('.if-spinner')).not.toBeInTheDocument();
  });

  test('a stale search response never overwrites a newer one', async () => {
    const first = deferred();
    const second = deferred();
    catalogService.searchByName
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await renderCatalog();

    typeQuery('first');
    act(() => jest.advanceTimersByTime(300));
    typeQuery('second');
    act(() => jest.advanceTimersByTime(300));
    expect(catalogService.searchByName).toHaveBeenCalledTimes(2);

    // Newer request resolves before the older one.
    await act(async () => second.resolve({success: true, data: [searchRow('Second Result')]}));
    expect(screen.getByText('Second Result')).toBeInTheDocument();

    await act(async () => first.resolve({success: true, data: [searchRow('First Result')]}));
    expect(screen.queryByText('First Result')).not.toBeInTheDocument();
    expect(screen.getByText('Second Result')).toBeInTheDocument();
  });
});

describe('category browsing', () => {
  test('a stale browse response never overwrites a newer category\'s products', async () => {
    const snacks = deferred();
    const beverages = deferred();
    catalogService.listProducts
      .mockReturnValueOnce(snacks.promise)
      .mockReturnValueOnce(beverages.promise);
    await renderCatalog();

    fireEvent.click(screen.getByText('Snacks'));
    expect(catalogService.listProducts).toHaveBeenCalledWith(
      {category: 1, page: 1, page_size: 25});

    fireEvent.click(screen.getByRole('button', {name: /All categories/}));
    fireEvent.click(screen.getByText('Beverages'));
    expect(catalogService.listProducts).toHaveBeenCalledWith(
      {category: 2, page: 1, page_size: 25});

    await act(async () => beverages.resolve(browsePage(['Cola'])));
    expect(screen.getByText('Cola')).toBeInTheDocument();

    // The Snacks response arrives late — it must be dropped.
    await act(async () => snacks.resolve(browsePage(['Chips'])));
    expect(screen.queryByText('Chips')).not.toBeInTheDocument();
    expect(screen.getByText('Cola')).toBeInTheDocument();
  });

  test('ascending to the root invalidates an in-flight browse fetch', async () => {
    const snacks = deferred();
    catalogService.listProducts
      .mockReturnValueOnce(snacks.promise)
      .mockReturnValueOnce(new Promise(() => {}));
    const commits = [];
    await renderCatalog({
      onCommit: () => commits.push(document.body.textContent.includes('Stale Chips')),
    });

    fireEvent.click(screen.getByText('Snacks'));
    fireEvent.click(screen.getByRole('button', {name: /All categories/}));
    // The Snacks fetch resolves while we are back at the root.
    await act(async () => snacks.resolve(browsePage(['Stale Chips'])));

    // Descend elsewhere: the orphaned rows must not flash into the DOM even
    // for a single commit (React clears them in an effect only after paint).
    fireEvent.click(screen.getByText('Beverages'));
    expect(commits.some(Boolean)).toBe(false);
    expect(screen.queryByText('Stale Chips')).not.toBeInTheDocument();
  });

  test('browse position and rows survive typing and clearing a query', async () => {
    const snacks = deferred();
    catalogService.listProducts.mockReturnValueOnce(snacks.promise);
    await renderCatalog();

    fireEvent.click(screen.getByText('Snacks'));
    await act(async () => snacks.resolve(browsePage(['Chips'])));
    expect(screen.getByText('Chips')).toBeInTheDocument();

    // Typing swaps the screen's body over to search results…
    typeQuery('cola');
    expect(screen.queryByText('Chips')).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(300));
    await act(async () => {});

    // …and clearing restores the same branch without refetching.
    typeQuery('');
    expect(screen.getByRole('button', {name: /All categories/})).toBeInTheDocument();
    expect(screen.getByText('Snacks')).toBeInTheDocument();
    expect(screen.getByText('Chips')).toBeInTheDocument();
    expect(catalogService.listProducts).toHaveBeenCalledTimes(1);
  });

  test('"load more" fetches the next page and appends rows rather than replacing them', async () => {
    catalogService.listProducts
      .mockResolvedValueOnce(browsePage(['Chips'], 2))
      .mockResolvedValueOnce(browsePage(['Pretzels'], 2));
    await renderCatalog();

    fireEvent.click(screen.getByText('Snacks'));
    await act(async () => {});
    expect(screen.getByText('ART-Chips')).toBeInTheDocument();
    expect(catalogService.listProducts).toHaveBeenNthCalledWith(1,
      {category: 1, page: 1, page_size: 25});

    fireEvent.click(screen.getByText('Load more'));
    await act(async () => {});

    expect(catalogService.listProducts).toHaveBeenNthCalledWith(2,
      {category: 1, page: 2, page_size: 25});
    // Both pages' rows are on screen at once — the second page was appended,
    // not swapped in for the first.
    expect(screen.getByText('ART-Chips')).toBeInTheDocument();
    expect(screen.getByText('ART-Pretzels')).toBeInTheDocument();
    // The count (2) now equals the row count (2): "Load more" is gone.
    expect(screen.queryByText('Load more')).not.toBeInTheDocument();
  });
});

describe('category navigation chrome', () => {
  test('root renders category tiles with product counts and no crumb chrome', async () => {
    await renderCatalog();
    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(document.querySelectorAll('.cv-tile')).toHaveLength(2);
    expect(screen.getByText('2 products')).toBeInTheDocument();
    expect(screen.getByText('1 products')).toBeInTheDocument();
    expect(document.querySelector('.cv-crumbline')).not.toBeInTheDocument();
  });

  test('depth 1: back pill, bold title with count, children as chips, no path line', async () => {
    await renderCatalog();
    fireEvent.click(screen.getByText('Snacks'));
    expect(screen.getByRole('button', {name: /All categories/})).toBeInTheDocument();
    expect(document.querySelector('.cv-crumbtitle').textContent).toBe('Snacks');
    expect(screen.getByText('2 products')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Salty/})).toBeInTheDocument();
    expect(document.querySelector('.cv-crumbpath')).not.toBeInTheDocument();
  });

  test('depth 2: the full path line appears and the back pill names the parent', async () => {
    await renderCatalog();
    fireEvent.click(screen.getByText('Snacks'));
    fireEvent.click(screen.getByRole('button', {name: /Salty/}));
    expect(screen.getByText('All categories › Snacks › Salty')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Snacks/})).toBeInTheDocument();
    expect(document.querySelector('.cv-crumbtitle').textContent).toBe('Salty');
  });
});

describe('product card rows', () => {
  test('a row shows article and price and fires onSelectProduct with the sku', async () => {
    const snacks = deferred();
    catalogService.listProducts.mockReturnValueOnce(snacks.promise);
    const onSelectProduct = jest.fn();
    await renderCatalog({onSelectProduct});

    fireEvent.click(screen.getByText('Snacks'));
    await act(async () => snacks.resolve(browsePage(['Chips'])));

    expect(screen.getByText('ART-Chips')).toBeInTheDocument();
    expect(screen.getByText('5 ₾')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Chips'));
    expect(onSelectProduct).toHaveBeenCalledWith('SKU-Chips');
  });

  test('a product without an image renders the placeholder thumb', async () => {
    const snacks = deferred();
    catalogService.listProducts.mockReturnValueOnce(snacks.promise);
    await renderCatalog();

    fireEvent.click(screen.getByText('Snacks'));
    await act(async () => snacks.resolve(browsePage(['Chips'])));

    const thumb = document.querySelector('.cv-product-row .cv-thumb');
    expect(thumb).toBeInTheDocument();
    expect(thumb.querySelector('.cv-thumb-img')).toBeNull();
  });

  test('search rows append the full category path to the meta line', async () => {
    catalogService.searchByName.mockResolvedValue(
      {success: true, data: [searchRow('Pretzels')]});
    await renderCatalog();

    typeQuery('pre');
    act(() => jest.advanceTimersByTime(300));
    await act(async () => {});

    expect(screen.getByText('ART-Pretzels · Snacks')).toBeInTheDocument();
  });
});

describe('all-warehouses toggle', () => {
  test('reflects the allWarehouses prop and reports a toggle to onAllWarehousesChange', async () => {
    const onAllWarehousesChange = jest.fn();
    const {rerenderWith} = await renderCatalog({allWarehouses: false, onAllWarehousesChange});

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    expect(onAllWarehousesChange).toHaveBeenCalledTimes(1);
    // antd's Switch onChange passes (checked, event) — only the boolean matters here.
    expect(onAllWarehousesChange).toHaveBeenCalledWith(true, expect.anything());

    // The component doesn't own the value itself (`allWarehouses` is a
    // controlled prop) — it only round-trips through the parent, so
    // re-rendering with the new value is what the checked switch reflects.
    rerenderWith({allWarehouses: true});
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('scan shortcut', () => {
  test('the trailing scan glyph in the search field calls onScan', async () => {
    const onScan = jest.fn();
    await renderCatalog({onScan});

    fireEvent.click(screen.getByRole('button', {name: 'Scan'}));
    expect(onScan).toHaveBeenCalledTimes(1);
  });
});

// F3: the drawer's Input had allowClear; the new .if-search never showed
// anything but the scan glyph, so clearing a query meant holding backspace
// or discovering (undiscoverably) that a tab re-tap also clears it.
describe('search field clear button (F3)', () => {
  test('a typed query swaps the trailing scan glyph for a clear button, which empties the field and restores the glyph', async () => {
    await renderCatalog();

    expect(screen.getByRole('button', {name: 'Scan'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Clear'})).not.toBeInTheDocument();

    typeQuery('კოკა-კოლა ზერო');
    expect(screen.queryByRole('button', {name: 'Scan'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Clear'})).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Clear'}));
    expect(queryInput().value).toBe('');
    expect(screen.getByRole('button', {name: 'Scan'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'Clear'})).not.toBeInTheDocument();
  });
});

// R1 (whole-plan review finding): the old drawer wrapped results in antd's
// <Spin spinning>, whose own styling dims AND disables pointer events on the
// wrapped container. The screen's first cut checked `results.length > 0`
// before `searchLoading`, so a previous query's rows stayed fully tappable
// during a refetch — typing "pepsi" -> "pepsi z" while the old 5 rows were
// still on screen let a tap on the (still-visible) 3rd row silently add the
// wrong product. Scope (per the review): the search branch only — the
// browse branch clears `rows` synchronously on a category change, so it was
// never exposed to this.
describe('stale search results stay dimmed and inert during a refetch (R1)', () => {
  test('a tap on a stale row while a new search is loading does not select it', async () => {
    catalogService.searchByName.mockResolvedValueOnce({success: true, data: [searchRow('Pepsi')]});
    const onSelectProduct = jest.fn();
    await renderCatalog({onSelectProduct});

    typeQuery('pepsi');
    act(() => jest.advanceTimersByTime(300));
    await act(async () => {});
    expect(screen.getByText('Pepsi')).toBeInTheDocument();

    // A fresh keystroke starts a new debounce; searchLoading flips true the
    // moment the query changes (see CatalogView.js), well before the 300ms
    // window elapses or a new request is even sent — "Pepsi" (the previous
    // query's row) is still the one on screen right now.
    typeQuery('pepsi z');

    const group = document.querySelector('.cv-rows .if-group');
    expect(group).toHaveClass('cv-stale');
    expect(group).toHaveAttribute('aria-busy', 'true');

    fireEvent.click(screen.getByText('Pepsi'));
    expect(onSelectProduct).not.toHaveBeenCalled();
  });

  test('once the refetch resolves, the new rows are visible and tappable again', async () => {
    catalogService.searchByName.mockResolvedValueOnce({success: true, data: [searchRow('Pepsi')]});
    const second = deferred();
    catalogService.searchByName.mockReturnValueOnce(second.promise);
    const onSelectProduct = jest.fn();
    await renderCatalog({onSelectProduct});

    typeQuery('pepsi');
    act(() => jest.advanceTimersByTime(300));
    await act(async () => {});

    typeQuery('pepsi z');
    act(() => jest.advanceTimersByTime(300));
    await act(async () => second.resolve({success: true, data: [searchRow('Pepsi Zero')]}));

    const group = document.querySelector('.cv-rows .if-group');
    expect(group).not.toHaveClass('cv-stale');
    expect(group).not.toHaveAttribute('aria-busy');

    fireEvent.click(screen.getByText('Pepsi Zero'));
    expect(onSelectProduct).toHaveBeenCalledWith('SKU-Pepsi Zero');
  });
});

// F2: the category tree used to have no loading or error state at all — the
// "Categories" header always painted over whatever `children` (derived from
// `tree`) happened to compute, so a slow fetch showed an empty grid for a
// moment and a failed one left a permanently blank tile wall with no
// message and no recovery short of another tab switch.
describe('category tree loading and error states (F2)', () => {
  test('shows a loading spinner, not a blank grid, while the tree is still loading', async () => {
    const d = deferred();
    catalogService.categoryTree.mockReturnValueOnce(d.promise);
    render(<CatalogViewHarness/>);
    await act(async () => {});

    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(document.querySelectorAll('.cv-tile')).toHaveLength(0);
    expect(document.querySelector('.if-spinner')).toBeInTheDocument();

    await act(async () => d.resolve({success: true, data: TREE}));
    expect(document.querySelector('.if-spinner')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.cv-tile')).toHaveLength(2);
  });

  test('shows a translated error and a retry on a failed fetch, and recovers once retried', async () => {
    catalogService.categoryTree.mockResolvedValueOnce({success: false, error: 'Network error'});
    render(<CatalogViewHarness/>);
    await act(async () => {});

    expect(screen.getByText('Network error')).toBeInTheDocument();
    expect(document.querySelectorAll('.cv-tile')).toHaveLength(0);
    const retryButton = screen.getByRole('button', {name: 'Refresh'});

    // Second call (the retry) uses beforeEach's default resolved mock.
    fireEvent.click(retryButton);
    await act(async () => {});

    expect(catalogService.categoryTree).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('Network error')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.cv-tile')).toHaveLength(2);
  });
});

// F1/F2: CatalogView used to own `stack`/`query`/`tree` as local state, so
// every tab switch (UserDashboard unmounts CatalogView when activeTab !==
// 'catalog') silently reset the consultant's browse position and search —
// and, separately, refetched the category tree on every visit instead of
// once per session. The harness above stands in for UserDashboard: it owns
// the state and CatalogView only renders it, so a tab switch (visible ->
// false -> true, same harness instance) must not lose either. `resetToken`
// starts at a NONZERO value (3) deliberately in both tests below: a naive
// guard against firing the reset-on-mount effect (e.g. "skip only when
// resetToken === 0") would look correct against a fresh mount but still
// wipe the restored state here, since a consultant who has already re-tapped
// the tab a few times in this session has a nonzero resetToken by the time
// they switch away and back.
describe('lifted state survives a tab switch (F1/F2)', () => {
  test('a category drill-down position survives an unmount/remount with no refetch of the tree', async () => {
    const snacks = deferred();
    catalogService.listProducts.mockReturnValueOnce(snacks.promise);
    const {rerender} = render(<CatalogViewHarness resetToken={3} visible/>);
    await act(async () => {});

    fireEvent.click(screen.getByText('Snacks'));
    await act(async () => snacks.resolve(browsePage(['Chips'])));
    expect(document.querySelector('.cv-crumbtitle').textContent).toBe('Snacks');

    // Tab away: CatalogView unmounts (the harness — standing in for
    // UserDashboard — stays mounted, holding stack/query/tree state).
    rerender(<CatalogViewHarness resetToken={3} visible={false}/>);

    // Tab back: CatalogView remounts. resetToken is UNCHANGED (still 3) —
    // a normal tab entry never bumps it; only a re-tap of the already-active
    // tab does (see UserDashboard.js).
    catalogService.categoryTree.mockClear();
    catalogService.listProducts.mockClear();
    catalogService.listProducts.mockResolvedValueOnce(browsePage(['Chips']));
    rerender(<CatalogViewHarness resetToken={3} visible/>);
    await act(async () => {});

    // The browse position (not just the tile grid) survived: still drilled
    // into Snacks, not popped back to the category root.
    expect(document.querySelector('.cv-crumbtitle').textContent).toBe('Snacks');
    expect(document.querySelector('.cv-crumbline')).toBeInTheDocument();
    // The tree itself was not refetched a second time — it's kept by the
    // harness (standing in for UserDashboard), not refetched per mount.
    expect(catalogService.categoryTree).not.toHaveBeenCalled();
  });

  test('an in-progress search query survives an unmount/remount', async () => {
    const {rerender} = render(<CatalogViewHarness resetToken={3} visible/>);
    await act(async () => {});

    typeQuery('cola');
    expect(queryInput().value).toBe('cola');

    rerender(<CatalogViewHarness resetToken={3} visible={false}/>);
    rerender(<CatalogViewHarness resetToken={3} visible/>);
    await act(async () => {});

    expect(queryInput().value).toBe('cola');
  });

  // index.js renders the whole app inside React.StrictMode, which in
  // development mounts every effect, tears it down and mounts it again. A
  // reset guard written as a run-once flag is consumed by the first of those
  // two invocations, so the second falls through and wipes the lifted state —
  // on every entry into the tab. The tests above cannot see that, because RTL
  // renders without StrictMode; this one renders with it, which is what the
  // consultant's browser actually does. Verified by hand first: before the
  // fix, drilling in, tabbing away and back landed on the root tile wall.
  test('the drill-down survives a StrictMode double-invoked mount', async () => {
    const snacks = deferred();
    catalogService.listProducts.mockReturnValueOnce(snacks.promise);
    const {rerender} = render(
      <React.StrictMode><CatalogViewHarness resetToken={3} visible/></React.StrictMode>
    );
    await act(async () => {});

    fireEvent.click(screen.getByText('Snacks'));
    await act(async () => snacks.resolve(browsePage(['Chips'])));
    expect(document.querySelector('.cv-crumbtitle').textContent).toBe('Snacks');

    catalogService.listProducts.mockResolvedValueOnce(browsePage(['Chips']));
    rerender(<React.StrictMode><CatalogViewHarness resetToken={3} visible={false}/></React.StrictMode>);
    rerender(<React.StrictMode><CatalogViewHarness resetToken={3} visible/></React.StrictMode>);
    await act(async () => {});

    expect(document.querySelector('.cv-crumbtitle').textContent).toBe('Snacks');
  });
});

describe('autofocus (replaces the drawer\'s afterOpenChange)', () => {
  test('focuses the search field once the screen is active', async () => {
    await renderCatalog();
    expect(document.activeElement).toBe(queryInput());
  });

  test('a resetToken bump pops back to the category root, clears the query, and refocuses', async () => {
    const snacks = deferred();
    catalogService.listProducts.mockReturnValueOnce(snacks.promise);
    const {rerenderWith} = await renderCatalog();

    fireEvent.click(screen.getByText('Snacks'));
    await act(async () => snacks.resolve(browsePage(['Chips'])));
    typeQuery('cola');
    act(() => { queryInput().blur(); });
    expect(document.activeElement).not.toBe(queryInput());

    await act(async () => rerenderWith({resetToken: 1}));

    expect(screen.getByText('Categories')).toBeInTheDocument();
    expect(document.querySelector('.cv-crumbline')).not.toBeInTheDocument();
    expect(queryInput().value).toBe('');
    expect(document.activeElement).toBe(queryInput());
  });

  // The old Drawer focused via `afterOpenChange`, firing exactly once per
  // open. Its replacement — an effect keyed on `resetToken` — must not
  // refocus on every render, or a fetch resolving mid-keystroke would yank
  // focus away from wherever the user's cursor was. A naive
  // `useEffect(() => inputRef.current.focus())` with no dependency array
  // (refocuses every render) would fail this test: the tree resolving is a
  // render the user did not ask to be refocused for.
  test('typing is not interrupted when an unrelated fetch resolves mid-type', async () => {
    const tree = deferred();
    catalogService.categoryTree.mockReturnValueOnce(tree.promise);
    render(<CatalogViewHarness/>);
    await act(async () => {});

    const input = queryInput();
    const focusSpy = jest.spyOn(input, 'focus');
    typeQuery('coca');
    await act(async () => tree.resolve({success: true, data: TREE}));

    expect(queryInput().value).toBe('coca');
    expect(focusSpy).not.toHaveBeenCalled();
  });
});
