const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app.js");

// Same fixture as freeze-purchase.test.js: one habit weighing 119 makes 1 day = 136.85 INLI, so the paid
// freezes cost 500 then 750, and the balance is exactly `balance` minus what has been bought.
function setup(app, balance) {
  const s = app.freshState();
  s.habits = [{ id: "h1", name: "h1", weight: 119, order: 0, tagId: null }];
  s.debtForgiven = balance || 0;
  app.setState(s);
  app.recalcPoints();
  return app.getState();
}

function currentMonth(app) {
  const rt = app.realTodayParts();
  assert.equal(app.activeYear(), rt.y, "tests assume the shown year is the real current year");
  return { y: rt.y, m: rt.m };
}

const frozen = (app, m) => [...app.getFreezes(m)];

test("sellFreeze — refunds the full receipt of the latest paid slot and rewinds the price ladder", () => {
  const app = loadApp();
  try {
    const s = setup(app, 5000);
    const { y, m } = currentMonth(app);
    assert.equal(app.buyFreeze(m), "ok"); // 500
    assert.equal(app.buyFreeze(m), "ok"); // 750
    assert.equal(s.points, 3750);

    // The newest slot goes first, so the cheap one is never left stranded behind an expensive one.
    assert.equal(app.latestFreezeReceipt(y, m).cost, 750);
    assert.equal(app.sellFreeze(m), "ok");
    assert.equal(s.points, 4500);
    assert.equal(app.paidFreezesBought(y, m), 1);
    assert.equal(app.freezeAllowance(m), 4);
    // After selling the second, the next purchase is the second price again.
    assert.equal(app.nextFreezePrice(y, m), 750);

    assert.equal(app.sellFreeze(m), "ok");
    assert.equal(s.points, 5000);
    assert.equal(app.freezeAllowance(m), 3);
    assert.equal(app.nextFreezePrice(y, m), 500);

    // Nothing left to sell, and nothing changed by asking.
    assert.equal(app.sellFreeze(m), "none");
    assert.equal(s.points, 5000);
    assert.equal(s.purchases.length, 0);
  } finally {
    app.close();
  }
});

test("sellFreeze — refunds what was paid, not what the freeze would cost today", () => {
  const app = loadApp();
  try {
    const s = setup(app, 5000);
    const { m } = currentMonth(app);
    assert.equal(app.buyFreeze(m), "ok"); // 500 at weight 119
    assert.equal(s.points, 4500);

    // The workload doubles, so a new freeze would now cost 1000 — but the sale still gives back 500.
    s.habits[0].weight = 238;
    assert.equal(app.freezeBtnInfo(m, 1).sellRefund, 500);
    assert.equal(app.sellFreeze(m), "ok");
    assert.equal(s.points, 5000);
  } finally {
    app.close();
  }
});

test("freezeSellBlock — only an unused paid slot of the current month can be sold", () => {
  const app = loadApp();
  try {
    const s = setup(app, 5000);
    const { y, m } = currentMonth(app);
    const other = (m + 1) % 12;

    assert.equal(app.freezeSellBlock(m), "none");
    assert.equal(app.buyFreeze(m), "ok");
    assert.equal(app.freezeSellBlock(m), null);

    // Another month's slots expired with that month, even when a receipt for it exists.
    s.purchases.push({ id: "old", kind: "freeze", year: y, month: other, name: "Freeze", emo: "❄", cost: 500, date: Date.now() });
    assert.equal(app.freezeSellBlock(other), "month");
    assert.equal(app.sellFreeze(other), "month");
    assert.equal(app.paidFreezesBought(y, other), 1);

    // Every slot (3 free + 1 paid) taken by a frozen day: un-freeze one first.
    [1, 2, 3, 4].forEach((d) => app.toggleFreeze(m, d));
    assert.equal(frozen(app, m).length, 4);
    assert.equal(app.freezeSellBlock(m), "inuse");
    assert.equal(app.sellFreeze(m), "inuse");
    assert.equal(app.paidFreezesBought(y, m), 1);

    app.toggleFreeze(m, 4); // un-freeze: the paid slot is spare again
    assert.equal(app.freezeSellBlock(m), null);
    assert.equal(app.freezeBtnInfo(m, 5).sellRefund, 500);
  } finally {
    app.close();
  }
});

test("sellFreeze — works while in debt: it only returns money", () => {
  const app = loadApp();
  try {
    const s = setup(app, 5000);
    const { m } = currentMonth(app);
    assert.equal(app.buyFreeze(m), "ok");

    s.debtForgiven = 0;
    app.recalcPoints();
    assert.equal(s.points, -500);
    assert.equal(app.freezePurchaseBlock(m), "debt"); // buying is blocked in debt…
    assert.equal(app.sellFreeze(m), "ok"); // …selling is not
    assert.equal(s.points, 0);
  } finally {
    app.close();
  }
});

