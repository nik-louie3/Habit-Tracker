const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const CATEGORIES = ["science", "geography", "history", "literature", "art", "music", "film", "sport", "food", "health", "tech", "daily", "language", "society"];
const MIN_PER_LEVEL = 30;
const LANGS = ["ru", "en", "es", "zh", "fr"];

const load = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "peak", `questions.${lang}.json`), "utf8"));
const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

for (const lang of LANGS) {
  test(`bank ${lang} — every record has the full schema and sane lengths`, () => {
    const bank = load(lang);
    assert.ok(Array.isArray(bank) && bank.length > 0);
    const ids = new Set();
    for (const q of bank) {
      assert.deepEqual(Object.keys(q).sort(), ["category", "correct", "explanation", "id", "level", "options", "q"]);
      assert.match(q.id, /^p\d{4,}$/);
      assert.ok(!ids.has(q.id), "duplicate id " + q.id);
      ids.add(q.id);
      assert.ok(Number.isInteger(q.level) && q.level >= 1 && q.level <= 15, q.id);
      assert.ok(CATEGORIES.includes(q.category), q.id + " category " + q.category);
      assert.ok(typeof q.q === "string" && q.q.trim().length > 5 && q.q.length <= 200, q.id);
      assert.ok(Array.isArray(q.options) && q.options.length === 4, q.id);
      assert.ok(q.options.every((o) => typeof o === "string" && o.trim() && o.length <= 60), q.id + " option length");
      assert.equal(new Set(q.options.map(norm)).size, 4, q.id + " options must differ");
      assert.ok(Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3, q.id);
      assert.ok(typeof q.explanation === "string" && q.explanation.trim().length > 5, q.id + " needs an explanation");
    }
  });

  test(`bank ${lang} — levels are contiguous from 1, ≥${MIN_PER_LEVEL} each, varied, no repeated questions`, () => {
    const bank = load(lang);
    const levels = [...new Set(bank.map((q) => q.level))].sort((a, b) => a - b);
    assert.deepEqual(levels, Array.from({ length: levels.length }, (_, i) => i + 1), "levels must start at 1 with no gaps");
    for (const l of levels) {
      const at = bank.filter((q) => q.level === l);
      assert.ok(at.length >= MIN_PER_LEVEL, `level ${l} has ${at.length}`);
      const cats = {};
      at.forEach((q) => { cats[q.category] = (cats[q.category] || 0) + 1; });
      assert.ok(Object.keys(cats).length >= 8, `level ${l} categories ${Object.keys(cats).length}`);
      assert.ok(Math.max(...Object.values(cats)) <= 6, `level ${l} is dominated by one category`);
    }
    assert.equal(new Set(bank.map((q) => norm(q.q))).size, bank.length, "repeated question text");
    // the right answer must not sit in one position
    const pos = [0, 0, 0, 0];
    bank.forEach((q) => pos[q.correct]++);
    pos.forEach((n) => assert.ok(n / bank.length >= 0.15 && n / bank.length <= 0.35, "correct-position balance " + pos));
  });
}

test("every language describes the same questions as en: ids, levels, categories and the right answer match", () => {
  const en = load("en");
  for (const lang of LANGS.filter((l) => l !== "en")) {
    const bank = load(lang);
    assert.equal(bank.length, en.length, lang + " length");
    bank.forEach((q, i) => {
      assert.deepEqual([q.id, q.level, q.category, q.correct], [en[i].id, en[i].level, en[i].category, en[i].correct], lang + " " + en[i].id);
    });
  }
});

test("each language is written in its own script", () => {
  const cyr = /[А-Яа-яЁё]/;
  load("ru").forEach((q) => assert.ok(cyr.test(q.q), q.id + " ru question"));
  const cjk = /[\u3400-\u9fff]/;
  const text = (q) => q.q + q.options.join("") + q.explanation;
  for (const lang of ["en", "es", "fr"]) load(lang).forEach((q) => assert.ok(!cyr.test(text(q)) && !cjk.test(text(q)), q.id + " " + lang + " has foreign script"));
  load("zh").forEach((q) => assert.ok(cjk.test(q.q) && !cyr.test(text(q)), q.id + " zh question"));
  // a translation must really differ from the English source (catches a copied file)
  const en = load("en");
  for (const lang of ["es", "zh", "fr"]) assert.ok(load(lang).filter((q, i) => q.q === en[i].q).length < 10, lang + " looks untranslated");
});
