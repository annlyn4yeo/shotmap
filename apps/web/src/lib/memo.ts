import { h, type Component, type FunctionComponent, type RenderableProps } from 'preact';

const same = (a: object, b: object): boolean => {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return (
    keys.length === Object.keys(y).length && keys.every((k) => Object.is(x[k], y[k]))
  );
};

/**
 * Skip re-rendering a component whose props are all unchanged (compared one
 * level deep, with Object.is). A few lines of our own instead of preact/compat.
 */
export function memo<P extends object>(
  Inner: FunctionComponent<P>,
): FunctionComponent<P> {
  function Memoed(this: Component<P>, props: RenderableProps<P>) {
    this.shouldComponentUpdate = (next: P) => !same(this.props, next);
    return h(Inner, props);
  }
  Memoed.displayName = Inner.displayName ?? Inner.name;
  return Memoed;
}
