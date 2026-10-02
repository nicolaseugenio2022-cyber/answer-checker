// Verifies the timing of loading skeletons (loading-gate.ts) and the
// development-only artificial loading time. Timers and the clock are fakes,
// so every case runs instantly and exactly.
// Run with: npm run test:db
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  getArtificialLoadingMs,
  setArtificialLoading,
  subscribeToArtificialLoading,
} from '../../src/core/presentation/lib/artificial-loading.ts';
import {
  SKELETON_DELAY_MS,
  SKELETON_MIN_VISIBLE_MS,
  createLoadingGate,
} from '../../src/core/presentation/lib/loading-gate.ts';

/** A clock that moves only when told to, with the timers that hang on it. */
function fakeTime() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer: (callback, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    pending: () => timers.size,
    /** Moves time forward, firing every timer that comes due, in order. */
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = end;
    },
  };
}

function gateWith(time, { loading = true, artificial = 0 } = {}) {
  const gate = createLoadingGate(loading, {
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    artificialMs: () => artificial,
  });
  const phases = [gate.getPhase()];
  gate.subscribe(() => phases.push(gate.getPhase()));
  gate.setLoading(loading);
  return { gate, phases };
}

describe('loading skeleton timing', () => {
  it('uses about 150 ms before showing a skeleton and keeps it briefly once shown', () => {
    assert.equal(SKELETON_DELAY_MS, 150);
    assert.ok(SKELETON_MIN_VISIBLE_MS >= 250 && SKELETON_MIN_VISIBLE_MS <= 500);
  });

  it('shows no skeleton at all for a fast read', () => {
    const time = fakeTime();
    const { gate, phases } = gateWith(time);
    time.advance(20);
    gate.setLoading(false);
    time.advance(1000);
    assert.deepEqual(phases, ['hidden', 'content']);
    assert.equal(time.pending(), 0);
  });

  it('shows nothing just before the delay, and the skeleton at it', () => {
    const time = fakeTime();
    const { gate } = gateWith(time);
    time.advance(SKELETON_DELAY_MS - 1);
    assert.equal(gate.getPhase(), 'hidden');
    time.advance(1);
    assert.equal(gate.getPhase(), 'skeleton');
  });

  it('keeps a skeleton that appeared on screen for its minimum time, so it does not flicker', () => {
    const time = fakeTime();
    const { gate, phases } = gateWith(time);
    time.advance(SKELETON_DELAY_MS);
    // The data arrives 10 ms after the skeleton appeared.
    time.advance(10);
    gate.setLoading(false);
    assert.equal(gate.getPhase(), 'skeleton');
    time.advance(SKELETON_MIN_VISIBLE_MS - 11);
    assert.equal(gate.getPhase(), 'skeleton');
    time.advance(1);
    assert.equal(gate.getPhase(), 'content');
    assert.deepEqual(phases, ['hidden', 'skeleton', 'content']);
  });

  it('goes to the content at once when a long read ends after the minimum time', () => {
    const time = fakeTime();
    const { gate } = gateWith(time);
    time.advance(3000);
    assert.equal(gate.getPhase(), 'skeleton');
    gate.setLoading(false);
    assert.equal(gate.getPhase(), 'content');
    assert.equal(time.pending(), 0);
  });

  it('starts with the content when nothing is loading', () => {
    const time = fakeTime();
    const { gate, phases } = gateWith(time, { loading: false });
    time.advance(1000);
    assert.deepEqual(phases, ['content']);
    assert.equal(gate.getPhase(), 'content');
  });

  it('handles loading again later: hidden, then skeleton only if slow', () => {
    const time = fakeTime();
    const { gate, phases } = gateWith(time, { loading: false });
    gate.setLoading(true);
    time.advance(50);
    gate.setLoading(false);
    gate.setLoading(true);
    time.advance(400);
    gate.setLoading(false);
    time.advance(1000);
    assert.deepEqual(phases, ['content', 'hidden', 'content', 'hidden', 'skeleton', 'content']);
  });

  it('ignores repeated reports of the same state', () => {
    const time = fakeTime();
    const { gate, phases } = gateWith(time);
    gate.setLoading(true);
    gate.setLoading(true);
    time.advance(SKELETON_DELAY_MS);
    gate.setLoading(true);
    assert.deepEqual(phases, ['hidden', 'skeleton']);
    assert.equal(time.pending(), 0);
  });

  it('stops its timers when the screen goes away', () => {
    const time = fakeTime();
    const { gate, phases } = gateWith(time);
    gate.dispose();
    time.advance(5000);
    assert.equal(time.pending(), 0);
    assert.deepEqual(phases, ['hidden']);
  });
});

