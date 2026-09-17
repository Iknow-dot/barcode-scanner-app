// Stacking order of the consultant screen's fixed layers, lowest first.
//
// antd's overlays start at its zIndexPopupBase (1000): Drawer and Modal sit
// there, popups inside a container are raised above it through antd's z-index
// context, a static Modal.confirm uses 2000 and notifications 2050. The
// barcode scanner overlay is 2000 (BarcodeScanner.css).
//
// The floating bars stay under every sheet, and sheets stay under every antd
// overlay. So a client lookup, a confirm or a date picker opened from a sheet
// always lands on top, whichever portal was appended to <body> first.
export const LAYER_BARS = 100; // .if-bottom-stack; the scroll-edge fade is one below
export const LAYER_SHEET = 900; // IosSheet
export const ANTD_OVERLAY_BASE = 1000; // antd zIndexPopupBase
