import { useLayoutEffect, useRef } from 'preact/hooks';

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  /** Always show a sign: +0.24, −0.40. */
  signed?: boolean;
}

const format = (v: number, decimals: number, signed: boolean) => {
  const text = Math.abs(v).toFixed(decimals);
  const zero = Number(text) === 0;
  if (!signed) return v < 0 && !zero ? `−${text}` : text;
  return `${v < 0 && !zero ? '−' : '+'}${text}`;
};

const DURATION = 420;

/**
 * A number that counts to its new value. It writes the text straight into the
 * element on each frame, so the component does not re-render while it runs, and
 * it only runs when the value changes after the first paint. Reduced motion:
 * it just changes.
 */
export function AnimatedNumber({
  value,
  decimals = 0,
  signed = false,
}: AnimatedNumberProps) {
  const el = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  const frame = useRef(0);

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const from = shown.current;
    cancelAnimationFrame(frame.current);

    const settle = () => {
      node.textContent = format(value, decimals, signed);
      shown.current = value;
    };
    if (
      from === null ||
      from === value ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      settle();
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION);
      const eased = 1 - (1 - t) ** 4; // ease-out quart
      const current = from + (value - from) * eased;
      node.textContent = format(current, decimals, signed);
      shown.current = current;
      if (t < 1) frame.current = requestAnimationFrame(step);
      else settle();
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value, decimals, signed]);

  return <span ref={el} class="num" />;
}
