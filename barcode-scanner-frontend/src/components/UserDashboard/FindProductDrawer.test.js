import React from 'react';
import {render, screen, fireEvent, act} from '@testing-library/react';
import FindProductDrawer from './FindProductDrawer';
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
  {id: 1, name: 'Snacks', product_count: 2, children: []},
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

// onCommit (optional) runs synchronously after every React commit's DOM
// mutations, before passive effects — the only window where a stale-state
// flash is observable from a test.
const renderDrawer = async ({onCommit = () => {}} = {}) => {
  const utils = render(
    <React.Profiler id="find-product-drawer" onRender={onCommit}>
      <LanguageProvider>
        <FindProductDrawer
          open
          onClose={jest.fn()}
          onSelectProduct={jest.fn()}
          onScan={jest.fn()}
          allWarehouses={false}
          onAllWarehousesChange={jest.fn()}
          orderMode={false}
        />
      </LanguageProvider>
    </React.Profiler>
  );
  // Flush the categoryTree load so the root category list is on screen.
  await act(async () => {});
  return utils;
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
    await renderDrawer();

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

  test('shows a spinner, not "No results", while the debounce window is pending', async () => {
    await renderDrawer();

    typeQuery('pe');
    // A 0ms tick lets antd's Spin flip its own deferred spinning state
    // without reaching the 300ms search debounce.
    act(() => jest.advanceTimersByTime(0));
    // Inside the 300ms window: no request yet, but the user is mid-search —
    // the empty state must not flash before the first response.
    expect(catalogService.searchByName).not.toHaveBeenCalled();
    expect(screen.queryByText('No results found')).not.toBeInTheDocument();
    expect(document.querySelector('.ant-spin-spinning')).toBeInTheDocument();
  });

  test('shows the empty state once a search resolves with no rows', async () => {
    const d = deferred();
    catalogService.searchByName.mockReturnValueOnce(d.promise);
    await renderDrawer();

    typeQuery('zzz');
    act(() => jest.advanceTimersByTime(300));
    await act(async () => d.resolve({success: true, data: []}));

    expect(screen.getByText('No results found')).toBeInTheDocument();
    expect(document.querySelector('.ant-spin-spinning')).not.toBeInTheDocument();
  });

  test('a stale search response never overwrites a newer one', async () => {
    const first = deferred();
    const second = deferred();
    catalogService.searchByName
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    await renderDrawer();

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
    await renderDrawer();

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
    await renderDrawer({
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
    await renderDrawer();

    fireEvent.click(screen.getByText('Snacks'));
    await act(async () => snacks.resolve(browsePage(['Chips'])));
    expect(screen.getByText('Chips')).toBeInTheDocument();

    // Typing swaps the drawer body over to search results…
    typeQuery('cola');
    expect(screen.queryByText('Chips')).not.toBeInTheDocument();
    act(() => jest.advanceTimersByTime(300));
    await act(async () => {});

    // …and clearing restores the same branch without refetching.
    typeQuery('');
    expect(screen.getByText('All categories › Snacks')).toBeInTheDocument();
    expect(screen.getByText('Chips')).toBeInTheDocument();
    expect(catalogService.listProducts).toHaveBeenCalledTimes(1);
  });
});
