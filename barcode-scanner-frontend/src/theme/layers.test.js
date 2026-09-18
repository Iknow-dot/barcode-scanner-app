import {
    ANTD_OVERLAY_BASE,
    ANTD_STATIC_MODAL,
    LAYER_BARS,
    LAYER_RESULT_SHEET,
    LAYER_SCANNER,
    LAYER_SCANNER_CHROME,
    LAYER_SHEET,
    LAYER_SHEET_MAX,
    LAYER_SHEET_STEP,
    sheetZIndex,
} from './layers';

describe('layers', () => {
    it('orders the fixed bands lowest to highest: bars, sheets, antd overlays', () => {
        expect(LAYER_BARS).toBeLessThan(LAYER_SHEET);
        expect(LAYER_SHEET).toBeLessThan(ANTD_OVERLAY_BASE);
        expect(LAYER_SHEET_MAX).toBeLessThan(ANTD_OVERLAY_BASE);
    });

    it('stacks the scanner above every ordinary antd overlay, so it covers a sheet or drawer left open behind it', () => {
        expect(LAYER_SCANNER).toBeGreaterThan(ANTD_OVERLAY_BASE);
        // Even the deepest possible stacked sheet stays under the scanner.
        expect(LAYER_SCANNER).toBeGreaterThan(sheetZIndex(50));
    });

    it("keeps the scanner below antd's own static Modal.confirm, so a confirm raised while scanning stays reachable", () => {
        expect(LAYER_SCANNER).toBeLessThan(ANTD_STATIC_MODAL);
    });

    it("puts the scanner chrome above its own video surface, defined relative to LAYER_SCANNER rather than a magic number", () => {
        expect(LAYER_SCANNER_CHROME).toBeGreaterThan(LAYER_SCANNER);
        expect(LAYER_SCANNER_CHROME).toBe(LAYER_SCANNER + 10);
        expect(LAYER_SCANNER_CHROME).toBeLessThan(ANTD_STATIC_MODAL);
    });

    // F4: the order-confirmed result sheet used to sit at the ordinary sheet
    // band (900), entirely hidden if the consultant closed the order sheet
    // and opened the full-screen scanner for the next customer while the
    // confirm was still resolving. It needs its own layer above the
    // scanner — a "must be seen" result, not a sheet the camera should be
    // able to cover — while staying below antd's own static Modal/toast band
    // like every other sheet.
    it('puts the order-confirmed result sheet above the scanner, still below antd\'s static overlays', () => {
        expect(LAYER_RESULT_SHEET).toBeGreaterThan(LAYER_SCANNER);
        expect(LAYER_RESULT_SHEET).toBeGreaterThan(LAYER_SCANNER_CHROME);
        expect(LAYER_RESULT_SHEET).toBeLessThan(ANTD_STATIC_MODAL);
    });
});
