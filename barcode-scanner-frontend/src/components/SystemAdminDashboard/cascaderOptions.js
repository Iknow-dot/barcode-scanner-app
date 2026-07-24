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
