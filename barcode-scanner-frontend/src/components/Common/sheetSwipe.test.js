import {SWIPE_CLOSE_THRESHOLD, swipeClosesSheet} from './sheetSwipe';

describe('swipeClosesSheet', () => {
    it('closes on a long downward drag from the top of the content', () => {
        expect(swipeClosesSheet(0, SWIPE_CLOSE_THRESHOLD + 1)).toBe(true);
    });

    it('ignores a drag up to the threshold', () => {
        expect(swipeClosesSheet(0, SWIPE_CLOSE_THRESHOLD)).toBe(false);
        expect(swipeClosesSheet(0, -200)).toBe(false);
    });

    it('never closes while the content is scrolled down', () => {
        expect(swipeClosesSheet(40, 300)).toBe(false);
    });
});
