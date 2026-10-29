const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app.js");

// jsdom has no Web Audio, so the game's own cue code never runs in the other sound tests. This
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
    for (const cue of ["final", "correct", "wrong", "win", "tick", "strike"]) a.peakSfx(cue, 5);
    assert.equal(sound(log), 0);
  } finally { a.close(); }
});

// There is no background music: a question starts in silence and only events (an answer, a lifeline, the
// last 20 seconds, ...) make a sound.
test("a question starts in silence — there is no background music", () => {
  const a = loadApp();
  try {
    const { Ctx, log } = fakeAudio();
    a.setAudioContext(Ctx);
    const st = a.freshState();
    st.habits = [{ id: "h1", name: "h1", weight: 119, order: 0, tagId: null }];
    a.setState(st);
    const bank = [];
    for (let l = 1; l <= 15; l++) bank.push({ id: "r" + l, level: l, category: "c" + (l % 9), q: "Q" + l, options: ["a", "b", "c", "d"], correct: l % 4, explanation: "E" + l });
    const ui = a.peakUi;
    ui.bank = bank; ui.bankLang = st.lang || "ru"; ui.practice = true; ui.picks = {};
    ui.game = a.peakNewGame(bank, () => 0.5);
    for (const level of [1, 7, 13]) {
      ui.game.level = level;
      a.peakAskNext();
      assert.equal(ui.mode, "play");
      assert.equal(sound(log), 0, "question " + level + " begins with no sound at all");
    }
  } finally { a.close(); }
});
