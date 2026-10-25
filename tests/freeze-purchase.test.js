const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app.js");

// One habit weighing 119 (the default set's total) makes 1 day = 119 × 1.15 = 136.85 INLI, so the two
// paid-freeze prices (3.65 and 5.48 days) land on the 500 / 750 INLI they were designed around.
// freshState() starts tracking today, so no past day is judged: the balance is exactly `balance`
// (debtForgiven is a plain positive term in recalcPoints) minus whatever gets bought.
function setup(app, balance) {
  const s = app.freshState();
  s.habits = [{ id: "h1", name: "h1", weight: 119, order: 0, tagId: null }];
  s.debtForgiven = balance || 0;
  app.setState(s);
  app.recalcPoints();
  return app.getState();
}

// The paid slots only exist in the real current month of the shown year — that is the month under test.
function currentMonth(app) {
  const rt = app.realTodayParts();
  assert.equal(app.activeYear(), rt.y, "tests assume the shown year is the real current year");
  return { y: rt.y, m: rt.m };
}

function receipt(s, y, m, cost) {
  return { id: "r" + Math.random(), kind: "freeze", year: y, month: m, name: "Freeze", emo: "❄", cost, date: Date.now() };
}

test("freezeAllowance — 3 free, plus only this month's paid freezes", () => {
  const app = loadApp();
  try {
    const s = setup(app, 0);
    const { y, m } = currentMonth(app);
    assert.equal(app.freezeAllowance(m), 3);

    s.purchases.push(receipt(s, y, m, 500));
    assert.equal(app.paidFreezesBought(y, m), 1);
    assert.equal(app.freezeAllowance(m), 4);

    s.purchases.push(receipt(s, y, m, 750));
    assert.equal(app.freezeAllowance(m), 5);

    // Another month, another year and an ordinary shop purchase never add slots here.
    s.purchases.push(receipt(s, y, (m + 1) % 12, 500));
    s.purchases.push({ ...receipt(s, y + 1, m, 500) });
    s.purchases.push({ id: "x", rewardId: "some-reward", name: "Treat", cost: 50, date: Date.now() });
    assert.equal(app.freezeAllowance(m), 5);
  } finally {
    app.close();
  }
});

test("nextFreezePrice — 3.65 then 5.48 days of the daily unit, nothing after two", () => {
  const app = loadApp();
  try {
    const s = setup(app, 0);
    const { y, m } = currentMonth(app);
    assert.equal(app.dailyUnit(), 119 * 1.15);

    assert.equal(app.nextFreezePrice(y, m), 500);
    s.purchases.push(receipt(s, y, m, 500));
    assert.equal(app.nextFreezePrice(y, m), 750);
    s.purchases.push(receipt(s, y, m, 750));
    assert.equal(app.nextFreezePrice(y, m), null);

    // Prices float with the workload, like every other shop price: a lighter set costs proportionally less.
    const s2 = setup(app, 0);
    s2.habits[0].weight = 10;
    assert.equal(app.nextFreezePrice(y, m), Math.round(3.65 * 10 * 1.15));
  } finally {
    app.close();
  }
});

test("freezePurchaseBlock / canBuyFreeze — month, cap, debt and funds", () => {
  const app = loadApp();
  try {
    const s = setup(app, 10000);
    const { y, m } = currentMonth(app);

    assert.equal(app.freezePurchaseBlock(m), null);
    assert.equal(app.canBuyFreeze(m), true);

    // Only the real current month can buy: any other month is refused outright.
    assert.equal(app.freezePurchaseBlock((m + 1) % 12), "month");
    assert.equal(app.canBuyFreeze((m + 1) % 12), false);

    // Not enough INLI is a funds problem, but buying is still structurally available.
    s.points = 499;
    assert.equal(app.freezePurchaseBlock(m), "funds");
    assert.equal(app.canBuyFreeze(m), true);
    s.points = 500;
    assert.equal(app.freezePurchaseBlock(m), null);

    // Debt blocks every purchase, same gate as the shop.
    s.points = -1;
    assert.equal(app.freezePurchaseBlock(m), "debt");

    // The cap of two wins over everything else and makes buying structurally unavailable.
    s.points = 10000;
    s.purchases.push(receipt(s, y, m, 500), receipt(s, y, m, 750));
    assert.equal(app.freezePurchaseBlock(m), "max");
    assert.equal(app.canBuyFreeze(m), false);
  } finally {
    app.close();
  }
});

