import {canvasScale, CANVAS_PAGE_WIDTH} from './canvasScale';

describe('canvasScale', () => {
    it('never upscales: a container wider than the page renders at 1', () => {
        expect(canvasScale(1440)).toBe(1);
        expect(canvasScale(CANVAS_PAGE_WIDTH)).toBe(1);
    });

    it('shrinks proportionally for a narrower container', () => {
        expect(canvasScale(460)).toBe(0.5);
    });

    it('falls back to 1 for an unmeasured (0/undefined) container width', () => {
        expect(canvasScale(0)).toBe(1);
        expect(canvasScale(undefined)).toBe(1);
        expect(canvasScale(null)).toBe(1);
    });

    it('respects a custom page width', () => {
        expect(canvasScale(200, 400)).toBe(0.5);
    });
});
