import {markSelected, wireDesignerFrame} from './designerFrame';

const makeWindow = () => {
    const doc = document.implementation.createHTMLDocument('invoice');
    doc.body.innerHTML = `
        <div class="no-print"><button data-invoice-print>Print</button></div>
        <main class="sheet">
          <div class="header" data-block="header"><p class="name">Acme</p></div>
          <table data-block="items"><tbody><tr><td id="cell">x</td></tr></tbody></table>
          <p id="outside">loose</p>
        </main>`;
    return {document: doc};
};

describe('designerFrame', () => {
    it('reports the clicked block, including clicks on its children', () => {
        const win = makeWindow();
        const onSelect = jest.fn();
        wireDesignerFrame(win, onSelect);
        win.document.getElementById('cell').click();
        win.document.getElementById('outside').click();
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('items');
    });

    it('injects one stylesheet that hides the print bar', () => {
        const win = makeWindow();
        wireDesignerFrame(win, () => {});
        wireDesignerFrame(win, () => {});
        const styles = win.document.querySelectorAll('style[data-designer]');
        expect(styles).toHaveLength(1);
        expect(styles[0].textContent).toContain('.no-print');
    });

    it('marks exactly one block selected', () => {
        const win = makeWindow();
        const doc = win.document;
        doc.querySelector('[data-block="items"]').scrollIntoView = jest.fn();
        doc.querySelector('[data-block="header"]').scrollIntoView = jest.fn();
        markSelected(doc, 'items');
        markSelected(doc, 'header');
        expect(doc.querySelectorAll('.is-selected')).toHaveLength(1);
        expect(doc.querySelector('[data-block="header"]').classList.contains('is-selected')).toBe(true);
        markSelected(doc, null);
        expect(doc.querySelectorAll('.is-selected')).toHaveLength(0);
    });
});
