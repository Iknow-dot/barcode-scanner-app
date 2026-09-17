import React from 'react';
import {render, screen} from '@testing-library/react';
import AppErrorFallback from './AppErrorFallback';
import {LanguageProvider} from '../i18n/LanguageContext';

// `--if-bg-grouped` (see src/theme/tokens.css / palette.js) — chosen over
// `--if-tint` because antd's dark algorithm re-derives the primary-colour
// seed itself (`#3a9866` in, `#34845a` out), while background tokens pass
// through the ConfigProvider literally. jsdom doesn't compute antd's
// CSS-in-JS `background-color` on the element itself (it reports the UA
// button default), but ConfigProvider's injected <style> tag does carry
// this exact literal wherever it actually wraps the tree — a real,
// mode-specific, non-vacuous signal that goes away if AppErrorFallback ever
// renders outside a themed ConfigProvider again (falling back to antd's own
// default palette instead).
const BG_GROUPED_LIGHT_HEX = 'f2f2f2';
const BG_GROUPED_DARK_HEX = '1b1e24';

const renderFallback = () =>
    render(
        <LanguageProvider>
            <AppErrorFallback/>
        </LanguageProvider>
    );

const injectedStyleText = () =>
    Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('\n');

describe('AppErrorFallback', () => {
    afterEach(() => {
        document.body.classList.remove('dark-theme');
    });

    it('renders a primary reload button', () => {
        renderFallback();
        const button = screen.getByRole('button');
        expect(button).toBeInTheDocument();
        expect(button).toHaveClass('ant-btn-primary');
    });

    it('wraps itself in the light app theme instead of falling back to antd default blue', () => {
        renderFallback();
        expect(injectedStyleText()).toEqual(expect.stringContaining(BG_GROUPED_LIGHT_HEX));
    });

    it('wraps itself in the dark app theme when the body is already in dark mode', () => {
        document.body.classList.add('dark-theme');
        renderFallback();
        expect(screen.getByRole('button')).toHaveClass('ant-btn-primary');
        expect(injectedStyleText()).toEqual(expect.stringContaining(BG_GROUPED_DARK_HEX));
    });
});
