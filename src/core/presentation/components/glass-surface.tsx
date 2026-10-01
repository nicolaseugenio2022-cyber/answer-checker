/**
 * Class names for a translucent surface with a thin defining edge, for content
 * that sits over the app backdrop. It does not blur: what is behind it is a
 * soft, static glow, so a live blur would cost frames on Android and change
 * nothing visible. Only the tab bar, which has content scrolling beneath it,
 * uses a real blur.
 *
 * Do not nest one glass surface inside another.
 */
export const GLASS_CLASSES = 'border border-glass-border/15 bg-glass/70';
