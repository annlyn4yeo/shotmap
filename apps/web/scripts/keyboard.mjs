// A keyboard-only run of the canvas tier (DESIGN.md section 9, risk R8): a career too big for SVG,
// reached, read, filtered and opened with Tab, the arrow keys, Enter, Space and Escape, and never
// a pointer. Every claim the design makes about the hidden list is checked here:
//   one tab stop for the whole list, roving focus, the true position and size said, a ring drawn
//   on the map for the shot in focus, a live region that says what opens, the card, the filter,
//   the density view and its list. The last part is the comparison (section 10): both players
//   chosen in the search sheet and the figures and maps read. Exits 1 on any miss.
// Run `pnpm build` first (or set BASE_URL to a running dev server), and have a Worker for /v1.
import { existsSync } from 'node:fs';
import * as chromeLauncher from 'chrome-launcher';
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';

const PORT = 4175;
const PLAYER = process.env.KEYBOARD_PLAYER ?? '5503'; // Lionel Messi: 2,663 open-play shots
const BASE = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;

if (!process.env.BASE_URL && !existsSync('dist/index.html')) {
  console.error('dist/ is missing: run `pnpm build` first (or set BASE_URL).');
  process.exit(1);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = process.env.BASE_URL
  ? null
  : await preview({
      logLevel: 'error',
      preview: { port: PORT, strictPort: true, host: '127.0.0.1', open: false },
    });
const chrome = await chromeLauncher.launch({
  chromeFlags: ['--headless=new', '--no-sandbox', '--window-size=1280,1000'],
});
const browser = await puppeteer.connect({
  browserURL: `http://127.0.0.1:${chrome.port}`,
  defaultViewport: null,
});

try {
  const page = await browser.newPage();
  // A desktop window: a keyboard user's, with no touch and no mouse.
  await page.setViewport({ width: 1280, height: 900 });
  const problems = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });

  /** What has keyboard focus, and where it is in the hidden list. */
  const focus = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      const item = el?.closest('.proxy li');
      const list = el?.closest('.proxy');
      return {
        tag: el?.tagName ?? '',
        text: (el?.textContent ?? '').trim().slice(0, 120),
        inList: Boolean(list),
        posinset: item ? Number(item.getAttribute('aria-posinset')) : null,
        setsize: item ? Number(item.getAttribute('aria-setsize')) : null,
        tabindex: el?.getAttribute('tabindex') ?? null,
        pressed: el?.getAttribute('aria-pressed') ?? null,
        cls: el?.className?.toString?.() ?? '',
        name: el?.getAttribute('aria-label') ?? '',
      };
    });
  const press = async (key, times = 1) => {
    for (let i = 0; i < times; i++) {
      if (key === 'Shift+Tab') {
        await page.keyboard.down('Shift');
        await page.keyboard.press('Tab');
        await page.keyboard.up('Shift');
      } else await page.keyboard.press(key);
    }
    await sleep(120);
  };
  const live = () =>
    page.evaluate(
      () => document.querySelector('.map [role="status"]')?.textContent ?? '',
    );
  const url = () => page.evaluate(() => location.pathname + location.search);
  const ring = () =>
    page.evaluate(() => {
      const r = document.querySelector(
        '.shot-overlay .ring[data-kind="active"], .density-layer .bin-ring[data-kind="active"]',
      );
      return r
        ? {
            x: r.getAttribute('cx') ?? r.getAttribute('x'),
            y: r.getAttribute('cy') ?? r.getAttribute('y'),
          }
        : null;
    });
  const scrollY = () => page.evaluate(() => Math.round(scrollY));

  await page.goto(`${BASE}/players/${PLAYER}`, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.proxy');
  await sleep(300);

  // 1. The list is one tab stop, reached by Tab alone.
  let first = null;
  let stops = 0;
  for (let i = 0; i < 120 && !first; i++) {
    await page.keyboard.press('Tab');
    stops++;
    const f = await focus();
    if (f.inList) first = f;
  }
  check(
    'Tab reaches the shot list from the top of the page',
    first !== null,
    `after ${stops} Tabs`,
  );
  check(
    'it lands on the first shot, which is the one tab stop',
    first?.posinset === 1 && first?.tabindex === '0',
    `item ${first?.posinset} of ${first?.setsize}`,
  );
  const onScreen = () =>
    page.evaluate(() => {
      const r = document
        .querySelector(
          '.shot-overlay .ring[data-kind="active"], .density-layer .bin-ring[data-kind="over"]',
        )
        ?.getBoundingClientRect();
      // A ring with no size is not on screen: it is what a map with no size gives.
      return r
        ? r.width > 4 &&
            r.height > 4 &&
            r.top >= 0 &&
            r.bottom <= innerHeight &&
            r.left >= 0 &&
            r.right <= innerWidth
        : false;
    });
  const mapBox = await page.evaluate(() => {
    const b = document.querySelector('.map-frame')?.getBoundingClientRect();
    return b ? [Math.round(b.width), Math.round(b.height)] : null;
  });
  check(
    'on a laptop-wide window the map has a size (it had none from 52rem up)',
    mapBox !== null && mapBox[0] > 300 && mapBox[1] > 150,
    JSON.stringify(mapBox),
  );
  check(
    'the shot in focus is on screen as soon as Tab enters the list (the map is scrolled into view)',
    await onScreen(),
  );
  const size = first?.setsize ?? 0;
  check(
    'the list says how many shots there are, not how many are in the page',
    size > 300,
    `${size}`,
  );
  const named = await page.evaluate(() => {
    const list = document.querySelector('.proxy');
    const text =
      document.getElementById(list?.getAttribute('aria-describedby') ?? '')
        ?.textContent ?? '';
    return {
      label: list?.getAttribute('aria-label'),
      text,
      isList: list?.tagName === 'OL',
    };
  });
  check(
    'it is an ordered list with a name and a description in words',
    named.isList && Boolean(named.label) && named.text.length > 60,
    named.label ?? '',
  );
  check(
    'the map is hidden from assistive technology: the canvases are aria-hidden',
    await page.evaluate(
      () =>
        document.querySelector('.shot-canvases')?.getAttribute('aria-hidden') ===
          'true' && document.querySelectorAll('.shot-canvases canvas').length === 5,
    ),
  );
  const inPage = await page.evaluate(() => document.querySelectorAll('.proxy li').length);
  check(
    'only the shots near focus are in the page, never thousands of buttons',
    inPage <= 81,
    `${inPage} of ${size}`,
  );

  // 2. Roving focus: the arrow keys, the page keys, the ends.
  const y0 = await scrollY();
  await press('ArrowRight', 3);
  let f = await focus();
  check(
    'ArrowRight moves one shot at a time',
    f.posinset === 4 && f.inList,
    `item ${f.posinset}`,
  );
  const r1 = await ring();
  check('the shot in focus is ringed on the map', r1 !== null);
  await press('ArrowDown');
  await press('ArrowLeft');
  f = await focus();
  check(
    'ArrowDown goes on and ArrowLeft goes back',
    f.posinset === 4,
    `item ${f.posinset}`,
  );
  await press('PageDown');
  f = await focus();
  check('Page Down jumps ten', f.posinset === 14, `item ${f.posinset}`);
  await press('PageUp');
  f = await focus();
  check('Page Up jumps back ten', f.posinset === 4, `item ${f.posinset}`);
  await press('End');
  f = await focus();
  check(
    'End goes to the last shot, with focus kept in the list',
    f.posinset === size && f.inList,
    `item ${f.posinset}`,
  );
  await press('ArrowRight');
  f = await focus();
  check('past the last shot it stays on the last', f.posinset === size);
  const afterEnd = await page.evaluate(
    () => document.querySelectorAll('.proxy li').length,
  );
  check(
    'the window follows focus and stays small',
    afterEnd <= 81,
    `${afterEnd} in the page`,
  );
  await press('Home');
  f = await focus();
  check(
    'Home goes back to the first',
    f.posinset === 1 && f.inList,
    `item ${f.posinset}`,
  );
  await press('PageUp');
  f = await focus();
  check('before the first it stays on the first', f.posinset === 1);
  check(
    'moving focus does not scroll the page',
    (await scrollY()) === y0,
    `${y0} to ${await scrollY()}`,
  );

  // 3. Open a shot and close it.
  await press('ArrowRight', 6);
  const before = await focus();
  await press('Enter');
  f = await focus();
  check(
    'Enter opens the shot and focus stays where it was',
    f.posinset === before.posinset && f.pressed === 'true',
  );
  check(
    'the shot is in the address, so it can be shared',
    /[?&]shot=\d{4,10}/.test(await url()),
    await url(),
  );
  await page.waitForSelector('.card');
  const card = await page.evaluate(() => ({
    label: document.querySelector('.card')?.getAttribute('aria-label'),
    live: document.querySelector('.card')?.getAttribute('aria-live'),
  }));
  check(
    'the card opens, and does not announce itself a second time',
    card.label === 'Shot details' && card.live === null,
    JSON.stringify(card),
  );
  const entrance = await page.evaluate(
    () => getComputedStyle(document.querySelector('.card')).animationName,
  );
  check(
    'opened with a key, the card has no entrance animation (keyboard actions do not animate)',
    entrance === 'none',
    entrance,
  );
  const said = await live();
  check(
    'a live region says which shot opened',
    /Shot details are open/.test(said) && said.length > 40,
    said.slice(0, 90),
  );
  await press('Escape');
  f = await focus();
  check(
    'Escape closes it and keeps focus on the shot',
    !(await url()).includes('shot=') && f.inList && f.posinset === before.posinset,
  );
  check('the card is gone', (await page.$('.card')) === null);
  await press('Space');
  check('Space opens it too', (await url()).includes('shot='));
  await press('Space');
  check('and closes it again', !(await url()).includes('shot='));

  // 4. One tab stop: Tab leaves the list, Shift+Tab comes back to the same shot.
  await press('Tab');
  f = await focus();
  check('Tab leaves the list: it is one tab stop, not thousands', !f.inList, f.cls);
  await press('Shift+Tab');
  f = await focus();
  check(
    'Shift+Tab comes back to the shot last reached',
    f.inList && f.posinset === before.posinset,
    `item ${f.posinset}`,
  );

  // 5. The legend filters the list as well as the map.
  let onChip = false;
  for (let i = 0; i < 12 && !onChip; i++) {
    await press('Tab');
    onChip = (await focus()).cls.includes('chip');
  }
  check('Tab reaches the outcome chips', onChip);
  const chipName = await page.evaluate(() => document.activeElement?.textContent ?? '');
  await press('Space');
  const hiddenUrl = await url();
  await sleep(300);
  const smaller = await page.evaluate(() =>
    Number(document.querySelector('.proxy li')?.getAttribute('aria-setsize')),
  );
  check(
    `Space on "${chipName.trim().slice(0, 12)}" hides it, and the list shrinks to match`,
    hiddenUrl.includes('hide=') && smaller < size,
    `${size} to ${smaller}`,
  );
  await press('Space');
  await sleep(300);
  const back = await page.evaluate(() =>
    Number(document.querySelector('.proxy li')?.getAttribute('aria-setsize')),
  );
  check('Space again brings them back', back === size, `${back}`);

  // 6. The density view, by keyboard, and its own list.
  let onSwitch = false;
  for (let i = 0; i < 40 && !onSwitch; i++) {
    await press('Shift+Tab');
    const g = await focus();
    onSwitch =
      g.tag === 'BUTTON' &&
      (await page.evaluate(() =>
        Boolean(document.activeElement?.closest('.player-view')),
      )) &&
      g.pressed === 'false';
  }
  check('Shift+Tab reaches the Density switch', onSwitch);
  await press('Enter');
  check(
    'Enter shows the density view',
    (await url()).includes('view=density') &&
      (await page.$('.map[data-layer="density"]')) !== null,
    await url(),
  );
  const six = await page.evaluate(
    () => document.querySelectorAll('.density path').length,
  );
  check(
    'the squares are a handful of elements, not hundreds',
    six > 0 && six <= 6,
    `${six} paths`,
  );
  let inBins = null;
  for (let i = 0; i < 40 && !inBins; i++) {
    await press('Tab');
    const g = await focus();
    if (g.inList) inBins = g;
  }
  check(
    'Tab reaches the list of squares, busiest first',
    inBins?.posinset === 1 && /yards out/.test(inBins?.text ?? ''),
    inBins?.text.slice(0, 80),
  );
  await press('ArrowRight', 2);
  check(
    'the arrow keys move along the squares and ring the one in focus',
    (await focus()).posinset === 3 && (await ring()) !== null,
  );
  await press('Enter');
  await page.waitForSelector('.card');
  const binSaid = await live();
  check(
    'Enter opens a square: its card and its live announcement',
    /of the shots shown/.test(binSaid) && (await url()).includes('bin='),
    binSaid.slice(0, 100),
  );
  await press('Escape');
  check(
    'Escape closes it',
    (await page.$('.card')) === null && !(await url()).includes('bin='),
  );

  // 7. On a phone: the same Tab, and the shot in focus must be on screen where the map is short of room.
  // (A phone's map starts low in the page, and the list's button is a pixel in the map's corner:
  // scrolling to the button alone leaves the map, and the ring, below the screen.)
  const phone = await browser.newPage();
  await phone.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  await phone.goto(`${BASE}/players/${PLAYER}`, { waitUntil: 'networkidle0' });
  await phone.waitForSelector('.proxy');
  let inList = false;
  for (let i = 0; i < 120 && !inList; i++) {
    await phone.keyboard.press('Tab');
    inList = await phone.evaluate(() =>
      Boolean(document.activeElement?.closest('.proxy')),
    );
  }
  await sleep(300);
  const phoneRing = await phone.evaluate(() => {
    const r = document
      .querySelector('.shot-overlay .ring[data-kind="active"]')
      ?.getBoundingClientRect();
    const map = document.querySelector('.map-frame')?.getBoundingClientRect();
    return {
      inList: Boolean(r),
      ring: r && [Math.round(r.top), Math.round(r.bottom)],
      map: map && [Math.round(map.top), Math.round(map.bottom)],
      vh: innerHeight,
    };
  });
  check(
    'on a phone, Tab into the list shows the whole map and the ring on screen',
    inList &&
      phoneRing.ring !== null &&
      phoneRing.map !== null &&
      phoneRing.map[0] >= 0 &&
      phoneRing.map[1] <= phoneRing.vh,
    JSON.stringify(phoneRing),
  );
  await phone.close();

  // 8. The comparison (DESIGN.md section 10): both players chosen in the search sheet and the maps
  // read, with the keyboard alone. Every choice goes through the same sheet, which must hand focus
  // back to the button that opened it and must not offer the player already on the other side.
  const compare = await browser.newPage();
  await compare.setViewport({ width: 1280, height: 900 });
  compare.on('pageerror', (e) => problems.push(String(e)));
  compare.on('console', (m) => {
    if (m.type() === 'error') problems.push(m.text());
  });
  const here = () =>
    compare.evaluate(() => {
      const el = document.activeElement;
      return {
        tag: el?.tagName ?? '',
        text: (el?.textContent ?? '').trim(),
        inList: Boolean(el?.closest('.proxy')),
        posinset: Number(el?.closest('.proxy li')?.getAttribute('aria-posinset')) || null,
        inSheet: Boolean(el?.closest('dialog.picker[open]')),
      };
    });
  const key = async (name, times = 1) => {
    for (let i = 0; i < times; i++) {
      if (name === 'Shift+Tab') {
        await compare.keyboard.down('Shift');
        await compare.keyboard.press('Tab');
        await compare.keyboard.up('Shift');
      } else await compare.keyboard.press(name);
    }
    await sleep(120);
  };
  /** Tab (or Shift+Tab) until focus is on something that says this, up to `limit` times. */
  const reach = async (says, { back = false, limit = 30 } = {}) => {
    for (let i = 0; i < limit; i++) {
      await key(back ? 'Shift+Tab' : 'Tab');
      if (says((await here()).text, await here())) return true;
    }
    return false;
  };
  const sheet = () =>
    compare.evaluate(() => {
      const d = document.querySelector('dialog.picker');
      return {
        open: Boolean(d?.open),
        label: d?.getAttribute('aria-label') ?? '',
        groups: [...(d?.querySelectorAll('.picker-group-title') ?? [])].map(
          (e) => e.textContent,
        ),
        options: [...(d?.querySelectorAll('[role="option"]') ?? [])].map(
          (e) => e.textContent,
        ),
        browse: /Browse every match/.test(d?.textContent ?? ''),
        empty: d?.querySelector('.picker-empty-title')?.textContent ?? '',
      };
    });
  const choose = async (words) => {
    await compare.keyboard.type(words);
    await compare
      .waitForSelector(
        'dialog.picker [role="option"], dialog.picker .picker-empty-title',
        {
          timeout: 5000,
        },
      )
      .catch(() => undefined);
    await sleep(200);
  };

  await compare.goto(`${BASE}/compare`, { waitUntil: 'networkidle0' });
  await compare.waitForSelector('.slot');
  check(
    'with nobody chosen the comparison is two slots and a sentence',
    (await compare.evaluate(
      () =>
        document.querySelectorAll('.slot').length === 2 &&
        !document.querySelector('.versus-table'),
    )) &&
      /Choose two players/.test(await compare.evaluate(() => document.body.innerText)),
  );
  check(
    'Tab reaches the button that chooses Player A',
    await reach((t) => /Choose a player.*Player A/.test(t)),
  );
  await key('Enter');
  let s = await sheet();
  f = await here();
  check(
    'Enter opens the search sheet, asking for a player, with focus in its field',
    s.open && s.label === 'Choose a player' && f.inSheet && f.tag === 'INPUT',
    s.label,
  );
  await choose('messi');
  s = await sheet();
  check(
    'it lists players only: no teams, no matches, no way to browse everything',
    s.groups.join() === 'Players' && s.options.length >= 1 && !s.browse,
    s.options.join(', '),
  );
  await key('Enter');
  s = await sheet();
  f = await here();
  check(
    'Enter chooses the first, closes the sheet and puts it in the address',
    !s.open &&
      /[?&]a=\d+/.test(await compare.evaluate(() => location.search)) &&
      (await compare.evaluate(() => location.pathname)) === '/compare',
  );
  check(
    'focus goes back to the button that asked, which now says Change',
    /Change.*Player A/.test(f.text),
    f.text,
  );
  check(
    'the page stays in place while the player loads (nothing is swapped for a loading block)',
    (await compare.$('.compare-wait')) === null,
  );

  check(
    'Tab reaches the button that chooses Player B',
    await reach((t) => /Choose a player.*Player B/.test(t)),
  );
  await key('Enter');
  await choose('messi');
  s = await sheet();
  check(
    'the player on the other side is not offered again: Messi is not on the list',
    s.options.length === 0 && /Nothing for/.test(s.empty),
    s.empty,
  );
  // As in any search box, the first Escape clears what was typed and the next closes the sheet.
  await key('Escape');
  const cleared = await compare.evaluate(
    () => document.querySelector('dialog.picker .picker-input')?.value === '',
  );
  s = await sheet();
  if (s.open) await key('Escape');
  s = await sheet();
  f = await here();
  check(
    'Escape clears the field, then closes the sheet, changes nothing and returns focus to the button',
    cleared &&
      !s.open &&
      !/[?&]b=/.test(await compare.evaluate(() => location.search)) &&
      /Choose a player.*Player B/.test(f.text),
    f.text,
  );
  await key('Enter');
  await choose('ronaldo');
  await key('Enter');
  await compare.waitForSelector('.versus-table tbody tr', { timeout: 8000 });
  await compare.waitForFunction(
    () => document.querySelectorAll('.density path').length > 0,
    { timeout: 8000 },
  );
  f = await here();
  check(
    'both are chosen, in the address, and focus is back on Change for Player B',
    /[?&]a=\d+/.test(await compare.evaluate(() => location.search)) &&
      /[?&]b=\d+/.test(await compare.evaluate(() => location.search)) &&
      /Change.*Player B/.test(f.text),
    f.text,
  );

  const table = await compare.evaluate(() => {
    const rows = [...document.querySelectorAll('.versus-table tbody tr')];
    return {
      rows: rows.length,
      leads: rows.map((r) => r.querySelectorAll('[data-lead="true"]').length),
      spoken: rows.map((r) => (r.textContent ?? '').includes('(higher)')),
      unranked: rows[0]?.querySelector('th')?.textContent,
      caption: document.querySelector('.versus-table caption')?.textContent ?? '',
      headers: [...document.querySelectorAll('.versus-table thead th')].length,
    };
  });
  check(
    'the figures are a table: ten rows under named columns, with a caption',
    table.rows === 10 && table.headers === 3 && table.caption.length > 40,
    `${table.rows} rows`,
  );
  check(
    'at most one figure leads each row, the lead is said aloud, and Matches has none',
    table.leads.every((n) => n <= 1) &&
      table.leads.every((n, i) => (n === 1) === table.spoken[i]) &&
      table.leads[0] === 0 &&
      table.unranked === 'Matches',
    table.leads.join(''),
  );

  const scale = await compare.evaluate(() => ({
    maps: document.querySelectorAll('.compare-map').length,
    legends: document.querySelectorAll('.density-key').length,
    note: Boolean(document.querySelector('.compare-key .map-note')),
  }));
  check(
    'two maps share one key, which says so',
    scale.maps === 2 && scale.legends === 1 && scale.note,
    JSON.stringify(scale),
  );

  const before2 = await compare.evaluate(() => history.length);
  check(
    'Tab reaches the span control',
    await reach((_text, g) => g.tag === 'SELECT', { limit: 8 }),
  );
  await key('ArrowDown');
  await sleep(600);
  const spanUrl = await compare.evaluate(() => location.search);
  check(
    'a key on the span control sets one season for both, replacing the history entry',
    /[?&]competition=\d+&season=\d+/.test(spanUrl) &&
      (await compare.evaluate(() => history.length)) === before2,
    spanUrl,
  );

  let inMap = null;
  for (let i = 0; i < 12 && !inMap; i++) {
    await key('Tab');
    const g = await here();
    if (g.inList) inMap = g;
  }
  check(
    'Tab reaches the first map’s list of squares, busiest first',
    inMap?.posinset === 1 && /yards out/.test(inMap?.text ?? ''),
    inMap?.text.slice(0, 80),
  );
  const mapOnScreen = await compare.evaluate(() => {
    const b = document.querySelector('.compare-map .map-frame')?.getBoundingClientRect();
    return b ? b.top >= 0 && b.bottom <= innerHeight && b.width > 200 : false;
  });
  check('and the whole map is on screen with it', mapOnScreen);
  await key('ArrowRight', 2);
  f = await here();
  check('the arrow keys move along the squares', f.posinset === 3, `${f.posinset}`);
  await key('Enter');
  await compare.waitForSelector('.compare-map .card');
  const squareSaid = await compare.evaluate(
    () => document.querySelector('.compare-map [role="status"]')?.textContent ?? '',
  );
  check(
    'Enter opens a square, and a live region says so',
    /of the shots shown/.test(squareSaid),
    squareSaid.slice(0, 90),
  );
  await key('Escape');
  f = await here();
  check(
    'Escape closes it and keeps focus on the square',
    (await compare.$('.compare-map .card')) === null && f.inList && f.posinset === 3,
  );
  await compare.close();

  check(
    'no errors in the console',
    problems.length === 0,
    problems.join(' | ').slice(0, 200),
  );
  await page.close();
} finally {
  await browser.disconnect();
  await chrome.kill();
  await server?.close();
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks pass, with the keyboard alone.`,
);
process.exit(failed.length ? 1 : 0);
