"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {
  checkPage,
  checkRepo,
  markupKeys,
  markupValues,
  switchLangs,
  objectNamed,
  parseObjectLiteral,
  braceBlock,
  inlineTags,
  localScripts,
  REPO_ROOT,
} = require("../tools/i18n-parity.js");

const wheelPath = path.join(REPO_ROOT, "wheel", "index.html");
const ulfPath = path.join(REPO_ROOT, "sis-ulf", "index.html");
const wheel = fs.readFileSync(wheelPath, "utf8");
const ulf = fs.readFileSync(ulfPath, "utf8");
const wheelState = fs.readFileSync(path.join(REPO_ROOT, "wheel", "wheel-state.js"), "utf8");

const rules = (problems) => problems.map((p) => p.rule);

/** Eine kleine zweisprachige Seite nach Art von wheel/index.html. */
function twoDictPage(overrides = {}) {
  const de = { greeting: "Hallo <b>Welt</b>", cat: { 1: "Eins", 2: "Zwei" }, ...(overrides.de || {}) };
  const en = { greeting: "Hello <b>world</b>", cat: { 1: "One", 2: "Two" }, ...(overrides.en || {}) };
  const markup = overrides.markup ?? '<span data-i18n="greeting"></span>';
  const buttons = (overrides.langs ?? ["de", "en"])
    .map((l) => '<button data-lang="' + l + '">' + l.toUpperCase() + "</button>")
    .join("");
  return (
    "<html><body>" + buttons + markup + "<script>\nconst I18N = " +
    JSON.stringify({ de, en }, null, 2) +
    ";\nconsole.log(dict.cat[1]);\n</script></body></html>"
  );
}

// ---------------------------------------------------------------------------
// Das echte Repo
// ---------------------------------------------------------------------------

test("die zweisprachigen Seiten sind vollständig übersetzt", () => {
  const { pages, problems } = checkRepo(REPO_ROOT);
  assert.deepStrictEqual(
    problems,
    [],
    "Lücken:\n" + problems.map((p) => "  [" + p.rule + "] " + p.message).join("\n")
  );
  assert.deepStrictEqual(
    pages.map((f) => path.relative(REPO_ROOT, f)).sort(),
    ["sis-ulf/index.html", "wheel/index.html"]
  );
});

test("das Wheel-Wörterbuch hat in beiden Sprachen dieselbe Form", () => {
  const I18N = objectNamed(wheel, "I18N").value;
  assert.deepStrictEqual(Object.keys(I18N), ["de", "en"]);
  assert.deepStrictEqual(Object.keys(I18N.de).sort(), Object.keys(I18N.en).sort());
  for (const lang of ["de", "en"]) {
    assert.strictEqual(Object.keys(I18N[lang].cat).length, 12, lang + ".cat");
    assert.strictEqual(Object.keys(I18N[lang].catShort).length, 12, lang + ".catShort");
    assert.strictEqual(Object.keys(I18N[lang].statements).length, 12, lang + ".statements");
    for (const [n, list] of Object.entries(I18N[lang].statements)) {
      assert.strictEqual(list.length, 5, lang + ".statements." + n);
    }
  }
});

test("Schlüssel, die erst in wheel-state.js entstehen, gelten als benutzt", () => {
  // insightDiffSmall/-Large/-Same baut insightDiffKey() zusammen.
  assert.ok(wheelState.includes("insightDiffLarge"));
  assert.ok(!wheel.slice(0, wheel.indexOf("const I18N")).includes("insightDiffLarge"));
  assert.deepStrictEqual(rules(checkPage(wheel, "wheel", wheelState)), []);
  const withoutCompanion = rules(checkPage(wheel, "wheel", ""));
  assert.ok(withoutCompanion.includes("i18n-key-unused"), "ohne das Skript fehlt der Nachweis");
});

test("das eingebundene Skript wird gefunden", () => {
  const found = localScripts(wheel, path.join(REPO_ROOT, "wheel")).map((f) => path.basename(f));
  assert.deepStrictEqual(found, ["wheel-state.js"]);
});

test("sis-ulf hat für jeden Baustein eine Übersetzung", () => {
  const keys = markupKeys(ulf);
  const en = objectNamed(ulf, "EN").value;
  assert.strictEqual(keys.length, 37);
  assert.deepStrictEqual(keys.slice().sort(), Object.keys(en).sort());
  assert.deepStrictEqual(switchLangs(ulf), ["de", "en"]);
});

// ---------------------------------------------------------------------------
// Der Literal-Leser
// ---------------------------------------------------------------------------

test("geschweifte Klammern in Strings zählen nicht mit", () => {
  const src = 'const X = { a: "}{", b: 1 };';
  assert.strictEqual(braceBlock(src, src.indexOf("{")), '{ a: "}{", b: 1 }');
});

test("ausführbares Literal wird nicht ausgewertet", () => {
  assert.strictEqual(parseObjectLiteral("{ a: fetch('/x') }"), null);
  assert.strictEqual(parseObjectLiteral("{ a: () => 1 }"), null);
  assert.strictEqual(parseObjectLiteral("{ a: require('fs') }"), null);
  assert.strictEqual(parseObjectLiteral("{ a: new Date() }"), null);
});

test("Klammern im Text sind harmlos", () => {
  assert.deepStrictEqual(parseObjectLiteral("{ a: 'Trag ein (edit) ein' }"), { a: "Trag ein (edit) ein" });
});

