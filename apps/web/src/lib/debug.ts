import { options, type VNode } from 'preact';

/**
 * Dev only: count how many times each component renders, in window.__renders.
 * Reset with window.__resetRenders(). Never part of a production build.
 */
export function countRenders(): void {
  const counts: Record<string, number> = {};
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const previous = options.diffed;
  options.diffed = (vnode: VNode) => {
    if (typeof vnode.type === 'function') {
      const name = vnode.type.displayName ?? vnode.type.name;
      counts[name] = (counts[name] ?? 0) + 1;
    }
    previous?.(vnode);
  };
  const w = window as unknown as Record<string, unknown>;
  w['__renders'] = counts;
  w['__resetRenders'] = () => {
    for (const k of Object.keys(counts)) counts[k] = 0;
  };
}
