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
