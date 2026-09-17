import React from 'react';
import ReactDOM from 'react-dom';
import {render, screen, fireEvent, waitFor} from '@testing-library/react';
import IosSheet from './IosSheet';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';
import {LAYER_SHEET, LAYER_SHEET_STEP} from '../../theme/layers';

const en = translations.en;

// jsdom lacks these browser APIs that antd's Drawer touches.
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

const renderSheet = (props = {}) => {
    const handlers = {onClose: jest.fn(), onBack: jest.fn(), afterClose: jest.fn()};
    const utils = render(
        <LanguageProvider>
            <IosSheet open title="Cart" subtitle="1 / 2 · Products" {...handlers} {...props}>
                <p>Sheet content</p>
            </IosSheet>
        </LanguageProvider>
    );
    return {...handlers, ...utils};
};

describe('IosSheet', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    it('is a dialog named by its title, with the subtitle and content', () => {
        renderSheet();
        const dialog = screen.getByRole('dialog', {name: 'Cart'});
        expect(dialog).toHaveTextContent('1 / 2 · Products');
        expect(dialog).toHaveTextContent('Sheet content');
    });

    it('sits on the sheet layer', () => {
        renderSheet();
        expect(document.querySelector('.if-sheet.ant-drawer').style.zIndex).toBe(String(LAYER_SHEET));
    });

    it('moves up a level so a sheet opened over this one still stacks above it', () => {
        renderSheet({level: 1});
        expect(document.querySelector('.if-sheet.ant-drawer').style.zIndex)
            .toBe(String(LAYER_SHEET + LAYER_SHEET_STEP));
    });

    it('closes from the round close button', () => {
        const {onClose, onBack} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: en.close}));
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onBack).not.toHaveBeenCalled();
    });

    it('goes back instead of closing when the leading button is a back button', () => {
        const {onClose, onBack} = renderSheet({leading: 'back'});
        expect(screen.queryByRole('button', {name: en.close})).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: en.back}));
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('shows the trailing control, or keeps the title centred without one', () => {
        const {rerender} = renderSheet();
        expect(document.querySelector('.if-sheet-nav-spacer')).not.toBeNull();
        rerender(
            <LanguageProvider>
                <IosSheet open title="Cart" onClose={() => {}} trailing={<button type="button">More</button>}>
                    <p>Sheet content</p>
                </IosSheet>
            </LanguageProvider>
        );
        expect(screen.getByRole('button', {name: 'More'})).toBeInTheDocument();
        expect(document.querySelector('.if-sheet-nav-spacer')).toBeNull();
    });

    it('floats the action bar at the end of the scrolling content', () => {
        renderSheet({bottomBar: <button type="button">Next</button>, bottomBarLayout: 'row'});
        const bar = screen.getByRole('button', {name: 'Next'}).parentElement;
        expect(bar).toHaveClass('if-sheet-bar', 'is-row');
        expect(bar.parentElement).toHaveClass('if-sheet-scroll');
    });

    it('closes on a downward swipe from the top of the content', () => {
        const {onClose} = renderSheet();
        const frame = document.querySelector('.if-sheet-frame');
        fireEvent.touchStart(frame, {touches: [{clientY: 100}]});
        fireEvent.touchMove(frame, {touches: [{clientY: 150}]});
        expect(onClose).not.toHaveBeenCalled();
        fireEvent.touchMove(frame, {touches: [{clientY: 260}]});
        fireEvent.touchMove(frame, {touches: [{clientY: 300}]});
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not close on a swipe while the content is scrolled down', () => {
        const {onClose} = renderSheet();
        const frame = document.querySelector('.if-sheet-frame');
        document.querySelector('.if-sheet-scroll').scrollTop = 120;
        fireEvent.touchStart(frame, {touches: [{clientY: 100}]});
        fireEvent.touchMove(frame, {touches: [{clientY: 400}]});
        expect(onClose).not.toHaveBeenCalled();
    });

    it('does not treat a touch starting in a portaled popup as a swipe start', () => {
        // A date picker or dropdown opened from inside the sheet portals its
        // popup to document.body: a DOM sibling of the frame, but still a
        // React descendant, so the touch handlers on the frame still see it.
        const onClose = jest.fn();
        const Portal = () => ReactDOM.createPortal(
            <button type="button" data-testid="portaled">Popup option</button>,
            document.body,
        );
        render(
            <LanguageProvider>
                <IosSheet open title="Cart" onClose={onClose}>
                    <p>Sheet content</p>
                    <Portal/>
                </IosSheet>
            </LanguageProvider>
        );
        const portaled = screen.getByTestId('portaled');
        fireEvent.touchStart(portaled, {touches: [{clientY: 100}]});
        fireEvent.touchMove(portaled, {touches: [{clientY: 400}]});
        expect(onClose).not.toHaveBeenCalled();
    });

    it('can turn the swipe off', () => {
        const {onClose} = renderSheet({swipeToClose: false});
        const frame = document.querySelector('.if-sheet-frame');
        fireEvent.touchStart(frame, {touches: [{clientY: 100}]});
        fireEvent.touchMove(frame, {touches: [{clientY: 400}]});
        expect(onClose).not.toHaveBeenCalled();
    });

    it('reports when it has finished closing', async () => {
        const {rerender, afterClose} = renderSheet();
        rerender(
            <LanguageProvider>
                <IosSheet open={false} title="Cart" onClose={() => {}} afterClose={afterClose}>
                    <p>Sheet content</p>
                </IosSheet>
            </LanguageProvider>
        );
        await waitFor(() => expect(afterClose).toHaveBeenCalledTimes(1), {timeout: 2000});
    });
});
