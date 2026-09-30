import React from 'react';
import {render, screen} from '@testing-library/react';
import {LanguageProvider} from '../../../i18n/LanguageContext';
import EntryListEditor from './EntryListEditor';

beforeEach(() => localStorage.setItem('language', 'en'));

const wrap = ui => render(<LanguageProvider>{ui}</LanguageProvider>);

const ENTRIES = [
    {key: 'sku', hidden: false, label: 'SKU'},
    {key: 'price', hidden: true, label: 'Price'},
];

describe('EntryListEditor', () => {
    it('leaves every switch enabled when requireOneVisible is not set', () => {
        wrap(<EntryListEditor entries={ENTRIES} textField="label" labelFor={key => key} onChange={jest.fn()} />);
        expect(screen.getByLabelText('sku')).toBeEnabled();
    });

    it('disables the last visible entry switch when requireOneVisible is set', () => {
        wrap(<EntryListEditor entries={ENTRIES} textField="label" labelFor={key => key}
                              onChange={jest.fn()} requireOneVisible />);
        expect(screen.getByLabelText('sku')).toBeDisabled();
        expect(screen.getByLabelText('price')).toBeEnabled();
    });

    it('re-enables once a second entry is visible', () => {
        const entries = [
            {key: 'sku', hidden: false, label: 'SKU'},
            {key: 'price', hidden: false, label: 'Price'},
        ];
        wrap(<EntryListEditor entries={entries} textField="label" labelFor={key => key}
                              onChange={jest.fn()} requireOneVisible />);
        expect(screen.getByLabelText('sku')).toBeEnabled();
        expect(screen.getByLabelText('price')).toBeEnabled();
    });
});
