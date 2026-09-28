const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

// index.html is a single classic (non-module) <script> — its top-level `function`/`const`/`let`
// declarations live in the page's shared global scope, not reimplemented or restructured here. We
// build the DOM from the real file, strip the inline script out of it, and eval that script's source
// ourselves (appending a small capture snippet to the SAME eval call — jsdom gives top-level
// const/let their own binding per separate eval(), so a second call can't see `state`/`STORE_KEY`
// from the first one) to pull out the names these tests need. Zero changes to index.html are
// required for any of this: a test failure means the shipped app's own behavior changed, not a copy
// of it.
function loadApp() {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error("index.html: could not find the inline <script> block — has its structure changed?");
  }
  const appSource = match[1];
  const htmlWithoutScript = html.replace(/<script>[\s\S]*?<\/script>/, "");

  const dom = new JSDOM(htmlWithoutScript, {
    url: "https://example.invalid/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // Must run as ONE eval, not two: jsdom's window.eval gives top-level const/let their own binding
  // per call, so a `state`/`STORE_KEY` set by an earlier eval is invisible to a later one even
  // though function declarations do carry over. Appending the capture snippet to the same source
  // keeps everything in one shared top-level scope, exactly like two <script> tags in one document.
  const capture = `
    window.__TEST__ = {
      getState: () => state,
      setState: (s) => { state = s; },
      freshState, migrate, STORE_KEY,
      missPenaltyMult, successBonusMult,
      activeQuotaOverride, effectiveWeeklyQuota, effectiveTierLabel,
    };
  `;
  window.eval(appSource + "\n" + capture);

  if (!window.__TEST__) {
    throw new Error(
      "index.html: expected top-level functions/consts were not found in scope — has the economy " +
      "engine been renamed or restructured? Update the capture list in tests/load-app.js to match."
    );
  }
  // The real app's own boot code (timers, etc.) runs along with everything else above — closing the
  // window tears those down so `node --test` can exit instead of hanging on a live jsdom window.
  return { ...window.__TEST__, close: () => window.close() };
}

module.exports = { loadApp };
