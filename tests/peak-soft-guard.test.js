const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app.js");

// A device with no Fullscreen API (iPhone Safari) cannot be locked into full screen. There the fair-play
// protection is leaving the app: hiding the page loses the game, but blur and window focus are not used (on
// iOS they also fire for things that are not cheating). A device WITH the API keeps the full rules.
// jsdom has no Fullscreen API, so it is a "soft" device until a test gives it one.

const bank = () => {
  const b = [];
  for (let l = 1; l <= 15; l++) b.push({ id: "r" + l, level: l, category: "c" + (l % 9), q: "Q" + l, options: ["a", "b", "c", "d"], correct: l % 4, explanation: "E" + l });
  return b;
};

function setup(app) {
  const s = app.freshState();
  s.habits = [{ id: "h1", name: "h1", weight: 119, order: 0, tagId: null }];
  app.setState(s);
  app.recalcPoints();
  const ui = app.peakUi;
  ui.bank = bank(); ui.bankLang = s.lang || "ru"; ui.dnd = true; ui.practice = false;
  return { s, ui, doc: app.getDocument() };
}
const hasFocus = (doc, v) => { doc.hasFocus = () => v; };
const hidden = (doc, v) => Object.defineProperty(doc, "hidden", { configurable: true, get: () => v });
const fullscreen = (doc, el) => Object.defineProperty(doc, "fullscreenElement", { configurable: true, get: () => el });
// give the page the Fullscreen API, as a desktop browser or Android Chrome has
const withFullscreenApi = (doc) => { doc.documentElement.requestFullscreen = () => Promise.resolve(); };

// a real game already running on question 2
function running(app, ui) {
  assert.ok(app.peakStartGame(), "the game starts");
  ui.mode = "play";
  ui.game = app.peakNewGame(bank(), () => 0.5);
  ui.game.level = 2;
}

test("no Fullscreen API: a real game can start without full screen or window focus", () => {
  const app = loadApp();
  try {
    const { doc } = setup(app);
    assert.equal(app.peakSoft(), true);
    hasFocus(doc, false);
    assert.equal(app.peakCanStart(), true);
    hidden(doc, true);
    assert.equal(app.peakCanStart(), false, "but never while the page is hidden");
  } finally { app.close(); }
});

test("with the Fullscreen API: starting still needs window focus and full screen", () => {
  const app = loadApp();
  try {
    const { doc } = setup(app);
    withFullscreenApi(doc);
    assert.equal(app.peakSoft(), false);
    hasFocus(doc, true); fullscreen(doc, null);
    assert.equal(app.peakCanStart(), false, "not in full screen");
    fullscreen(doc, doc.documentElement); hasFocus(doc, false);
    assert.equal(app.peakCanStart(), false, "window not in focus");
    hasFocus(doc, true);
    assert.equal(app.peakCanStart(), true);
  } finally { app.close(); }
});

test("no Fullscreen API: losing window focus does not end a real game", () => {
  const app = loadApp();
  try {
    const { s, ui, doc } = setup(app);
    running(app, ui);
    hasFocus(doc, false);
    app.peakCheckGuard();
    assert.equal(ui.mode, "play", "still playing");
    assert.ok(s.peak.active, "the stored game is still active");
  } finally { app.close(); }
});

test("no Fullscreen API: hiding the page (switching tab or app) loses the game", () => {
  const app = loadApp();
  try {
    const { s, ui, doc } = setup(app);
    running(app, ui);
    hidden(doc, true);
    app.peakCheckGuard();
    assert.equal(ui.mode, "violation");
    assert.equal(ui.reason, "hidden");
    assert.equal(s.peak.active, null);
    assert.equal(s.peak.games.length, 1);
    assert.equal(s.peak.games[0].end, "violation");
    assert.equal(s.peak.games[0].payoutInli, 0, "no payout");
  } finally { app.close(); }
});

test("with the Fullscreen API: losing focus or leaving full screen still loses the game", () => {
  for (const [label, breach] of [["blur", (doc) => hasFocus(doc, false)], ["fullscreen", (doc) => fullscreen(doc, null)]]) {
    const app = loadApp();
    try {
      const { s, ui, doc } = setup(app);
      withFullscreenApi(doc);
      hasFocus(doc, true); fullscreen(doc, doc.documentElement);
      running(app, ui);
      app.peakCheckGuard();
      assert.equal(ui.mode, "play", label + ": fine while the rules hold");
      breach(doc);
      app.peakCheckGuard();
      assert.equal(ui.mode, "violation", label + " ends the game");
      assert.equal(ui.reason, label);
      assert.equal(s.peak.games[0].end, "violation");
    } finally { app.close(); }
  }
});

test("the start screen on a device without the Fullscreen API: protection line satisfied, real start allowed", () => {
  const app = loadApp();
  try {
    const { doc } = setup(app);
    hasFocus(doc, false);
    const html = app.peakGateHTML();
    assert.match(html, /<li class="ok"><i>✓<\/i>Полный экран на этом устройстве недоступен — выход из приложения/, "the line explains the protection and counts as met");
    assert.doesNotMatch(html, /<li class="wait"><i>!<\/i>Полный экран/, "no warning about full screen");
    assert.match(html, /data-pk="start" >/, "the real start button is enabled");
  } finally { app.close(); }
});

test("the start screen with the Fullscreen API keeps the full-screen step and blocks the start until it is on", () => {
  const app = loadApp();
  try {
    const { doc } = setup(app);
    withFullscreenApi(doc);
    hasFocus(doc, true); fullscreen(doc, null);
    const html = app.peakGateHTML();
    assert.match(html, /data-pk="fs"/, "the button to enter full screen");
    assert.match(html, /data-pk="start" disabled>/, "start is disabled");
  } finally { app.close(); }
});

test("the violation screen states the rule that applies to the device", () => {
  const app = loadApp();
  try {
    const { ui, doc } = setup(app);
    ui.reason = "hidden";
    assert.match(app.peakViolationHTML(), /нельзя выходить из приложения/, "soft device: leaving the app");
    withFullscreenApi(doc);
    const normal = app.peakViolationHTML();
    assert.match(normal, /на весь экран/, "full-screen device: the full-screen rule");
    assert.doesNotMatch(normal, /нельзя выходить из приложения/);
  } finally { app.close(); }
});
