const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app.js");

// One habit weighing 119: 1 day = 119 × 1.15 = 136.85 INLI (the default set), so the ladder is
// 4 · 8 · 12 · 21 · 34 · 48 · 68 · 82 · 103 · 137 · 164 · 205 · 260 · 328 · 411 INLI.
const LADDER = [4, 8, 12, 21, 34, 48, 68, 82, 103, 137, 164, 205, 260, 328, 411];

function setup(app) {
  const s = app.freshState();
  s.habits = [{ id: "h1", name: "h1", weight: 119, order: 0, tagId: null }];
  s.debtForgiven = 1000;
  app.setState(s);
  app.recalcPoints();
  return app.getState();
}

test("ladder — prizes are days × dailyUnit and the wrong-answer fall lands on the safe sums", () => {
  const app = loadApp();
  try {
    setup(app);
    assert.equal(app.PEAK_PRIZE_DAYS.length, 15);
    assert.deepEqual(Array.from({ length: 15 }, (_, i) => app.peakPrizeInli(i + 1)), LADDER);
    assert.equal(app.peakPrizeInli(0), 0);

    // question level = the one being answered; the safe sum is the last of 5 / 10 already cleared
    assert.equal(app.peakPayoutOnWrong(1), 0);
    assert.equal(app.peakPayoutOnWrong(5), 0); // 5th answered wrong: 5 not cleared yet
    assert.equal(app.peakPayoutOnWrong(6), LADDER[4]); // 5 cleared
    assert.equal(app.peakPayoutOnWrong(10), LADDER[4]);
    assert.equal(app.peakPayoutOnWrong(11), LADDER[9]); // 10 cleared
    assert.equal(app.peakPayoutOnWrong(15), LADDER[9]);
  } finally {
    app.close();
  }
});

test("attempts — 3 per calendar month, taken at the start, other months do not count", () => {
  const app = loadApp();
  try {
    const s = setup(app);
    const rt = app.realTodayParts();
    assert.equal(app.PEAK_GAMES_PER_MONTH, 3);
    assert.equal(app.peakAttemptsLeft(), 3);

    assert.ok(app.peakStartGame());
    assert.equal(app.peakAttemptsLeft(), 2); // an unfinished game already counts
    assert.equal(app.peakStartGame(), null); // one at a time
    app.peakFinishGame("walk", 0);
    assert.equal(app.peakAttemptsLeft(), 2);

    // a game from last month does not use up this month
    s.peak.games.push({ id: "old", year: rt.y, month: (rt.m + 11) % 12, end: "top", payoutInli: 0, payoutDays: 0 });
    s.peak.games.push({ id: "old2", year: rt.y - 1, month: rt.m, end: "top", payoutInli: 0, payoutDays: 0 });
    assert.equal(app.peakGamesThisMonth(rt.y, rt.m), 1);
    assert.equal(app.peakAttemptsLeft(), 2);

    assert.ok(app.peakStartGame());
    app.peakFinishGame("wrong", 1);
    assert.ok(app.peakStartGame());
    app.peakFinishGame("wrong", 1);
    assert.equal(app.peakAttemptsLeft(), 0);
    assert.equal(app.peakStartGame(), null);
  } finally {
    app.close();
  }
});

test("peakFinishGame — payout by how the game ended, as a frozen receipt that recalcPoints adds once", () => {
  const app = loadApp();
  try {
    const s = setup(app);
    const base = s.points;
    const cases = [
      ["walk", 8, LADDER[7]], // took the 8th prize
      ["wrong", 7, LADDER[4]], // missed the 8th: falls to the safe 5th
      ["timeout", 12, LADDER[9]], // timed out on the 13th: falls to the safe 10th
      ["wrong", 3, 0], // missed the 4th: nothing safe yet
      ["top", 15, LADDER[14]],
      ["violation", 9, 0],
    ];
    let total = 0;
    cases.forEach(([end, reached, inli], i) => {
      const rt = app.realTodayParts();
      // lift the monthly limit for this table by moving earlier games to last month
      s.peak.games.forEach((g) => { g.month = (rt.m + 11) % 12; });
      assert.ok(app.peakStartGame(), "case " + i);
      const g = app.peakFinishGame(end, reached);
      assert.equal(g.payoutInli, inli, end + " after " + reached);
      assert.equal(g.end, end);
      total += inli;
      assert.equal(s.points, base + total);
    });
    assert.equal(s.peak.active, null);

    // the receipt is frozen: a later change of the workload never re-prices a finished game
    s.habits[0].weight = 238;
    app.recalcPoints();
    assert.equal(s.points, base + total);
    assert.ok(s.peak.games.every((g) => typeof g.payoutDays === "number"));
  } finally {
    app.close();
  }
});

test("an unfinished game found after a reload is a loss with 0 INLI, and the attempt stays used", () => {
  const app = loadApp();
  try {
    const s = setup(app);
    assert.ok(app.peakStartGame());
    // same page: the game is still running, nothing is dropped
    assert.equal(app.peakDropInterrupted(), false);
    assert.ok(s.peak.active);

    // a reload = same device, different page session
    s.peak.active.session = "an-older-page-load";
    s.peak.active.level = 6;
    assert.equal(app.peakDropInterrupted(), true);
    assert.equal(s.peak.active, null);
    const g = s.peak.games[s.peak.games.length - 1];
    assert.deepEqual([g.end, g.reached, g.payoutInli], ["interrupted", 5, 0]);
    assert.equal(app.peakAttemptsLeft(), 2);

    // a game started on ANOTHER device (arrives through sync) is left alone while it is fresh…
    assert.ok(app.peakStartGame());
    s.peak.active.device = "another-device";
    s.peak.active.session = "x";
    assert.equal(app.peakDropInterrupted(), false);
    // …and dropped once it is older than any real game could last
    s.peak.active.startedAt = Date.now() - 3 * 3600 * 1000;
    assert.equal(app.peakDropInterrupted(), true);
  } finally {
    app.close();
  }
});

test("migrate gives old data an empty peak state and keeps existing games", () => {
  const app = loadApp();
  try {
    const s = setup(app);
    delete s.peak;
    app.migrate();
    assert.deepEqual(JSON.parse(JSON.stringify(s.peak)), { games: [], seen: [], active: null });
    s.peak.games.push({ id: "g", year: 2026, month: 0, end: "walk", payoutInli: 5, payoutDays: 0.03 });
    app.migrate();
    assert.equal(s.peak.games.length, 1);
  } finally {
    app.close();
  }
});
