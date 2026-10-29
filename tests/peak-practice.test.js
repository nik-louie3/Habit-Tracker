const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app.js");

function setup(app) {
  const s = app.freshState();
  s.habits = [{ id: "h1", name: "h1", weight: 119, order: 0, tagId: null }];
  app.setState(s);
  app.recalcPoints();
  return app.getState();
}
const bank = () => {
  const b = [];
  for (let l = 1; l <= 15; l++) b.push({ id: "r" + l, level: l, category: "c" + (l % 9), q: "Q" + l, options: ["a", "b", "c", "d"], correct: l % 4, explanation: "E" + l });
  return b;
};

test("peakMonthStats — only the asked month, best result, total payout", () => {
  const app = loadApp();
  try {
    const st = setup(app);
    st.peak = { seen: [], active: null, games: [
      { id: "a", year: 2026, month: 9, reached: 7, payoutInli: 48, end: "walk" },
      { id: "b", year: 2026, month: 9, reached: 3, payoutInli: 0, end: "wrong" },
      { id: "c", year: 2026, month: 8, reached: 15, payoutInli: 411, end: "top" },
    ] };
    assert.deepEqual({ ...app.peakMonthStats(2026, 9) }, { games: 2, best: 7, inli: 48 });
    assert.deepEqual({ ...app.peakMonthStats(2026, 8) }, { games: 1, best: 15, inli: 411 });
    assert.deepEqual({ ...app.peakMonthStats(2026, 7) }, { games: 0, best: 0, inli: 0 });
    st.peak = undefined;
    assert.deepEqual({ ...app.peakMonthStats(2026, 9) }, { games: 0, best: 0, inli: 0 }, "no peak data at all");
  } finally { app.close(); }
});

test("peakReviewItems — only the questions the player actually saw, with the picks and the shown order", () => {
  const app = loadApp();
  try {
    setup(app);
    const g = app.peakNewGame(bank(), () => 0.5);
    g.level = 4; // died on question 4 (never saw 5..15)
    const items = app.peakReviewItems(g, { 1: 1, 2: 2, 3: 3, 4: 0 });
    assert.equal(items.length, 4);
    assert.deepEqual([...items.map((i) => i.level)], [1, 2, 3, 4]);
    assert.equal(items[0].q, "Q1");
    assert.equal(items[0].explanation, "E1");
    assert.equal(items[0].correct, 1);
    assert.equal(items[0].pick, 1);
    assert.deepEqual([...items[2].order], [...g.shown[2]]);
    assert.equal(items[3].pick, 0);
    const none = app.peakReviewItems(g, {});
    assert.equal(none[1].pick, -1, "no answer given (time ran out) is -1");
  } finally { app.close(); }
});

test("peakReviewItems — a won game reviews all 15", () => {
  const app = loadApp();
  try {
    setup(app);
    const g = app.peakNewGame(bank(), () => 0.5);
    g.level = 15; g.over = true; g.reached = 15;
    assert.equal(app.peakReviewItems(g, {}).length, 15);
  } finally { app.close(); }
});
