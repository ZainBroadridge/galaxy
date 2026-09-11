import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Execute the actual measurement hook with DOM/font boundaries as fixtures.
async function mount(widths, { fonts = true, observer = true } = {}) {
  const source = await readFile(new URL('../../web/src/investor/useBallotColumns.js', import.meta.url), 'utf8');
  const writes = []; const listeners = new Map(); const observed = [];
  let effect; let disconnected = false; let fontReady; let notifyResize;
  const labels = widths.map((width) => ({ width, parentElement: {}, getBoundingClientRect() { return { width: this.width }; } }));
  const table = { querySelectorAll: () => labels, style: { setProperty: (name, value) => writes.push([name, value]) } };
  const context = {
    useRef: () => ({ current: table }), useLayoutEffect: (callback) => { effect = callback; },
    window: {
      getComputedStyle: () => ({ paddingLeft: '12px', paddingRight: '12px' }),
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name, callback) => { assert.equal(listeners.get(name), callback); listeners.delete(name); },
    },
    document: fonts ? { fonts: { ready: new Promise((resolve) => { fontReady = resolve; }) } } : {},
  };
  if (observer) context.ResizeObserver = class {
    constructor(callback) { notifyResize = callback; }
    observe(label) { observed.push(label); }
    disconnect() { disconnected = true; }
  };
  const hook = vm.runInNewContext(source.replace(/^import[^\n]+\n/u, '').replace('export function', 'function') + '\nuseBallotColumns;', context);
  const ref = hook([]); const cleanup = effect();
  return { labels, writes, listeners, observed, ref, table, cleanup, fontReady, notifyResize, disconnected: () => disconnected };
}

test('all columns use the widest full option plus its padding, rounded up', async () => {
  const fixture = await mount([45, 132.4, 76, 101]);
  assert.equal(fixture.ref.current, fixture.table);
  assert.deepEqual(fixture.writes, [['--ballot-option-width', '157px']]);
  assert.equal(fixture.observed.length, 4);
  fixture.labels[0].width = 285;
  fixture.notifyResize();
  assert.deepEqual(fixture.writes.at(-1), ['--ballot-option-width', '309px']);
  fixture.cleanup();
});

test('font loading and viewport changes resize the shared columns without stale updates after unmount', async () => {
  const fixture = await mount([90, 110]);
  assert.equal(fixture.writes.at(-1)[1], '144px');
  fixture.labels[1].width = 150;
  fixture.fontReady(); await Promise.resolve();
  assert.equal(fixture.writes.at(-1)[1], '174px');
  fixture.labels[1].width = 120;
  fixture.listeners.get('resize')();
  assert.equal(fixture.writes.at(-1)[1], '144px');
  fixture.cleanup();
  const count = fixture.writes.length;
  fixture.notifyResize();
  assert.equal(fixture.writes.length, count);
  assert.equal(fixture.listeners.size, 0);
  assert.equal(fixture.disconnected(), true);
});

test('measurement also works without optional font and resize-observer APIs', async () => {
  const fixture = await mount([190], { fonts: false, observer: false });
  assert.equal(fixture.writes.at(-1)[1], '214px');
  fixture.cleanup();
});
