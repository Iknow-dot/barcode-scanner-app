import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import AdminNavDrawer from './AdminNavDrawer';

describe('AdminNavDrawer', () => {
    const items = [
        {key: '2', label: 'Warehouses', onClick: jest.fn()},
        {key: '8', label: 'Catalog', onClick: jest.fn()},
    ];

    it('renders the nav items when open', () => {
        render(<AdminNavDrawer open items={items} onClose={() => {}}/>);
        expect(screen.getByText('Warehouses')).toBeInTheDocument();
        expect(screen.getByText('Catalog')).toBeInTheDocument();
    });

    it('renders nothing when closed', () => {
        render(<AdminNavDrawer open={false} items={items} onClose={() => {}}/>);
        expect(screen.queryByText('Warehouses')).not.toBeInTheDocument();
    });

    it('closes itself after a nav item is chosen', () => {
        const onClose = jest.fn();
        render(<AdminNavDrawer open items={items} onClose={onClose}/>);
        fireEvent.click(screen.getByText('Catalog'));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(items[1].onClick).toHaveBeenCalled();
    });
});
