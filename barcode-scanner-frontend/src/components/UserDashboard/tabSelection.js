// Pure decision logic for the bottom TabBar's onSelectTab handler.
//
// Re-tapping the already-selected Products tab while a product result is
// showing pops back to Home (the scanner lives only on Home, so this is the
// fast way back instead of a "Back" tap on the result). Any other re-tap
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
    return 'none';
};

export default nextTabAction;