test("Auszeichnung wird ohne den Text verglichen", () => {
  assert.deepStrictEqual(inlineTags("Ein <b>Wort</b><br>"), inlineTags("<br>A <b>word</b>"));
});

test("mehrfach verwendete Schlüssel liefern einen Wert", () => {
  const values = markupValues('<a data-i18n="k">auf</a><a data-i18n="k">zu</a>');
  assert.deepStrictEqual([...values.keys()], ["k"]);
  assert.strictEqual(values.get("k"), "auf");
});

// ---------------------------------------------------------------------------
// Die Regeln selbst — Form A (ein Wörterbuch je Sprache)
// ---------------------------------------------------------------------------

test("eine leere Seite ohne data-i18n wird durchgewinkt", () => {
  assert.deepStrictEqual(checkPage("<html><body><p>Nur Deutsch</p></body></html>", "x"), []);
});

test("ein nur auf Deutsch ergänzter Eintrag wird gemeldet", () => {
  const page = twoDictPage({ de: { neu: "Neu" } });
  const problems = checkPage(page, "x");
  assert.ok(rules(problems).includes("i18n-lang-parity"));
  assert.ok(problems.some((p) => /neu/.test(p.message)));
});

test("eine fehlende Aussage in einer Sprache wird gemeldet", () => {
  const page = twoDictPage({
    de: { statements: { 1: ["a", "b", "c", "d", "e"] } },
    en: { statements: { 1: ["a", "b", "c", "d"] } },
  });
  const problems = checkPage(page, "x");
  assert.ok(rules(problems).includes("i18n-nested"));
  assert.ok(problems.some((p) => /statements\.1/.test(p.message)));
});

test("ein fehlender Bereich wird gemeldet", () => {
  const page = twoDictPage({ en: { cat: { 1: "One" } } });
  const problems = checkPage(page, "x");
  assert.ok(rules(problems).includes("i18n-nested"));
  assert.ok(problems.some((p) => /^x: cat: /.test(p.message)));
});

test("verlorene Auszeichnung in der Übersetzung wird gemeldet", () => {
  const page = twoDictPage({ en: { greeting: "Hello world" } });
  const problems = checkPage(page, "x");
  assert.ok(rules(problems).includes("i18n-markup"));
  assert.ok(problems.some((p) => /greeting/.test(p.message)));
});

test("ein Markup-Schlüssel ohne Wörterbucheintrag wird gemeldet", () => {
  const page = twoDictPage({ markup: '<span data-i18n="greeting"></span><span data-i18n="fehlt"></span>' });
  const problems = checkPage(page, "x");
  assert.ok(rules(problems).includes("i18n-key-missing"));
  assert.strictEqual(problems.filter((p) => p.rule === "i18n-key-missing").length, 2, "de und en");
});

test("ein toter Wörterbucheintrag wird gemeldet", () => {
  const page = twoDictPage({ de: { verwaist: "x" }, en: { verwaist: "y" } });
  const problems = checkPage(page, "x");
  assert.ok(rules(problems).includes("i18n-key-unused"));
  assert.ok(problems.some((p) => /verwaist/.test(p.message)));
});

test("eine Schaltfläche ohne Wörterbuch wird gemeldet", () => {
  const page = twoDictPage({ langs: ["de", "en", "fr"] });
  const problems = checkPage(page, "x");
  assert.ok(rules(problems).includes("i18n-switch"));
  assert.ok(problems.some((p) => /fr/.test(p.message)));
});

test("data-i18n ohne Wörterbuch wird gemeldet", () => {
  const problems = checkPage('<span data-i18n="a"></span>', "x");
  assert.deepStrictEqual(rules(problems), ["i18n-dict"]);
});

// ---------------------------------------------------------------------------
// Die Regeln selbst — Form B (Deutsch im Markup, EN legt sich darüber)
// ---------------------------------------------------------------------------

test("eine fehlende Übersetzung in sis-ulf wird gemeldet", () => {
  const broken = ulf.replace(/\n    p_stuck: "[^"]*",/, "");
  assert.notStrictEqual(broken, ulf, "Voraussetzung: Eintrag gefunden");
  const problems = checkPage(broken, "sis-ulf");
  assert.ok(rules(problems).includes("i18n-key-missing"));
  assert.ok(problems.some((p) => /p_stuck/.test(p.message)));
});

test("eine überflüssige Übersetzung in sis-ulf wird gemeldet", () => {
  const broken = ulf.replace('  var EN = {\n', '  var EN = {\n    veraltet: "gone",\n');
  assert.notStrictEqual(broken, ulf, "Voraussetzung: Wörterbuch gefunden");
  const problems = checkPage(broken, "sis-ulf");
  assert.ok(rules(problems).includes("i18n-key-unused"));
  assert.ok(problems.some((p) => /veraltet/.test(p.message)));
});

test("verlorene Auszeichnung in sis-ulf wird gemeldet", () => {
  const broken = ulf.replace(
    'step1: "<b>Open the cockpit</b> — get the overview in the Executive Overview.",',
    'step1: "Open the cockpit — get the overview in the Executive Overview.",'
  );
  assert.notStrictEqual(broken, ulf, "Voraussetzung: Eintrag gefunden");
  const problems = checkPage(broken, "sis-ulf");
  assert.ok(rules(problems).includes("i18n-markup"));
  assert.ok(problems.some((p) => /step1/.test(p.message)));
});
