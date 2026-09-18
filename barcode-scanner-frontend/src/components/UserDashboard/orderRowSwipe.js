// Swipe-to-reveal for an order row's print/delete actions (iOS Mail/
// Messages idiom). Same shape as Common/sheetSwipe.js: small pure decision
// functions the component calls instead of doing the arithmetic inline.
//
// A touch is undecided until it has moved clearly more on one axis than the
// other; once it commits, it stays committed for the rest of that touch —
// that's what keeps a vertical list flick from ever starting a reveal
// (ruling: "once vertical wins, abandon the gesture for that touch") and,
// symmetrically, keeps an intentional horizontal drag from being cancelled
// by an incidental vertical wobble partway through.

// Below this many px of movement on both axes, direction is still
// ambiguous — neither axis has "clearly" won yet.
export const SWIPE_AXIS_THRESHOLD = 8;

const axisFromDeltas = (deltaX, deltaY) => {
    if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < SWIPE_AXIS_THRESHOLD) return 'undecided';
    // A tie is not a *clear* horizontal lead, so it resolves to vertical —
    // the safer default that favours scrolling over an accidental reveal.
    return Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
};

// `previousAxis` is whatever this function last returned for the current
// touch (or 'undecided' at touchstart). Once it has committed to an axis it
// never reconsiders, so the caller should keep feeding it its own last
// result rather than recomputing from scratch each touchmove.
export const nextSwipeAxis = (previousAxis, deltaX, deltaY) => (
    previousAxis === 'undecided' ? axisFromDeltas(deltaX, deltaY) : previousAxis
);

// Clamps a horizontal drag into a resting offset within [-revealWidth, 0].
// Starting from the row's already-open offset (rather than always from 0)
// means a drag on an already-open row tracks the finger continuously
// instead of jumping back to the closed position first.
export const swipeRevealOffset = (deltaX, revealWidth, wasOpen) => {
    const base = wasOpen ? -revealWidth : 0;
    return Math.min(0, Math.max(-revealWidth, base + deltaX));
};

// Past halfway, a released drag snaps open; short of it, it springs back
// closed — the standard iOS reveal threshold, scaled to the row's own
// reveal width (a print-only row reveals less than a draft's print+delete).
export const swipeRestsOpen = (offset, revealWidth) => offset <= -revealWidth / 2;
