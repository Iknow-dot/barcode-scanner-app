import React from 'react';
import {render} from '@testing-library/react';
import IosIcon from './IosIcon';

describe('IosIcon', () => {
    it('draws a stroke glyph hidden from assistive technology', () => {
        const {container} = render(<IosIcon name="chev" size={16} stroke={2.4}/>);
        const svg = container.querySelector('svg');
        expect(svg).toHaveAttribute('data-icon', 'chev');
        expect(svg).toHaveAttribute('aria-hidden', 'true');
        expect(svg).toHaveAttribute('width', '16');
        expect(svg).toHaveAttribute('stroke', 'currentColor');
        expect(svg).toHaveAttribute('stroke-width', '2.4');
    });

    it('draws a filled tab glyph', () => {
        const {container} = render(<IosIcon name="tab-orders"/>);
        const svg = container.querySelector('svg');
        expect(svg).toHaveAttribute('fill', 'currentColor');
        expect(svg).not.toHaveAttribute('stroke');
    });

    it('draws the order-sheet glyphs', () => {
        const stroked = ['back', 'calendar', 'clock', 'close', 'cloud', 'gift', 'info', 'minus', 'person', 'pin', 'trash'];
        stroked.forEach((name) => {
            const {container, unmount} = render(<IosIcon name={name}/>);
            expect(container.querySelector(`svg[data-icon="${name}"]`)).toHaveAttribute('stroke', 'currentColor');
            unmount();
        });
        const {container} = render(<IosIcon name="more"/>);
        expect(container.querySelector('svg[data-icon="more"]')).toHaveAttribute('fill', 'currentColor');
    });

    it('renders nothing for an unknown name', () => {
        const {container} = render(<IosIcon name="nope"/>);
        expect(container).toBeEmptyDOMElement();
    });
});