test("sellFreeze — a sold slot cannot be turned into a free freeze through the remembered days", () => {
  const app = loadApp();
  try {
    const s = setup(app, 5000);
    const { m } = currentMonth(app);
    const asked = [];
    let answer = true;
    app.setConfirm((msg) => { asked.push(msg); return answer; });

    // buy a slot by freezing a 4th day, then un-freeze that day: it is now "remembered" as ever frozen
    [1, 2, 3, 4].forEach((d) => app.toggleFreeze(m, d));
    app.toggleFreeze(m, 4);
    assert.deepEqual(frozen(app, m), [1, 2, 3]);
    assert.equal(app.sellFreeze(m), "ok");

    // Without trimming that memory, day 4 could be put back for nothing. It must ask to buy again.
    answer = false;
    const before = asked.length;
    app.toggleFreeze(m, 4);
    assert.equal(asked.length, before + 1);
    assert.deepEqual(frozen(app, m), [1, 2, 3]);
    assert.equal(s.purchases.length, 0);
  } finally {
    app.close();
  }
});

test("sellFreeze — remembered days that still fit the new allowance stay restorable", () => {
  const app = loadApp();
  try {
    setup(app, 5000);
    const { m } = currentMonth(app);
    const asked = [];
    let answer = true;
    app.setConfirm((msg) => { asked.push(msg); return answer; });

    // allowance 4 (one paid slot); freeze 1..4 then un-freeze 3 and 4 → active [1,2], remembered 1..4
    [1, 2, 3, 4].forEach((d) => app.toggleFreeze(m, d));
    app.toggleFreeze(m, 3);
    app.toggleFreeze(m, 4);
    assert.deepEqual(frozen(app, m), [1, 2]);

    assert.equal(app.sellFreeze(m), "ok"); // allowance 3: room for ONE more remembered day, the latest (4)
    const before = asked.length;
    app.toggleFreeze(m, 4);
    assert.equal(asked.length, before, "day 4 fits the allowance, so no question");
    assert.deepEqual(frozen(app, m), [1, 2, 4]);

    // day 3 was forgotten and would be a 4th freeze: it needs a purchase again
    answer = false;
    app.toggleFreeze(m, 3);
    assert.equal(asked.length, before + 1);
    assert.deepEqual(frozen(app, m), [1, 2, 4]);
  } finally {
    app.close();
  }
});

test("offerFreezeSale — asks with the refund, sells on yes, explains when every slot is in use", () => {
  const app = loadApp();
  try {
    const s = setup(app, 5000);
    const { y, m } = currentMonth(app);
    const asked = [];
    let answer = true;
    app.setConfirm((msg) => { asked.push(msg); return answer; });

    assert.equal(app.buyFreeze(m), "ok");
    assert.equal(s.points, 4500);

    answer = false;
    assert.equal(app.offerFreezeSale(m), false);
    assert.equal(asked.length, 1);
    assert.match(asked[0], /500/);
    assert.equal(app.paidFreezesBought(y, m), 1);
    assert.equal(s.points, 4500);

    answer = true;
    assert.equal(app.offerFreezeSale(m), true);
    assert.equal(s.points, 5000);
    assert.equal(app.paidFreezesBought(y, m), 0);

    // With every slot in use there is nothing to sell yet: no question, a toast says what to do.
    assert.equal(app.buyFreeze(m), "ok");
    [1, 2, 3, 4].forEach((d) => app.toggleFreeze(m, d));
    const before = asked.length;
    assert.equal(app.offerFreezeSale(m), false);
    assert.equal(asked.length, before);
    assert.equal(app.paidFreezesBought(y, m), 1);
  } finally {
    app.close();
  }
});

test("cancelPurchase — a freeze receipt is sold only when it is the latest sellable one", () => {
  const app = loadApp();
  try {
    const s = setup(app, 5000);
    const { y, m } = currentMonth(app);
    const asked = [];
    app.setConfirm((msg) => { asked.push(msg); return true; });

    assert.equal(app.buyFreeze(m), "ok"); // 500
    assert.equal(app.buyFreeze(m), "ok"); // 750
    const [first, second] = s.purchases;
    assert.equal(app.isSellableFreezeReceipt(first), false);
    assert.equal(app.isSellableFreezeReceipt(second), true);

    // The older receipt's cancel does nothing at all.
    app.cancelPurchase(first.id);
    assert.equal(asked.length, 0);
    assert.equal(app.paidFreezesBought(y, m), 2);

    // The latest one is refunded in full through the same path.
    app.cancelPurchase(second.id);
    assert.equal(asked.length, 1);
    assert.equal(app.paidFreezesBought(y, m), 1);
    assert.equal(s.points, 4500);
  } finally {
    app.close();
  }
});
