// Pure decision logic for the bottom TabBar's onSelectTab handler.
//
// Re-tapping the already-selected Products tab while a product result is
// showing pops back to Home (the scanner lives only on Home, so this is the
// fast way back instead of a "Back" tap on the result). Re-tapping the
// already-selected Catalog tab pops it to its root (category root, search
// cleared) — the usual iOS convention for a re-tapped tab. Any other re-tap
// (Orders, or Products with no result) does nothing. Tapping a different tab
// always just switches — in particular Orders -> Products keeps whatever the
// scan tab was already showing (result or Home).
export const nextTabAction = (currentTab, tappedTab, hasProductResult) => {
    if (tappedTab !== currentTab) {
        return 'switch';
    }
    if (tappedTab === 'scan' && hasProductResult) {
        return 'pop-to-home';
    }
    if (tappedTab === 'catalog') {
        return 'pop-to-root';
    }
    return 'none';
};

// The two actions UserDashboard's handleOpenSearch performs, always in this
// exact order: release the camera before switching the screen to the
// Catalog tab. Extracted as a plain ordered list — rather than left as the
// two setState calls it wraps — so the ORDERING is what a test asserts on
// directly, without mounting UserDashboard (which has no test coverage of
// its own). The order is not incidental: a camera left running when the
// screen changes keeps the device's privacy indicator lit, drains battery,
// and can make the next getUserMedia call fail outright on some Android
// browsers — phase 5b spent a whole fix wave recovering from exactly this
// ordering being wrong once. Shared by all four entry points that open the
// catalog via handleOpenSearch (Home's manual-search button, the empty
// cart's, the scanner's manual-search pill) — the trailing tab bar button
// goes through handleSelectTab/nextTabAction above instead, not this.
export const openCatalogSearchActions = () => ['closeScanner', 'openCatalogTab'];

export default nextTabAction;
