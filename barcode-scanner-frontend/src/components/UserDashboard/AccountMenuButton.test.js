import React from 'react';
import {render, screen, fireEvent, act} from '@testing-library/react';
import AccountMenuButton from './AccountMenuButton';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

const en = translations.en;

// jsdom lacks these browser APIs that antd's Dropdown touches.
beforeAll(() => {
    window.matchMedia = window.matchMedia || ((query) => ({
        matches: false, media: query, onchange: null,
        addListener: () => {}, removeListener: () => {},
        addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
    }));
    global.ResizeObserver = global.ResizeObserver || class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

const openMenu = async (props = {}) => {
    const handlers = {onToggleTheme: jest.fn(), onLogout: jest.fn()};
    render(
        <LanguageProvider>
            <AccountMenuButton username="sopo" isDark={false} {...handlers} {...props}/>
        </LanguageProvider>
    );
    fireEvent.click(screen.getByRole('button', {name: en.accountMenu}));
    await act(async () => {});
    return handlers;
};

describe('AccountMenuButton', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('shows the user\'s initial on a labelled button', () => {
        render(
            <LanguageProvider>
                <AccountMenuButton username="sopo" onToggleTheme={jest.fn()} onLogout={jest.fn()}/>
            </LanguageProvider>
        );
        expect(screen.getByRole('button', {name: en.accountMenu})).toHaveTextContent('S');
    });

    it('checks the current language and switches to the other', async () => {
        await openMenu();
        const english = screen.getByRole('menuitem', {name: en.english});
        expect(english.querySelector('[data-icon="check"]')).not.toBeNull();
        const georgian = screen.getByRole('menuitem', {name: en.georgian});
        expect(georgian.querySelector('[data-icon="check"]')).toBeNull();
        fireEvent.click(georgian);
        expect(localStorage.getItem('language')).toBe('ka');
    });

    it('offers dark mode in light mode and toggles the theme', async () => {
        const {onToggleTheme} = await openMenu({isDark: false});
        fireEvent.click(screen.getByRole('menuitem', {name: new RegExp(en.darkMode)}));
        expect(onToggleTheme).toHaveBeenCalledTimes(1);
    });

    it('offers light mode in dark mode', async () => {
        await openMenu({isDark: true});
        expect(screen.getByRole('menuitem', {name: new RegExp(en.lightMode)})).toBeInTheDocument();
    });

    it('logs out', async () => {
        const {onLogout} = await openMenu();
        fireEvent.click(screen.getByRole('menuitem', {name: new RegExp(en.logout)}));
        expect(onLogout).toHaveBeenCalledTimes(1);
    });
});
