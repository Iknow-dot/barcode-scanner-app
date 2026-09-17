import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import ActiveOrderBar from './ActiveOrderBar';

const IDLE = {active: false, badgeCount: 0, title: 'Cart', subtitle: 'Empty'};
const ACTIVE = {active: true, badgeCount: 4, title: 'Giorgi Beridze', subtitle: 'Active Order · 488.30 ₾'};

describe('ActiveOrderBar', () => {
    it('shows the idle cart without a badge and is still a working button', () => {
        const onOpen = jest.fn();
        const {container} = render(<ActiveOrderBar view={IDLE} onOpen={onOpen}/>);
        const bar = screen.getByRole('button', {name: /Cart/});
        expect(bar).toHaveClass('if-accessory', 'is-idle');
        expect(bar).not.toBeDisabled();
        expect(screen.getByText('Empty')).toBeInTheDocument();
        expect(container.querySelector('.if-acc-badge')).toBeNull();
        fireEvent.click(bar);
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('shows the client, total and item badge of an active order', () => {
        const onOpen = jest.fn();
        const {container} = render(<ActiveOrderBar view={ACTIVE} onOpen={onOpen}/>);
        const bar = screen.getByRole('button', {name: /Giorgi Beridze/});
        expect(bar).not.toHaveClass('is-idle');
        expect(screen.getByText('Active Order · 488.30 ₾')).toBeInTheDocument();
        expect(container.querySelector('.if-acc-badge')).toHaveTextContent('4');
        fireEvent.click(bar);
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('hides a zero badge on an active order and caps a large one', () => {
        const {container, rerender} = render(
            <ActiveOrderBar view={{...ACTIVE, badgeCount: 0}} onOpen={() => {}}/>
        );
        expect(container.querySelector('.if-acc-badge')).toBeNull();
        rerender(<ActiveOrderBar view={{...ACTIVE, badgeCount: 120}} onOpen={() => {}}/>);
        expect(container.querySelector('.if-acc-badge')).toHaveTextContent('99+');
    });

    it('exposes the cart icon the add-to-cart animation targets', () => {
        const {container} = render(<ActiveOrderBar view={ACTIVE} onOpen={() => {}}/>);
        expect(container.querySelector('.if-accessory .if-acc-icon')).not.toBeNull();
    });
});
