import { describe, expect, it } from 'vitest';
import { PROXY_PAGE, PROXY_RADIUS, moveFor, windowAround } from './ShotProxy';

describe('the slice of a long list that is kept in the page', () => {
  const size = 2 * PROXY_RADIUS + 1;

  it('is a full window round the item with focus', () => {
    expect(windowAround(5000, 2000)).toEqual({
      start: 2000 - PROXY_RADIUS,
      end: 2000 + PROXY_RADIUS + 1,
    });
  });

  it('keeps a full window beside either end of the list, and never reads past it', () => {
    expect(windowAround(5000, 0)).toEqual({ start: 0, end: size });
    expect(windowAround(5000, 3)).toEqual({ start: 0, end: size });
    expect(windowAround(5000, 4999)).toEqual({ start: 5000 - size, end: 5000 });
    expect(windowAround(5000, 4995)).toEqual({ start: 5000 - size, end: 5000 });
  });

  it('is the whole list when the list is short, and nothing for none', () => {
    expect(windowAround(5, 3)).toEqual({ start: 0, end: 5 });
    expect(windowAround(1, 0)).toEqual({ start: 0, end: 1 });
    expect(windowAround(0, 0)).toEqual({ start: 0, end: 0 });
  });

  it('always holds the item at its centre, so one page jump stays in the page', () => {
    expect(PROXY_RADIUS).toBeGreaterThan(PROXY_PAGE);
    for (const at of [0, 1, 7, 100, 2500, 4989, 4999]) {
      const { start, end } = windowAround(5000, at);
      expect(start <= at && at < end, `at ${at}`).toBe(true);
      expect(end - start).toBe(size);
    }
    // From anywhere, ten on is inside the window drawn round where we are.
    const { start, end } = windowAround(5000, 2500);
    expect(2500 + PROXY_PAGE < end && 2500 - PROXY_PAGE >= start).toBe(true);
  });
});

describe('where a key takes the focus', () => {
  const at = (key: string, from = 50, count = 100) => moveFor(key, from, count);

  it('moves one with the arrow keys, either way, and stops at the ends', () => {
    expect(at('ArrowRight')).toBe(51);
    expect(at('ArrowDown')).toBe(51);
    expect(at('ArrowLeft')).toBe(49);
    expect(at('ArrowUp')).toBe(49);
    expect(at('ArrowRight', 99)).toBe(99);
    expect(at('ArrowLeft', 0)).toBe(0);
  });

  it('jumps ten with the page keys and stops at the ends', () => {
    expect(at('PageDown')).toBe(60);
    expect(at('PageUp')).toBe(40);
    expect(at('PageDown', 95)).toBe(99);
    expect(at('PageUp', 4)).toBe(0);
  });

  it('goes to the first and the last with Home and End', () => {
    expect(at('Home')).toBe(0);
    expect(at('End')).toBe(99);
    expect(at('End', 50, 1)).toBe(0);
  });

  it('leaves every other key alone, so Tab, Enter, Space and letters work as they do', () => {
    for (const key of ['Tab', 'Enter', ' ', 'Escape', 'a', 'Shift', 'F5', 'ArrowRightX'])
      expect(at(key), key).toBeNull();
  });
});
