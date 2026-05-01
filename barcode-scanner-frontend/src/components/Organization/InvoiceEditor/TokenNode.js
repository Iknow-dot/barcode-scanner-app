import {Node, mergeAttributes} from '@tiptap/core';

// Custom inline node rendering as <span data-token="scope.name">. The
// inner text is the human-readable label so non-token-aware renderers
// still produce something sensible.
export const TokenNode = Node.create({
  name: 'token',
  group: 'inline',
  inline: true,
  selectable: true,
  atom: true,
  addAttributes() {
    return {
      token: {default: null},
      label: {default: ''},
      scope: {default: ''}, // 'org' | 'order' | 'item' — used for the colored dot
    };
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-token]',
        getAttrs: (el) => {
          const token = el.getAttribute('data-token');
          if (!token) return false;
          const [scope] = token.split('.');
          return {token, scope, label: el.textContent || token};
        },
      },
    ];
  },
  renderHTML({HTMLAttributes, node}) {
    const {token, label, scope} = node.attrs;
    return [
      'span',
      mergeAttributes({
        'data-token': token,
        class: `token-chip token-chip-${scope}`,
      }, HTMLAttributes),
      label || token || '',
    ];
  },
});

export default TokenNode;
