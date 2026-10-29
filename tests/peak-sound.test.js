const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app.js");

test("peakTickDue — one tick per second, only in the last 20 seconds, never at zero", () => {
  const a = loadApp();
  try {
    assert.equal(a.peakTickDue(60, 0), null);
    assert.equal(a.peakTickDue(20.4, 0), null); // 21 s left: not yet
    assert.equal(a.peakTickDue(19.6, 0), 20);
    assert.equal(a.peakTickDue(19.2, 20), null); // the same second again
    assert.equal(a.peakTickDue(18.9, 20), 19);
    assert.equal(a.peakTickDue(0.4, 2), 1); // the last second ticks once
    assert.equal(a.peakTickDue(0, 1), null); // time is up: no tick
  } finally { a.close(); }
});

test("sound is on by default, the mute choice is remembered, and nothing throws without Web Audio", () => {
  const a = loadApp();
  try {
    assert.equal(a.peakSoundOn(), true);
    a.peakSetSound(false);
    assert.equal(a.peakSoundOn(), false);
    a.peakSetSound(true);
    assert.equal(a.peakSoundOn(), true);
    // jsdom has no AudioContext: every cue must quietly do nothing
    for (const c of ["final", "correct", "wrong", "lifeline", "tick", "win", "violation"]) a.peakSfx(c);
    a.peakTension(true);
    a.peakTension(false);
  } finally { a.close(); }
});
