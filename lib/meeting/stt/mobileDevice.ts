// Kept free of "use client" so both client and shared modules can import it.

/** True on a phone or tablet (not merely a narrow desktop window). Local
 *  browser models are far too heavy for these, so they always use the API. */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  // iPadOS reports a desktop (Macintosh) user agent but has a touch screen.
  if (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1) return true;
  try {
    return window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 768;
  } catch {
    return false;
  }
}
