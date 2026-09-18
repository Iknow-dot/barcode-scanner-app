import {nextSwipeAxis, swipeRevealOffset, swipeRestsOpen} from './orderRowSwipe';

describe('nextSwipeAxis', () => {
    it('stays undecided below the threshold on both axes', () => {
        expect(nextSwipeAxis('undecided', 3, 3)).toBe('undecided');
    });

    it('commits to horizontal once sideways movement clearly leads', () => {
        expect(nextSwipeAxis('undecided', -20, 4)).toBe('horizontal');
    });

    it('commits to vertical once vertical movement clearly leads', () => {
        expect(nextSwipeAxis('undecided', 4, 20)).toBe('vertical');
    });

    it('treats a tie as vertical, not a "clear" horizontal lead', () => {
        expect(nextSwipeAxis('undecided', 12, 12)).toBe('vertical');
    });

    // The core requirement (controller ruling #3): once a touch has been
    // recognised as a vertical scroll, it must stay that way for the rest of
    // that touch, even if a later sample looks strongly horizontal — a flick
    // that starts as a scroll must never flip into revealing actions mid-way.
    it('locks into vertical and ignores a later horizontal-looking sample', () => {
        expect(nextSwipeAxis('vertical', -500, 1)).toBe('vertical');
    });

    it('symmetrically locks into horizontal once committed', () => {
        expect(nextSwipeAxis('horizontal', 1, 500)).toBe('horizontal');
    });
});

describe('swipeRevealOffset', () => {
    it('tracks a leftward drag 1:1 from a closed row', () => {
        expect(swipeRevealOffset(-30, 88, false)).toBe(-30);
    });

    it('clamps to fully open when the drag exceeds the reveal width', () => {
        expect(swipeRevealOffset(-200, 88, false)).toBe(-88);
    });

    it('clamps to fully closed when dragging right from an already-closed row', () => {
        expect(swipeRevealOffset(50, 88, false)).toBe(0);
    });

    it('continues tracking the finger from the open position, not from zero', () => {
        expect(swipeRevealOffset(-10, 88, true)).toBe(-88);
        expect(swipeRevealOffset(30, 88, true)).toBe(-58);
    });

    it('clamps to fully closed when a rightward drag on an open row overshoots', () => {
        expect(swipeRevealOffset(200, 88, true)).toBe(0);
    });
});

describe('swipeRestsOpen', () => {
    it('opens once a released drag reaches the halfway point', () => {
        expect(swipeRestsOpen(-44, 88)).toBe(true);
    });

    it('springs closed short of halfway', () => {
        expect(swipeRestsOpen(-43, 88)).toBe(false);
    });

    it('opens at the fully-dragged extreme', () => {
        expect(swipeRestsOpen(-88, 88)).toBe(true);
    });

    it('stays closed at rest (zero offset)', () => {
        expect(swipeRestsOpen(0, 88)).toBe(false);
    });

    // A print-only row (no delete action) reveals a narrower 44px panel —
    // the halfway point must scale with it, not stay pinned to 44.
    it('scales the halfway point to a narrower reveal width', () => {
        expect(swipeRestsOpen(-22, 44)).toBe(true);
        expect(swipeRestsOpen(-21, 44)).toBe(false);
    });
});
