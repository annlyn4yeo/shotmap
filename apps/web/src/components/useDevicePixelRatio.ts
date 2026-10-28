import { useEffect, useState } from 'preact/hooks';

/**
 * The device's pixels per CSS pixel, kept current: it changes when the page moves to another
 * screen or is zoomed, and a canvas has to be drawn again at the new density.
 */
export function useDevicePixelRatio(): number {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1);
  useEffect(() => {
    let list: MediaQueryList | undefined;
    const changed = () => {
      setRatio(window.devicePixelRatio || 1);
      watch();
    };
    // A media query for exactly the current ratio fires once, when the ratio stops being it.
    const watch = () => {
      list?.removeEventListener('change', changed);
      list = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      list.addEventListener('change', changed, { once: true });
    };
    watch();
    return () => list?.removeEventListener('change', changed);
  }, []);
  return ratio;
}
