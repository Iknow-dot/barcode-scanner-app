import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import LockedFeature from './LockedFeature';

describe('LockedFeature', () => {
    const renderLocked = () => render(
        <LockedFeature
            title="Catalog is locked"
            description="Contact us to enable it."
            unlockLabel="Unlock"
            unlockHint="Ask your provider."
        >
            <div data-testid="demo-content">demo rows</div>
        </LockedFeature>
    );

    it('shows the overlay title, description and unlock button', () => {
        renderLocked();
        expect(screen.getByText('Catalog is locked')).toBeInTheDocument();
        expect(screen.getByText('Contact us to enable it.')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: /Unlock/})).toBeInTheDocument();
    });

    it('renders the demo children blurred, inert and hidden from assistive tech', () => {
        renderLocked();
        const demo = screen.getByTestId('demo-content').parentElement;
        expect(demo).toHaveStyle({pointerEvents: 'none'});
        expect(demo).toHaveAttribute('aria-hidden', 'true');
        expect(demo.style.filter).toContain('blur');
    });

    it('reveals the unlock hint when the unlock button is pressed', () => {
        renderLocked();
        expect(screen.queryByText('Ask your provider.')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: /Unlock/}));
        expect(screen.getByText('Ask your provider.')).toBeInTheDocument();
    });
});
