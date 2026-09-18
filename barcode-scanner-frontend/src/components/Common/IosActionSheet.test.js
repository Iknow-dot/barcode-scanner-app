import React from 'react';
import {render, screen, fireEvent} from '@testing-library/react';
import IosActionSheet from './IosActionSheet';
import {LanguageProvider} from '../../i18n/LanguageContext';
import translations from '../../i18n/translations';

const en = translations.en;

// jsdom lacks these browser APIs that antd's Drawer (under IosSheet) touches.
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

const makeActions = () => ([
    {key: 'print', label: 'Print', onSelect: jest.fn()},
    {key: 'delete', label: 'Delete', destructive: true, onSelect: jest.fn()},
]);

const renderSheet = (props = {}) => {
    const actions = props.actions || makeActions();
    const onClose = jest.fn();
    const utils = render(
        <LanguageProvider>
            <IosActionSheet open title="Order #123" onClose={onClose} {...props} actions={actions}/>
        </LanguageProvider>
    );
    return {actions, onClose, ...utils};
};

describe('IosActionSheet', () => {
    beforeEach(() => {
        localStorage.setItem('language', 'en');
    });

    afterEach(() => {
        localStorage.removeItem('language');
    });

    // Fails if the component doesn't render a button per action, or renders
    // some other text than the `label` field (e.g. the key, or nothing).
    it("renders each action's label", () => {
        renderSheet();
        expect(screen.getByRole('button', {name: 'Print'})).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Delete'})).toBeInTheDocument();
    });

    // Fails if the destructive row is missing the `is-destructive` class (so
    // CLAUDE.md's --if-red-text styling never reaches it), or if it has no
    // accessible description naming it destructive (so it renders identically
    // to a normal row for a screen reader). Also fails if a NON-destructive
    // row is wrongly marked either way, which would prove the branch is
    // hard-coded rather than reading `action.destructive`.
    it('styles and announces a destructive action as destructive', () => {
        renderSheet();
        const destructiveButton = screen.getByRole('button', {name: 'Delete'});
        expect(destructiveButton).toHaveClass('is-destructive');
        expect(destructiveButton).toHaveAccessibleDescription(en.destructiveAction);

        const normalButton = screen.getByRole('button', {name: 'Print'});
        expect(normalButton).not.toHaveClass('is-destructive');
        expect(normalButton).toHaveAccessibleDescription('');
    });

    // Fails if onSelect isn't called (the action never fires), if onClose
    // isn't called (the sheet would stay open over a completed action), or
    // if the WRONG action's onSelect fires (would still pass a test that
    // only checked one of the two actions, which is why both are asserted).
    it('calls the chosen action and closes when a row is selected', () => {
        const {actions, onClose} = renderSheet();
        fireEvent.click(screen.getByRole('button', {name: 'Print'}));
        expect(actions[0].onSelect).toHaveBeenCalledTimes(1);
        expect(actions[1].onSelect).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // Fails if Cancel calls any action's onSelect (it must be a pure dismiss,
    // never mistaken for a zero-th action), if it doesn't call onClose, or if
    // it isn't set apart from the action list in its own group — asserted so
    // a Cancel row merged into the same <ul> as the actions still fails here.
    it('cancels without calling any action, from its own separated group', () => {
        const {actions, onClose} = renderSheet();
        const cancelButton = screen.getByRole('button', {name: en.cancel});
        expect(cancelButton.closest('ul')).toHaveClass('if-action-sheet-cancel-group');
        fireEvent.click(cancelButton);
        actions.forEach((action) => expect(action.onSelect).not.toHaveBeenCalled());
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    // Fails if IosSheet's underlying Drawer renders its content even while
    // closed (e.g. a missing `open` pass-through), which would leave the
    // action labels and Cancel discoverable in the document.
    it('renders nothing when closed', () => {
        renderSheet({open: false});
        expect(screen.queryByText('Print')).not.toBeInTheDocument();
        expect(screen.queryByText('Delete')).not.toBeInTheDocument();
        expect(screen.queryByText(en.cancel)).not.toBeInTheDocument();
    });

    // A custom cancel label overrides the default t.cancel — fails if the
    // component ignores `cancelLabel` and always renders the built-in word.
    it('accepts a custom cancel label', () => {
        renderSheet({cancelLabel: 'Never mind'});
        expect(screen.getByRole('button', {name: 'Never mind'})).toBeInTheDocument();
        expect(screen.queryByRole('button', {name: en.cancel})).not.toBeInTheDocument();
    });
});
