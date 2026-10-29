const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app.js");

// The Peak INLI tab is for everyone: it used to be hidden unless localStorage.peakDev was "1".

const peakTab = (app) => app.getDocument().querySelector('.tab[data-view="peak"]');

test("the Peak tab is visible with no flag set", () => {
  const app = loadApp();
  try {
    const tab = peakTab(app);
    assert.ok(tab, "the tab exists");
    assert.notEqual(tab.style.display, "none", "and is not hidden");
    assert.equal(app.getDocument().defaultView.localStorage.getItem("peakDev"), null, "no dev flag is involved");
  } finally { app.close(); }
});

test("a stale dev flag value changes nothing", () => {
  const app = loadApp();
  try {
    app.getDocument().defaultView.localStorage.setItem("peakDev", "0");
    assert.notEqual(peakTab(app).style.display, "none");
  } finally { app.close(); }
});

test("the tab sits among the others and carries its own label", () => {
  const app = loadApp();
  try {
    const views = [...app.getDocument().querySelectorAll(".tab")].map((t) => t.dataset.view);
    assert.deepEqual(views, ["today", "track", "habits", "rewards", "casino", "peak", "stats", "settings"]);
    assert.match(peakTab(app).textContent, /Пик|Peak/, "named in the app's language");
    assert.ok(peakTab(app).textContent.startsWith("▲"), "with the peak icon");
  } finally { app.close(); }
});
