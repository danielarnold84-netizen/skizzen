"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");

const {
  lintPage,
  lintRepo,
  lintIndexCoverage,
  localReferences,
  collectIds,
  stripComments,
} = require("../tools/lint-pages.js");

const REPO_ROOT = path.resolve(__dirname, "..");

/** Minimal konforme Seite — Basis für die Negativfälle. */
function page(overrides) {
  const o = Object.assign(
    {
      lang: ' lang="de"',
      charset: '<meta charset="UTF-8">',
      viewport: '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      robots: '<meta name="robots" content="noindex,nofollow">',
      title: "<title>Skizze</title>",
      body: "",
    },
    overrides
  );
  return (
    "<!DOCTYPE html>\n<html" + o.lang + ">\n<head>\n" +
    o.charset + "\n" + o.viewport + "\n" + o.robots + "\n" + o.title +
    "\n</head>\n<body>\n" + o.body + "\n</body>\n</html>"
  );
}

const rules = (problems) => problems.map((p) => p.rule).sort();

test("eine konforme Seite wird nicht beanstandet", () => {
  assert.deepStrictEqual(lintPage(page({}), "ok.html", () => true), []);
});

test("fehlendes robots-Meta wird gemeldet", () => {
  const problems = lintPage(page({ robots: "" }), "x.html", () => true);
  assert.deepStrictEqual(rules(problems), ["noindex"]);
});

test("robots ohne nofollow reicht nicht", () => {
  const html = page({ robots: '<meta name="robots" content="noindex">' });
  assert.deepStrictEqual(rules(lintPage(html, "x.html", () => true)), ["noindex"]);
});

test("robots index,follow wird gemeldet", () => {
  const html = page({ robots: '<meta name="robots" content="index,follow">' });
  assert.deepStrictEqual(rules(lintPage(html, "x.html", () => true)), ["noindex"]);
});

test("fehlender Viewport, charset, lang und Titel werden einzeln gemeldet", () => {
  const html = page({ viewport: "", charset: "", lang: "", title: "<title>  </title>" });
  assert.deepStrictEqual(rules(lintPage(html, "x.html", () => true)), [
    "charset",
    "lang",
    "title",
    "viewport",
  ]);
});

test("target=_blank ohne rel=noopener wird gemeldet", () => {
  const html = page({ body: '<a href="https://example.com" target="_blank">x</a>' });
  assert.deepStrictEqual(rules(lintPage(html, "x.html", () => true)), ["noopener"]);
});

test("target=_blank mit rel=noopener noreferrer ist in Ordnung", () => {
  const html = page({
    body: '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>',
  });
  assert.deepStrictEqual(lintPage(html, "x.html", () => true), []);
});

test("doppelte IDs werden gemeldet", () => {
  const html = page({ body: '<div id="a"></div><div id="a"></div><div id="b"></div>' });
  const problems = lintPage(html, "x.html", () => true);
  assert.deepStrictEqual(rules(problems), ["duplicate-id"]);
  assert.match(problems[0].message, /id="a"/);
});

test("tote relative Verweise werden gemeldet, externe und Anker nicht", () => {
  const html = page({
    body:
      '<a href="fehlt/">tot</a>' +
      '<a href="https://example.com">extern</a>' +
      '<a href="#anker">anker</a>' +
      '<a href="mailto:x@y.z">mail</a>',
  });
  const problems = lintPage(html, "x.html", (ref) => ref !== "fehlt/");
  assert.deepStrictEqual(rules(problems), ["dead-link"]);
  assert.match(problems[0].message, /fehlt\//);
});

test("auskommentiertes Markup wird ignoriert", () => {
  const html = page({ body: '<!-- <a href="tot/" target="_blank">x</a> -->' });
  assert.deepStrictEqual(lintPage(html, "x.html", () => false), []);
});

test("localReferences überspringt in JS zusammengebaute URLs", () => {
  const html = "<a href=\"' + lang + '.html\">x</a><a href=\"echt.html\">y</a>";
  assert.deepStrictEqual(localReferences(html), ["echt.html"]);
});

test("collectIds findet alle IDs in Reihenfolge", () => {
  assert.deepStrictEqual(collectIds('<i id="a"><i id="b">'), ["a", "b"]);
});

test("stripComments entfernt auch mehrzeilige Kommentare", () => {
  assert.strictEqual(stripComments("a<!--\nweg\n-->b"), "ab");
});

test("nicht verlinkte Skizzen werden gemeldet", () => {
  const index = page({ body: '<a href="wheel/">Wheel</a><a href="bni/prep/">BNI</a>' });
  const problems = lintIndexCoverage(index, ["bni", "sis-ulf", "wheel"]);
  assert.deepStrictEqual(rules(problems), ["unlinked-sketch"]);
  assert.match(problems[0].message, /sis-ulf/);
});

test("./-Präfix zählt als Verlinkung", () => {
  assert.deepStrictEqual(lintIndexCoverage(page({ body: '<a href="./wheel/">W</a>' }), ["wheel"]), []);
});

// Der eigentliche Zweck: das Repo selbst muss sauber sein.
test("das Repo verletzt keine Konvention", () => {
  const { htmlFiles, problems } = lintRepo(REPO_ROOT);
  assert.ok(htmlFiles.length >= 12, "erwartet mindestens 12 Seiten, gefunden " + htmlFiles.length);
  assert.deepStrictEqual(
    problems,
    [],
    "Linter-Beanstandungen:\n" +
      problems.map((p) => "  " + p.file + " [" + p.rule + "] " + p.message).join("\n")
  );
});