test("buyFreeze — records a receipt that recalcPoints charges, up to two per month", () => {
  const app = loadApp();
  try {
    const s = setup(app, 5000);
    const { y, m } = currentMonth(app);
    assert.equal(s.points, 5000);

    assert.equal(app.buyFreeze(m), "ok");
    assert.equal(s.purchases.length, 1);
    assert.deepEqual(
      { kind: s.purchases[0].kind, year: s.purchases[0].year, month: s.purchases[0].month, cost: s.purchases[0].cost },
      { kind: "freeze", year: y, month: m, cost: 500 }
    );
    assert.equal(s.points, 4500);
    assert.equal(app.freezeAllowance(m), 4);

    assert.equal(app.buyFreeze(m), "ok");
    assert.equal(s.points, 3750);
    assert.equal(app.freezeAllowance(m), 5);

    // A third attempt changes nothing.
    assert.equal(app.buyFreeze(m), "max");
    assert.equal(s.purchases.length, 2);
    assert.equal(s.points, 3750);

    // Refused purchases leave no receipt either.
    assert.equal(app.buyFreeze((m + 1) % 12), "month");
    assert.equal(s.purchases.length, 2);
  } finally {
    app.close();
  }
});

test("toggleFreeze — free freezes first, then an offer to buy, any day of the current month", () => {
  const app = loadApp();
  try {
    const s = setup(app, 5000);
    const { m } = currentMonth(app);
    const asked = [];
    let answer = true;
    app.setConfirm((msg) => { asked.push(msg); return answer; });

    // The first three are free and never ask.
    [1, 2, 3].forEach((d) => app.toggleFreeze(m, d));
    assert.deepEqual([...app.getFreezes(m)], [1, 2, 3]);
    assert.equal(asked.length, 0);
    assert.equal(s.purchases.length, 0);

    // The 4th asks; declining freezes nothing and charges nothing.
    answer = false;
    app.toggleFreeze(m, 4);
    assert.equal(asked.length, 1);
    assert.match(asked[0], /500/);
    assert.deepEqual([...app.getFreezes(m)], [1, 2, 3]);
    assert.equal(s.purchases.length, 0);

    // Accepting buys the slot and freezes that day at once — including a day long gone (day 1 is never
    // in the future), since a paid slot covers the whole month it was bought in.
    answer = true;
    app.toggleFreeze(m, 4);
    assert.deepEqual([...app.getFreezes(m)], [1, 2, 3, 4]);
    assert.equal(s.purchases.length, 1);
    assert.equal(s.points, 4500);

    // The 5th asks again, at the second price.
    app.toggleFreeze(m, 5);
    assert.equal(asked.length, 3);
    assert.match(asked[2], /750/);
    assert.deepEqual([...app.getFreezes(m)], [1, 2, 3, 4, 5]);
    assert.equal(s.points, 3750);

    // The 6th has nothing left to buy: no question, no freeze, no charge.
    app.toggleFreeze(m, 6);
    assert.equal(asked.length, 3);
    assert.equal(app.getFreezes(m).length, 5);
    assert.equal(s.purchases.length, 2);

    // Un-freezing keeps the paid slot (no refund), so the slot moves to another day without a new charge.
    app.toggleFreeze(m, 5);
    assert.equal(app.getFreezes(m).length, 4);
    assert.equal(app.freezeAllowance(m), 5);
    app.toggleFreeze(m, 7);
    assert.equal(asked.length, 3);
    assert.equal(app.getFreezes(m).length, 5);
    assert.equal(s.points, 3750);
  } finally {
    app.close();
  }
});

test("toggleFreeze — no offer outside the current month, in debt, or without funds", () => {
  const app = loadApp();
  try {
    const s = setup(app, 5000);
    const { m } = currentMonth(app);
    const other = (m + 1) % 12;
    const asked = [];
    app.setConfirm((msg) => { asked.push(msg); return true; });

    // Another month: only its own 3 free freezes exist.
    [1, 2, 3, 4].forEach((d) => app.toggleFreeze(other, d));
    assert.equal(app.getFreezes(other).length, 3);
    assert.equal(asked.length, 0);
    assert.equal(s.purchases.length, 0);

    // Current month, but not enough INLI: refused with no question and no charge.
    [1, 2, 3].forEach((d) => app.toggleFreeze(m, d));
    s.points = 499;
    app.toggleFreeze(m, 4);
    assert.equal(asked.length, 0);
    assert.equal(app.getFreezes(m).length, 3);

    // Current month, in debt: same.
    s.points = -50;
    app.toggleFreeze(m, 4);
    assert.equal(asked.length, 0);
    assert.equal(app.getFreezes(m).length, 3);
    assert.equal(s.purchases.length, 0);
  } finally {
    app.close();
  }
});
