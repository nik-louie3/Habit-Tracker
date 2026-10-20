const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app.js");

function stateWithHabits(app, ids) {
  const s = app.freshState();
  s.habits = ids.map((id, i) => ({ id, name: id, order: i, tagId: null }));
  app.setState(s);
  return app.getState();
}

function stateWithTags(app, ids) {
  const s = app.freshState();
  s.tags = ids.map((id) => ({ id, name: id, color: "#4A90D9" }));
  app.setState(s);
  return app.getState();
}

const habitIds = (s) => s.habits.map((h) => h.id);
const tagIds = (s) => s.tags.map((t) => t.id);

test("reorderHabit — a drop takes the target's place and renumbers order", () => {
  const app = loadApp();
  try {
    const s = stateWithHabits(app, ["a", "b", "c", "d"]);

    // Dragging down lands after the target, dragging up lands before it — same as the Today/Habits lists.
    assert.equal(app.reorderHabit("a", "c"), true);
    assert.deepEqual(habitIds(s), ["b", "c", "a", "d"]);
    assert.deepEqual(s.habits.map((h) => h.order), [0, 1, 2, 3]);

    assert.equal(app.reorderHabit("d", "b"), true);
    assert.deepEqual(habitIds(s), ["d", "b", "c", "a"]);
    assert.deepEqual(s.habits.map((h) => h.order), [0, 1, 2, 3]);
  } finally {
    app.close();
  }
});

test("reorderHabit — no-op drops report false and leave the list untouched", () => {
  const app = loadApp();
  try {
    const s = stateWithHabits(app, ["a", "b", "c"]);

    assert.equal(app.reorderHabit("a", "a"), false); // dropped on itself
    assert.equal(app.reorderHabit(null, "b"), false); // nothing was being dragged
    assert.equal(app.reorderHabit("zzz", "b"), false); // dragged id no longer exists
    assert.equal(app.reorderHabit("a", "zzz"), false); // drop target no longer exists

    assert.deepEqual(habitIds(s), ["a", "b", "c"]);
    assert.deepEqual(s.habits.map((h) => h.order), [0, 1, 2]);
  } finally {
    app.close();
  }
});

test("reorderTag — moves a tag to the target's place; unknown ids and the virtual 'none' group are ignored", () => {
  const app = loadApp();
  try {
    const s = stateWithTags(app, ["t1", "t2", "t3"]);

    assert.equal(app.reorderTag("t1", "t3"), true);
    assert.deepEqual(tagIds(s), ["t2", "t3", "t1"]);

    assert.equal(app.reorderTag("t1", "t2"), true);
    assert.deepEqual(tagIds(s), ["t1", "t2", "t3"]);

    // "none" is the always-last pseudo-group for untagged habits (see tagOrderList) — never a real tag.
    assert.equal(app.reorderTag("t1", "none"), false);
    assert.equal(app.reorderTag("none", "t1"), false);
    assert.equal(app.reorderTag("t1", "t1"), false);
    assert.equal(app.reorderTag(null, "t1"), false);
    assert.deepEqual(tagIds(s), ["t1", "t2", "t3"]);
  } finally {
    app.close();
  }
});
