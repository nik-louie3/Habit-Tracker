const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app.js");

test("missPenaltyMult / successBonusMult — streak escalation", () => {
  const app = loadApp();
  try {
    const { missPenaltyMult, successBonusMult } = app;

    // Below the escalation threshold: flat baseline (README: elapsed miss = -3x weight, check = +1x).
    assert.equal(missPenaltyMult(0), 3);
    assert.equal(missPenaltyMult(2), 3);
    assert.equal(successBonusMult(0), 1);
    assert.equal(successBonusMult(4), 1);

    // Escalation starts once the streak reaches its threshold and grows in +0.5 steps per day.
    assert.equal(missPenaltyMult(3), 3.5);
    assert.equal(missPenaltyMult(4), 4);
    assert.equal(successBonusMult(5), 1.5);
    assert.equal(successBonusMult(6), 2);

    // Caps: penalty tops out at -6x (around day 8), bonus at +4x (around day 10) — per index.html's
    // own comment on STREAK_ESCALATION_CAP_DELTA — and must never overshoot on longer streaks.
    assert.equal(missPenaltyMult(8), 6);
    assert.equal(missPenaltyMult(20), 6);
    assert.equal(successBonusMult(10), 4);
    assert.equal(successBonusMult(50), 4);
  } finally {
    app.close();
  }
});

test("effectiveWeeklyQuota / effectiveTierLabel — quota-override periods", () => {
  const app = loadApp();
  try {
    const { effectiveWeeklyQuota, effectiveTierLabel, activeQuotaOverride } = app;

    // Month is 0-indexed throughout this codebase (JS Date convention) — May=4, June=5 — even
    // though the override's own start/end strings use normal 1-indexed calendar dates.
    const MAY = 4, JUNE = 5;

    const habit = {
      weeklyQuota: 3,
      violationTiers: [{ label: "x>15" }],
      quotaOverrides: [
        { start: "2026-06-01", end: "2026-06-15", quota: 5, violationLabels: ["x>7"] },
      ],
    };

    // Outside the override window: base quota and the tier's own label.
    assert.equal(effectiveWeeklyQuota(habit, 2026, MAY, 20), 3);
    assert.equal(effectiveTierLabel(habit, "violation", 0, 2026, MAY, 20), "x>15");

    // Inside the override window: overridden quota and renamed label (PR #50 — the reward stays
    // tied to the tier's position, only the displayed text changes).
    assert.equal(effectiveWeeklyQuota(habit, 2026, JUNE, 10), 5);
    assert.equal(effectiveTierLabel(habit, "violation", 0, 2026, JUNE, 10), "x>7");

    // `end` is exclusive: the override must not still apply on its own end date.
    assert.equal(effectiveWeeklyQuota(habit, 2026, JUNE, 15), 3);
    assert.equal(activeQuotaOverride(habit, 2026, JUNE, 15), null);

    // A habit with no overrides at all just falls back to its own base quota/labels.
    const plain = { weeklyQuota: 2, violationTiers: [{ label: "x>5" }] };
    assert.equal(effectiveWeeklyQuota(plain, 2026, JUNE, 10), 2);
    assert.equal(effectiveTierLabel(plain, "violation", 0, 2026, JUNE, 10), "x>5");
  } finally {
    app.close();
  }
});

test("migrate() is idempotent on a fresh state", () => {
  const app = loadApp();
  try {
    const { freshState, migrate, setState, getState } = app;

    setState(freshState());
    migrate();
    const once = JSON.stringify(getState());

    migrate();
    const twice = JSON.stringify(getState());

    // index.html's own comment on migrate() claims every step is guarded by `if(!...)`, so a second
    // run must be a pure no-op. That guarantee is what makes it safe for load() to call migrate() on
    // every single load (see the comment there) without ever re-touching an already-migrated user's
    // real data — this test just holds the code to the invariant it already claims for itself.
    assert.equal(twice, once, "migrate() changed state on a second run — it must be a no-op once already applied");
  } finally {
    app.close();
  }
});