describe('artificial loading time', () => {
  it('holds the skeleton for the chosen time even though the data arrived at once', () => {
    const time = fakeTime();
    const { gate, phases } = gateWith(time, { artificial: 2000 });
    time.advance(5);
    gate.setLoading(false);
    time.advance(SKELETON_DELAY_MS);
    assert.equal(gate.getPhase(), 'skeleton');
    time.advance(2000 - SKELETON_DELAY_MS - 6);
    assert.equal(gate.getPhase(), 'skeleton');
    time.advance(1);
    assert.equal(gate.getPhase(), 'content');
    assert.deepEqual(phases, ['hidden', 'skeleton', 'content']);
  });

  it('does not shorten a real load that is slower than it', () => {
    const time = fakeTime();
    const { gate } = gateWith(time, { artificial: 500 });
    time.advance(3000);
    assert.equal(gate.getPhase(), 'skeleton');
    gate.setLoading(false);
    assert.equal(gate.getPhase(), 'content');
  });

  it('can be turned on only in a development build, and is off by default', () => {
    assert.equal(getArtificialLoadingMs(), 0);
    setArtificialLoading(2000, false);
    assert.equal(getArtificialLoadingMs(), 0);

    const seen = [];
    const unsubscribe = subscribeToArtificialLoading(() => seen.push(getArtificialLoadingMs()));
    setArtificialLoading(2000, true);
    setArtificialLoading(2000, true);
    assert.equal(getArtificialLoadingMs(), 2000);
    // A release build cannot change it either way.
    setArtificialLoading(0, false);
    assert.equal(getArtificialLoadingMs(), 2000);
    // Nonsense is "off"; a huge value is capped.
    setArtificialLoading(60_000, true);
    assert.equal(getArtificialLoadingMs(), 10_000);
    setArtificialLoading(Number.NaN, true);
    assert.equal(getArtificialLoadingMs(), 0);
    unsubscribe();
    setArtificialLoading(-5, true);
    assert.deepEqual(seen, [2000, 10_000, 0]);
  });

  it('is only ever set from a control that a release build does not render', () => {
    const read = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');
    const section = read('features/settings/presentation/slow-loading-section.tsx');
    assert.match(section, /if \(!__DEV__\) return null;/);
    assert.match(section, /setArtificialLoading\(choice\.ms, __DEV__\)/);
    // No query, repository, or use case waits for it: only the gate reads it.
    const hook = read('core/presentation/hooks/use-loading-phase.ts');
    assert.match(hook, /artificialMs: getArtificialLoadingMs/);
  });
});

describe('skeletons across the app', () => {
  const read = (file) => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8');
  const SCREENS = [
    'core/presentation/components/name-list-screen.tsx',
    'features/students/presentation/students-screen.tsx',
    'features/answer-keys/presentation/answer-keys-screen.tsx',
    'features/scan/presentation/scan-screen.tsx',
    'features/results/presentation/results-screen.tsx',
    'features/results/presentation/result-detail-dialog.tsx',
    'features/dashboard/presentation/home-screen.tsx',
    'features/settings/presentation/settings-screen.tsx',
  ];

  it('every screen that loads uses the shared gate and skeleton, not its own spinner', () => {
    for (const file of SCREENS) {
      const source = read(file);
      assert.match(source, /useLoadingPhase\(/, file);
      assert.match(source, /components\/skeleton'/, file);
      assert.doesNotMatch(source, /<Text[^>]*>Loading[^<]*<\/Text>/, file);
    }
  });

  it('a skeleton speaks once as busy, hides its bars, and holds still under reduced motion', () => {
    const skeleton = read('core/presentation/components/skeleton.tsx');
    assert.match(skeleton, /accessibilityRole="progressbar"/);
    assert.match(skeleton, /aria-busy/);
    assert.match(skeleton, /importantForAccessibility="no-hide-descendants"/);
    assert.match(skeleton, /useReducedMotion\(\)/);
    assert.match(skeleton, /if \(reduceMotion\) \{\s*opacity\.set\(1\);/);
    // Theme tokens only: it reads on light, dark, and glass alike.
    assert.doesNotMatch(skeleton, /#[0-9a-fA-F]{3,6}\b|rgba?\(/);
  });

  it('a refresh keeps the content and shows the small indicator instead', () => {
    for (const file of SCREENS.slice(0, 3).concat('features/results/presentation/results-screen.tsx')) {
      assert.match(read(file), /refreshPhase=\{refreshPhase\}/, file);
    }
    assert.match(read('features/dashboard/presentation/home-screen.tsx'), /<RefreshIndicator phase=\{refreshPhase\} \/>/);
  });
});
