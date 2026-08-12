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

// Display helper for branch product listings: a row's category path minus the
// current crumb prefix, e.g. inside "Kitchen" a product living in
// Kitchen › Pans renders "Pans"; a product at the current node renders ''.
export function subPath(categoryPath, crumbNames) {
    const path = categoryPath || [];
    const depth = (crumbNames || []).length;
    return path.length > depth ? path.slice(depth).join(' › ') : '';
}
