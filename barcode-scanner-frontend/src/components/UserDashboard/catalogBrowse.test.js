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
