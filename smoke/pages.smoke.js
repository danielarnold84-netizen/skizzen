/*
 * pages.smoke.js — jede Seite muss sich öffnen lassen.
 *
 * Der Linter liest das Markup, kann aber nicht wissen, ob das Skript einer
 * Seite beim Laden über einen Tippfehler stolpert. Genau das prüft dieser
 * Lauf: alle Seiten im Repo einmal öffnen und zusehen, ob etwas bricht.
 *
 *   npm run smoke
 */

"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");

const { SKIP, openPage, closeBrowser } = require("./_browser.js");
const { findHtmlFiles } = require("../tools/lint-pages.js");

const REPO_ROOT = path.resolve(__dirname, "..");
const pages = findHtmlFiles(REPO_ROOT).map((file) => path.relative(REPO_ROOT, file)).sort();

after(closeBrowser);

test("der Browser steht bereit, wo er verlangt wird", () => {
  // Lokal darf Playwright fehlen — in CI wäre ein stiller Komplettdurchfall
  // sonst grün. SMOKE_REQUIRED=1 macht daraus einen Fehlschlag.
  assert.ok(!SKIP || !process.env.SMOKE_REQUIRED, String(SKIP));
});

test("es gibt Seiten zu prüfen", () => {
  assert.ok(pages.length >= 12, "nur " + pages.length + " Seiten gefunden");
  assert.ok(pages.includes("index.html"));
  assert.ok(pages.includes("wheel/index.html"));
});

for (const relative of pages) {
  test(relative + " lädt fehlerfrei", { skip: SKIP }, async () => {
    const { page, consoleErrors, failedFiles, close } = await openPage(path.join(REPO_ROOT, relative));
    try {
      assert.deepStrictEqual(consoleErrors, [], relative + ": Konsolenfehler");
      assert.deepStrictEqual(failedFiles, [], relative + ": fehlende Dateien");

      assert.match(await page.title(), /\S/, relative + ": leerer Titel");

      // Eine Seite, die aussteigt, bevor sie etwas rendert, sieht im Markup
      // heil aus — sichtbarer Text ist der einfachste Gegenbeweis.
      const text = await page.locator("body").innerText();
      assert.ok(text.trim().length > 200, relative + ": kaum sichtbarer Text (" + text.trim().length + " Zeichen)");
    } finally {
      await close();
    }
  });
}
