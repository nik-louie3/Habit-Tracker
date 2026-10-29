const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app.js");

function rngFrom(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const CATS = ["science", "geo", "history", "lit", "art", "music", "film", "sport", "food", "tech"];
// 15 levels × 6 questions, categories rotating, correct answer index varies
function bank() {
  const b = [];
  for (let l = 1; l <= 15; l++) for (let k = 0; k < 6; k++) b.push({ id: `q${l}-${k}`, level: l, category: CATS[(l + k) % CATS.length], q: "?", options: ["a", "b", "c", "d"], correct: (l + k) % 4, explanation: "" });
  return b;
}
const game = (seed = 1) => { const a = loadApp(); const rng = rngFrom(seed); const g = a.peakNewGame(a.peakPickQuestions(bank(), [], rng), rng); return { a, g, rng }; };

test("peakPickQuestions — one per level, ≥8 categories, ≤2 each, never the same twice in a row", () => {
  const a = loadApp();
  try {
    for (let seed = 1; seed <= 60; seed++) {
      const qs = a.peakPickQuestions(bank(), [], rngFrom(seed));
      assert.equal(qs.length, 15);
      assert.deepEqual([...qs.map((q) => q.level)], Array.from({ length: 15 }, (_, i) => i + 1));
      const count = {};
      qs.forEach((q, i) => { count[q.category] = (count[q.category] || 0) + 1; if (i) assert.notEqual(q.category, qs[i - 1].category); });
      assert.ok(Object.keys(count).length >= 8, "categories " + Object.keys(count).length);
      assert.ok(Object.values(count).every((n) => n <= 2));
    }
  } finally { a.close(); }
});

test("peakPickQuestions — prefers unseen questions, starts over when a level is exhausted, null without a full bank", () => {
  const a = loadApp();
  try {
    const seen = bank().filter((q) => q.level === 3 && q.id !== "q3-0").map((q) => q.id);
    for (let seed = 1; seed <= 20; seed++) assert.equal(a.peakPickQuestions(bank(), seen, rngFrom(seed))[2].id, "q3-0");
    const all = bank().filter((q) => q.level === 3).map((q) => q.id);
    assert.equal(a.peakPickQuestions(bank(), all, rngFrom(5))[2].level, 3); // exhausted → reused, not stuck
    assert.equal(a.peakPickQuestions(bank().filter((q) => q.level !== 7), [], rngFrom(1)), null);
  } finally { a.close(); }
});

test("peakNewGame — every question gets its own shuffled order of the four options", () => {
  const { a, g } = game(3);
  try {
    assert.equal(g.level, 1);
    g.shown.forEach((o) => assert.deepEqual([...o].sort(), [0, 1, 2, 3]));
    assert.ok(g.shown.some((o) => o.join() !== "0,1,2,3"));
  } finally { a.close(); }
});

test("50:50 keeps the right answer and one wrong; each lifeline only once", () => {
  const { a, g, rng } = game(7);
  try {
    const q = a.peakQ(g);
    const r = a.peakUseLifeline(g, "5050", rng);
    assert.equal(r.ok, true);
    const vis = a.peakVisible(g);
    assert.equal(vis.length, 2);
    assert.ok(vis.includes(q.correct));
    assert.equal(a.peakUseLifeline(g, "5050", rng).reason, "used");
    assert.equal(a.peakUseLifeline(g, "nope", rng).ok, false);
  } finally { a.close(); }
});

test("Double dip and 50:50 cannot be combined on one question, in either order", () => {
  let { a, g, rng } = game(8);
  try {
    assert.equal(a.peakUseLifeline(g, "double", rng).ok, true);
    assert.equal(a.peakUseLifeline(g, "5050", rng).reason, "combo");
    assert.equal(g.used.includes("5050"), false, "a refused lifeline is not spent");
  } finally { a.close(); }
  ({ a, g, rng } = game(9));
  try {
    assert.equal(a.peakUseLifeline(g, "5050", rng).ok, true);
    assert.equal(a.peakUseLifeline(g, "double", rng).reason, "combo");
    // on the next question the flags are fresh: double is allowed again
    a.peakAnswer(g, a.peakQ(g).correct);
    assert.equal(a.peakUseLifeline(g, "double", rng).ok, true);
  } finally { a.close(); }
});

test("phone and audience only talk about options still in play; audience adds up to 100", () => {
  const { a, g, rng } = game(11);
  try {
    a.peakUseLifeline(g, "5050", rng);
    const vis = a.peakVisible(g);
    const ph = a.peakUseLifeline(g, "phone", rng);
    assert.ok(vis.includes(ph.answer));
    assert.ok(ph.confidence >= 30 && ph.confidence <= 99);
    const au = a.peakUseLifeline(g, "audience", rng);
    assert.deepEqual(Object.keys(au.percent).map(Number).sort(), [...vis].sort());
    assert.equal(Object.values(au.percent).reduce((s, v) => s + v, 0), 100);
  } finally { a.close(); }
});

test("a wrong answer ends the game with the cleared count; a right one moves on and resets the question flags", () => {
  const { a, g } = game(2);
  try {
    const wrongOf = (q) => [0, 1, 2, 3].find((i) => i !== q.correct);
    assert.equal(a.peakAnswer(g, a.peakQ(g).correct).result, "right");
    assert.equal(g.level, 2);
    assert.deepEqual([g.gone.length, g.struck.length, g.doubleOn, g.fifty], [0, 0, false, false]);
    const r = a.peakAnswer(g, wrongOf(a.peakQ(g)));
    assert.deepEqual([r.result, r.reached], ["wrong", 1]);
    assert.equal(a.peakAnswer(g, 0).result, "over");
  } finally { a.close(); }
});

test("Double dip — the first miss only strikes the option, the second ends the game; burned either way", () => {
  let { a, g, rng } = game(4);
  try {
    const q = a.peakQ(g), w = [0, 1, 2, 3].filter((i) => i !== q.correct);
    a.peakUseLifeline(g, "double", rng);
    assert.equal(a.peakAnswer(g, w[0]).result, "retry");
    assert.equal(a.peakVisible(g).includes(w[0]), false);
    assert.equal(a.peakAnswer(g, w[0]).result, "invalid"); // the struck option cannot be picked again
    assert.equal(a.peakAnswer(g, q.correct).result, "right");
    assert.equal(g.used.includes("double"), true);
    assert.equal(a.peakUseLifeline(g, "double", rng).reason, "used");
  } finally { a.close(); }
  ({ a, g, rng } = game(4));
  try {
    const q = a.peakQ(g), w = [0, 1, 2, 3].filter((i) => i !== q.correct);
    a.peakUseLifeline(g, "double", rng);
    a.peakAnswer(g, w[0]);
    const r = a.peakAnswer(g, w[1]);
    assert.deepEqual([r.result, r.reached, r.correct], ["wrong", 0, q.correct]);
  } finally { a.close(); }
});

test("fifteen right answers reach the top; timeout and walking away report what was cleared", () => {
  let { a, g } = game(6);
  try {
    for (let i = 1; i <= 14; i++) assert.equal(a.peakAnswer(g, a.peakQ(g).correct).result, "right");
    const r = a.peakAnswer(g, a.peakQ(g).correct);
    assert.deepEqual([r.result, r.reached], ["top", 15]);
  } finally { a.close(); }
  ({ a, g } = game(6));
  try {
    for (let i = 1; i <= 6; i++) a.peakAnswer(g, a.peakQ(g).correct);
    const t = a.peakTimeout(g);
    assert.deepEqual([t.result, t.reached], ["timeout", 6]);
  } finally { a.close(); }
  ({ a, g } = game(6));
  try {
    for (let i = 1; i <= 3; i++) a.peakAnswer(g, a.peakQ(g).correct);
    const w = a.peakWalkAway(g);
    assert.deepEqual([w.result, w.reached], ["walk", 3]);
  } finally { a.close(); }
});
