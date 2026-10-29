const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app.js");

// jsdom has no Web Audio, so the game's own cue and bed code never runs in the other sound tests. This
// stand-in implements just enough of the API for the real code to run end to end and be counted.
function fakeAudio() {
  const log = { started: 0, stopped: 0, noise: 0 };
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  class Ctx {
    constructor() { this.currentTime = 0; this.sampleRate = 8000; this.state = "running"; this.destination = node(); }
    resume() {}
    createGain() { return { ...node(), gain: param() }; }
    createOscillator() { return { ...node(), frequency: param(), type: "", start() { log.started++; }, stop() { log.stopped++; } }; }
    createBiquadFilter() { return { ...node(), type: "", frequency: param(), Q: param() }; }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { return { ...node(), buffer: null, start() { log.noise++; } }; }
  }
  return { Ctx, log };
}
const sound = (log) => log.started + log.noise;

test("peakTier — questions 1-5 calm, 6-10 serious, 11-15 tense", () => {
  const a = loadApp();
  try {
    const tiers = [];
    for (let l = 1; l <= 15; l++) tiers.push(a.peakTier(l));
    assert.deepEqual(tiers, [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2]);
  } finally { a.close(); }
});

test("the suspense bed picks up with every tier — a quicker, louder pulse and a warmer drone", () => {
  const a = loadApp();
  try {
    assert.equal(a.PEAK_BED.length, 3);
    const [t0, t1, t2] = a.PEAK_BED;
    assert.ok(t0.bpm < t1.bpm && t1.bpm < t2.bpm, "each tier's heartbeat is quicker");
    assert.ok(t0.beatV < t1.beatV && t1.beatV < t2.beatV, "and a little louder");
    assert.ok(t0.cut < t1.cut && t1.cut < t2.cut, "the drone gets brighter");
    assert.ok(t0.drone.length < t1.drone.length && t1.drone.length < t2.drone.length, "and gains voices");
    for (const bed of a.PEAK_BED) {
      assert.ok(bed.vol[0] < bed.vol[1], "the drone swells over the question");
      assert.ok(!("seq" in bed), "no melody: the bed is a drone and a pulse");
    }
    assert.ok(t0.vol[1] <= t1.vol[1] && t1.vol[1] <= t2.vol[1]);
  } finally { a.close(); }
});

test("the drone is consonant — only the root, its fifth and octaves, never a minor second or tritone", () => {
  const a = loadApp();
  try {
    const consonant = [1, 1.5, 2, 3, 4];
    for (const bed of a.PEAK_BED) {
      const root = bed.drone[0];
      assert.ok(root >= 100, "the root sits where a phone speaker can still play it");
      for (const f of bed.drone) {
        const r = f / root;
        assert.ok(consonant.some((c) => Math.abs(r - c) / c < 0.01), f + " Hz is not a fifth or octave of " + root);
      }
    }
  } finally { a.close(); }
});

test("peakTension — each tier starts its own drone, filter drift and first heartbeat, and stops them all", () => {
  const a = loadApp();
  try {
    const { Ctx, log } = fakeAudio();
    a.setAudioContext(Ctx);
    // drone voices + the filter LFO + the first lub-dub (two soft thumps)
    const expected = [5, 6, 7];
    [1, 7, 13].forEach((level, tier) => {
      a.peakUi.mode = "play";
      a.peakUi.game = { level };
      const before = log.started, stoppedBefore = log.stopped;
      a.peakTension(true);
      assert.equal(log.started - before, expected[tier], "tier " + tier + " starts " + expected[tier] + " voices");
      a.peakTension(false);
      assert.ok(log.stopped - stoppedBefore >= a.PEAK_BED[tier].drone.length + 1, "tier " + tier + " stops its drone and LFO");
    });
    a.peakUi.mode = "idle"; // leaves nothing running between beats
  } finally { a.close(); }
});

test("every cue really sounds, and a safe sum is grander than an ordinary one", () => {
  const a = loadApp();
  try {
    const { Ctx, log } = fakeAudio();
    a.setAudioContext(Ctx);
    for (const cue of ["final", "correct", "strike", "wrong", "lifeline", "tick", "win", "violation"]) {
      const before = sound(log);
      a.peakSfx(cue, 3);
      assert.ok(sound(log) > before, cue + " makes a sound");
    }
    const count = (lv) => { const b = sound(log); a.peakSfx("correct", lv); return sound(log) - b; };
    const ordinary = count(4), safe5 = count(5), safe10 = count(10), ordinary11 = count(11);
    assert.ok(safe5 > ordinary && safe10 > ordinary, "question 5 and 10 get the full fanfare");
    assert.equal(safe5, safe10);
    assert.equal(ordinary, ordinary11, "other levels share the ordinary cue");
  } finally { a.close(); }
});

test("the musical cues are pure tones — no noise bursts", () => {
  const a = loadApp();
  try {
    const { Ctx, log } = fakeAudio();
    a.setAudioContext(Ctx);
    for (const cue of ["final", "correct", "strike", "wrong", "win"]) {
      const before = log.noise;
      a.peakSfx(cue, 5);
      assert.equal(log.noise, before, cue + " uses no noise");
    }
  } finally { a.close(); }
});

test("a muted game makes no sound at all", () => {
  const a = loadApp();
  try {
    const { Ctx, log } = fakeAudio();
    a.setAudioContext(Ctx);
    a.peakSetSound(false);
    a.peakUi.mode = "play"; a.peakUi.game = { level: 12 };
    a.peakTension(true);
    for (const cue of ["final", "correct", "wrong", "win"]) a.peakSfx(cue, 5);
    assert.equal(sound(log), 0);
  } finally { a.close(); }
});
