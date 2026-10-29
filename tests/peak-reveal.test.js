const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./load-app.js");

// The engine (peakAnswer) moves a game to the next question the instant a right answer is confirmed,
// but the screen still has to show the question that was just answered through the verdict pause.
// These tests drive the real confirm flow and read what the screen would draw.

const bank = () => {
  const b = [];
  for (let l = 1; l <= 15; l++) b.push({ id: "r" + l, level: l, category: "c" + (l % 9), q: "Question " + l + "?", options: ["alpha" + l, "beta" + l, "gamma" + l, "delta" + l], correct: l % 4, explanation: "E" + l });
  return b;
};

// A practice game (no stored game, no monthly limit) already on question 1, with the bank preloaded so
// the screen never tries to fetch one (jsdom has no fetch).
function startPractice(app) {
  const s = app.freshState();
  s.habits = [{ id: "h1", name: "h1", weight: 119, order: 0, tagId: null }];
  app.setState(s);
  const ui = app.peakUi;
  ui.bank = bank();
  ui.bankLang = s.lang || "ru";
  ui.practice = true;
  ui.picks = {};
  ui.game = app.peakNewGame(bank(), () => 0.5);
  app.peakAskNext();
  return ui;
}

const markedOption = (html) => {
  const m = html.match(/<button class="pk-opt pk-hex (sel|ok|bad)[^"]*"[^>]*>.*?<span>([^<]*)<\/span>/);
  return m ? { cls: m[1], text: m[2] } : null;
};

test("after a right answer the verdict pause still shows the question that was answered", () => {
  const app = loadApp();
  try {
    const ui = startPractice(app);
    const g = ui.game;
    ui.sel = g.qs[0].correct; // pick the right answer to question 1 and confirm it
    app.peakConfirm();

    assert.equal(g.level, 2, "the engine has already advanced — that is what the screen must not follow");
    assert.equal(ui.mode, "reveal");
    const html = app.peakPlayHTML();
    assert.match(html, /<span>Question 1\?<\/span>/, "the screen still shows the answered question");
    assert.doesNotMatch(html, /Question 2\?/, "the next question must not be on screen yet");
    const answered = g.qs[0].options[g.qs[0].correct];
    assert.deepEqual(markedOption(html), { cls: "sel", text: answered },
      "suspense beat: the answer given to question 1 is highlighted, not an option of question 2");
    assert.match(html, /<li class="cur"><em>1<\/em>/, "the ladder has not moved on yet");

    // the verdict (what the timer calls after the beat) still draws question 1, now marked right
    app.peakReveal({ result: "right", reached: 1 }, "answer");
    const verdict = app.peakPlayHTML();
    assert.match(verdict, /<span>Question 1\?<\/span>/);
    assert.deepEqual(markedOption(verdict), { cls: "ok", text: answered });
  } finally { app.close(); }
});

test("the next question appears with a fresh, unmarked screen once the pause is over", () => {
  const app = loadApp();
  try {
    const ui = startPractice(app);
    ui.sel = ui.game.qs[0].correct;
    app.peakConfirm();
    app.peakAskNext(); // what the verdict timer does after the pause

    assert.equal(ui.mode, "play");
    const html = app.peakPlayHTML();
    assert.match(html, /<span>Question 2\?<\/span>/);
    assert.doesNotMatch(html, /Question 1\?/);
    assert.equal(markedOption(html), null, "nothing is pre-selected on the new question");
  } finally { app.close(); }
});

test("a wrong answer is still revealed on the question it was given to", () => {
  const app = loadApp();
  try {
    const ui = startPractice(app);
    const g = ui.game, q = g.qs[0];
    const wrong = [0, 1, 2, 3].find((i) => i !== q.correct);
    ui.sel = wrong;
    app.peakConfirm();

    assert.equal(g.level, 1, "a miss does not advance the game");
    const html = app.peakPlayHTML();
    assert.match(html, /<span>Question 1\?<\/span>/);
    assert.equal(g.over, true);
  } finally { app.close(); }
});
