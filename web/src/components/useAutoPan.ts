import { useEffect, type RefObject } from "react";

/**
 * For artwork wider than a phone screen: the first time the section is mostly in view it pans to the right by itself
 * (so the reader sees it is wider than the screen), then hands control back. Any touch, wheel, key press or drag
 * cancels it at once. Skipped when the section already fits or the reader prefers reduced motion.
 */
export default function useAutoPan(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let done = false;
    const stop = () => { if (frame) cancelAnimationFrame(frame); frame = 0; };
    const cancel = () => { done = true; stop(); };
    const events = ["touchstart", "pointerdown", "wheel", "keydown"] as const;
    events.forEach((e) => el.addEventListener(e, cancel, { passive: true }));

    const pan = () => {
      const distance = el.scrollWidth - el.clientWidth;
      if (done || distance < 24) return;
      done = true;
      const from = el.scrollLeft;
      const ms = Math.min(7000, Math.max(2500, distance * 5));
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / ms);
        el.scrollLeft = from + distance * (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);   // ease in-out
        frame = p < 1 ? requestAnimationFrame(tick) : 0;
      };
      frame = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting && e.intersectionRatio >= 0.5)) { pan(); io.disconnect(); }
    }, { threshold: [0.5] });
    io.observe(el);
    return () => { io.disconnect(); stop(); events.forEach((e) => el.removeEventListener(e, cancel)); };
  }, [ref]);
}
