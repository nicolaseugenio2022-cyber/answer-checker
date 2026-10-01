/** Height of the floating glass capsule itself. */
export const TAB_CAPSULE_HEIGHT = 64;

/** Corner radius of the capsule. */
export const TAB_CAPSULE_RADIUS = 24;

/** How far the raised active-tab collar extends above the capsule's top edge. */
export const TAB_INDICATOR_RISE = 18;

/** Diameter of the raised collar: the ring of bar surface around the pink disc. */
export const TAB_COLLAR_SIZE = 52;

/** Diameter of the pink disc that holds the active tab's icon. */
export const TAB_DISC_SIZE = 42;

/**
 * Horizontal padding between the capsule's ends and the first and last tab
 * slots. The five slots divide the width left after this padding, which keeps
 * the collar over Home and Results on the straight part of the capsule's top
 * edge instead of on its rounded corners.
 */
export const TAB_BAR_INNER_PADDING = 20;

/**
 * Full height of the tab bar: capsule plus the collar above it. The bar's
 * container and every tab's touch target are this tall, so the collar never
 * overflows its parent (Android does not deliver touches outside it).
 */
export const TAB_BAR_HEIGHT = TAB_CAPSULE_HEIGHT + TAB_INDICATOR_RISE;

/** Space between the capsule and the bottom safe-area inset (gesture/navigation area). */
export const TAB_BAR_BOTTOM_GAP = 12;

/** Space between the capsule and the screen edges. */
export const TAB_BAR_SIDE_MARGIN = 16;

/** Breathing room between the end of scrolled content and the top of the bar. */
export const TAB_BAR_CONTENT_GAP = 16;

/**
 * Space a scrolling screen must leave below its last item so that item can
 * scroll completely above the floating bar: the safe-area inset, the gap under
 * the bar, the bar including its raised collar, and a little breathing room.
 */
export function tabBarClearance(bottomInset: number): number {
  return bottomInset + TAB_BAR_BOTTOM_GAP + TAB_BAR_HEIGHT + TAB_BAR_CONTENT_GAP;
}
