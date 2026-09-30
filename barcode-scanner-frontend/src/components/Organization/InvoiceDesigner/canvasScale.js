// src/components/Organization/InvoiceDesigner/canvasScale.js

/** The invoice sheet's print/preview layout width: the 880px sheet max-width
 * plus its surrounding page padding (see backend/core/services/invoice_renderer.py
 * `_PAGE_CSS`). The canvas renders the iframe at this fixed width and scales
 * it down to fit, so the preview always uses the same layout breakpoints a
 * printed page would, never the responsive `@media (max-width: 640px)` rules
 * meant for a narrow browser window. */
export const CANVAS_PAGE_WIDTH = 920;

/**
 * The factor to shrink a `pageWidth`-wide iframe by so it fits a container
 * that is `containerWidth` wide, never growing past 1 (never upscale a
 * container wider than the page). A falsy/non-positive `containerWidth`
 * (not yet measured, or a `ResizeObserver` reporting nothing) is treated as
 * "wide enough" so the caller falls back to an unscaled layout instead of
 * collapsing to 0.
 */
export const canvasScale = (containerWidth, pageWidth = CANVAS_PAGE_WIDTH) => {
    if (!containerWidth || containerWidth <= 0 || !pageWidth || pageWidth <= 0) return 1;
    return Math.min(1, containerWidth / pageWidth);
};
