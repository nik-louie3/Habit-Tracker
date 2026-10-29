const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const CATEGORIES = ["science", "geography", "history", "literature", "art", "music", "film", "sport", "food", "health", "tech", "daily", "language", "society"];
// Each language has its OWN bank with a regional flavour (en: US/UK, ru: Russia, es: Spain + Latin America,
// zh: China, fr: France + francophone world), so the banks are not translations of one another.
// The minimum per level is raised language by language as each bank reaches its target of 100.
const MIN_PER_LEVEL = { ru: 30, en: 25, es: 25, zh: 25, fr: 25 };
const PREFIX = { ru: "r", en: "e", es: "s", zh: "z", fr: "f" };
const LANGS = Object.keys(PREFIX);

const load = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "peak", `questions.${lang}.json`), "utf8"));
const norm = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();

for (const lang of LANGS) {
  test(`bank ${lang} — every record has the full schema and sane lengths`, () => {
    const bank = load(lang);
    assert.ok(Array.isArray(bank) && bank.length > 0);
    const ids = new Set();
    for (const q of bank) {
      assert.deepEqual(Object.keys(q).sort(), ["category", "correct", "explanation", "id", "level", "options", "q"]);
      assert.match(q.id, new RegExp(`^${PREFIX[lang]}\\d{5,}$`), q.id + " id prefix for " + lang);
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

  test(`bank ${lang} — levels are contiguous from 1, ≥${MIN_PER_LEVEL[lang]} each, varied, no repeated questions`, () => {
    const bank = load(lang);
    const levels = [...new Set(bank.map((q) => q.level))].sort((a, b) => a - b);
    assert.deepEqual(levels, Array.from({ length: levels.length }, (_, i) => i + 1), "levels must start at 1 with no gaps");
    for (const l of levels) {
      const at = bank.filter((q) => q.level === l);
      assert.ok(at.length >= MIN_PER_LEVEL[lang], `level ${l} has ${at.length}`);
      const cats = {};
      at.forEach((q) => { cats[q.category] = (cats[q.category] || 0) + 1; });
      assert.ok(Object.keys(cats).length >= 10, `level ${l} categories ${Object.keys(cats).length}`);
      assert.ok(Math.max(...Object.values(cats)) <= Math.max(6, Math.ceil(at.length / 8)), `level ${l} is dominated by one category`);
    }
    assert.equal(new Set(bank.map((q) => norm(q.q))).size, bank.length, "repeated question text");
    // the right answer must not sit in one position
    const pos = [0, 0, 0, 0];
    bank.forEach((q) => pos[q.correct]++);
    pos.forEach((n) => assert.ok(n / bank.length >= 0.15 && n / bank.length <= 0.35, "correct-position balance " + pos));
  });
}

// The same fact asked twice in different words is the commonest authoring slip: flag two questions that
// share the right answer AND most of their wording.
test("no two questions in a bank are the same question in other words", () => {
  const words = (t) => new Set(norm(t).replace(/[^\p{L}\p{N} ]/gu, "").split(" ").filter((w) => w.length > 2));
  for (const lang of LANGS) {
    const byAnswer = new Map();
    for (const q of load(lang)) {
      const a = norm(q.options[q.correct]);
      if (!byAnswer.has(a)) byAnswer.set(a, []);
      byAnswer.get(a).push(q);
    }
    for (const [a, qs] of byAnswer) {
      for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) {
        const x = words(qs[i].q), y = words(qs[j].q);
        const inter = [...x].filter((w) => y.has(w)).length, uni = new Set([...x, ...y]).size || 1;
        assert.ok(inter / uni < 0.8, `${lang} ${qs[i].id} and ${qs[j].id} look like the same question (answer «${a}»)`);
      }
    }
  }
});

test("each language is written in its own script", () => {
  const cyr = /[А-Яа-яЁё]/;
  const cjk = /[\u3400-\u9fff]/;
  const text = (q) => q.q + q.options.join("") + q.explanation;
  load("ru").forEach((q) => assert.ok(cyr.test(q.q), q.id + " ru question"));
  for (const lang of ["en", "es", "fr"]) load(lang).forEach((q) => assert.ok(!cyr.test(text(q)) && !cjk.test(text(q)), q.id + " " + lang + " has foreign script"));
  load("zh").forEach((q) => assert.ok(cjk.test(q.q) && !cyr.test(text(q)), q.id + " zh question"));
});
