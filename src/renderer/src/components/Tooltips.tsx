import { useEffect, useRef, useState } from "react";

/** How long the first tooltip waits. */
const DELAY = 500;
/** After a tooltip closes, the next one within this long shows at once. */
const WARM = 400;

type Tip = { text: string; x: number; y: number; below: boolean };

/**
 * Tooltips for everything with a `title`, shown as a group: the first one
 * waits a moment, then moving along a row of buttons shows each at once.
 * The native tooltip is suppressed by moving `title` to `data-tip`.
 */
export function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastClosed = useRef(0);
  const current = useRef<HTMLElement | null>(null);
  const shown = useRef(false);

  useEffect(() => {
    const textOf = (el: HTMLElement) => {
      const title = el.getAttribute("title");
      if (title) {
        el.dataset.tip = title;
        el.removeAttribute("title");
      }
      return el.dataset.tip ?? "";
    };

    const hide = () => {
      clearTimeout(timer.current);
      if (shown.current) lastClosed.current = Date.now();
      shown.current = false;
      current.current = null;
      setTip(null);
    };

    const show = (el: HTMLElement) => {
      const text = textOf(el);
      if (!text) return;
      const r = el.getBoundingClientRect();
      // Below the element unless that runs off the window.
      const below = r.bottom + 40 < window.innerHeight;
      shown.current = true;
      setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 6 : r.top - 6, below });
    };

    const over = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>("[title], [data-tip]");
      if (el === current.current) return;
      clearTimeout(timer.current);
      if (!el) return hide();
      const warm = shown.current || Date.now() - lastClosed.current < WARM;
      current.current = el;
      textOf(el);
      if (warm) show(el);
      else {
        shown.current = false;
        setTip(null);
        timer.current = setTimeout(() => current.current === el && show(el), DELAY);
      }
    };

    window.addEventListener("pointerover", over);
    window.addEventListener("pointerdown", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("pointerover", over);
      window.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      clearTimeout(timer.current);
    };
  }, []);

  if (!tip) return null;
  // Keep it on screen: clamp the centre so a 240px-wide tip never overflows.
  const x = Math.min(Math.max(tip.x, 120), window.innerWidth - 120);
  return (
    <div className={`tooltip${tip.below ? "" : " above"}`} role="tooltip" style={{ left: x, top: tip.y }}>
      {tip.text}
    </div>
  );
}
