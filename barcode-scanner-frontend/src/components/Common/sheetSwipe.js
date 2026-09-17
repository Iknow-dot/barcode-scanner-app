// Swipe-down-to-dismiss for sheets (moved here from the order drawer). Only a
// downward drag past the threshold closes, and only while the content is
// scrolled to the top, so ordinary scrolling inside a sheet never closes it.
export const SWIPE_CLOSE_THRESHOLD = 80;

export const swipeClosesSheet = (scrollTop, deltaY) => (
    scrollTop <= 0 && deltaY > SWIPE_CLOSE_THRESHOLD
);
