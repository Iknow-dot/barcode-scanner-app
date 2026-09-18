// Stacking order of the consultant screen's fixed layers, lowest first.
//
// antd's overlays start at its zIndexPopupBase (1000): Drawer and Modal sit
// there, popups inside a container are raised above it through antd's
// z-index context. antd's own *static* Modal.confirm/.info/.warning/etc. is
// hardcoded to 2000 and its notifications to 2050 — both outside our
// control, so nothing here can move them; this file's own bands are placed
// to avoid colliding with them instead (see LAYER_SCANNER below).
//
// The floating bars stay under every sheet, and sheets stay under every antd
// overlay. So a client lookup, a confirm or a date picker opened from a sheet
// always lands on top, whichever portal was appended to <body> first.
export const LAYER_BARS = 100; // .if-bottom-stack; the scroll-edge fade is one below
export const LAYER_SHEET = 900; // IosSheet, level 0
export const LAYER_SHEET_STEP = 10; // gap between stacked sheet levels (phase 4 opens a sheet over a sheet)
export const ANTD_OVERLAY_BASE = 1000; // antd zIndexPopupBase
// Ceiling for a stacked sheet: must stay strictly below antd's own overlay
// band, so a popup, confirm or picker opened from the top sheet still lands
// above every sheet, however many are stacked.
export const LAYER_SHEET_MAX = ANTD_OVERLAY_BASE - LAYER_SHEET_STEP;

/** IosSheet's Drawer z-index for a given stacking level (0 = the base sheet). */
export const sheetZIndex = (level = 0) => Math.min(LAYER_SHEET + level * LAYER_SHEET_STEP, LAYER_SHEET_MAX);

// antd's own static Modal.confirm/.info/.warning/etc., hardcoded to 2000
// (notifications sit above it, at 2050). Named here so LAYER_SCANNER's
// placement below is a documented relation, not another magic number.
export const ANTD_STATIC_MODAL = 2000;

// The full-screen camera scanner (BarcodeScanner.js). It sits above every
// ordinary antd overlay (ANTD_OVERLAY_BASE) — including any sheet or drawer
// left open behind it — because it is a true full-screen takeover: nothing
// short of antd's own static dialogs should show through it.
//
// It deliberately stays *below* ANTD_STATIC_MODAL/notifications. Those
// interrupt the consultant regardless of what else is on screen (e.g. an
// async order push completing, or a print-prompt confirm, while the camera
// is still up), so a confirm or toast raised while scanning must still reach
// the consultant on top of the camera feed rather than be trapped behind it.
// BarcodeScanner.css used to hard-code the overlay itself at 2000, tying it
// with Modal.confirm — an indeterminate stack order broken only by DOM
// append order. Picking a value strictly between ANTD_OVERLAY_BASE and
// ANTD_STATIC_MODAL resolves that collision instead of matching either band.
export const LAYER_SCANNER = 1900;
// The scanner's own top/bottom bars (BarcodeScanner.css's
// .scanner-top-bar / .scanner-bottom-bar), which must sit above its own
// video surface — defined relative to LAYER_SCANNER, not a second magic
// number, and still comfortably below ANTD_STATIC_MODAL.
export const LAYER_SCANNER_CHROME = LAYER_SCANNER + 10;
