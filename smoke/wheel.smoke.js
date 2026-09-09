/*
 * wheel.smoke.js — das Wheel im Browser.
 *
 * wheel-state.js ist als reine Logik in test/ abgedeckt. Was dort nicht
 * geprüft werden kann, ist die Verdrahtung: dass der Schieberegler
 * tatsächlich am Zustand hängt, dass Speichern einen Neustart übersteht,
 * dass alte gespeicherte Daten beim Öffnen wirklich migriert werden — und
 * nicht nur in der Funktion, die das könnte.
 *
 *   npm run smoke
 */

"use strict";

const { test, after } = require("node:test");
const assert = require("node:assert");
const path = require("path");

const { SKIP, openPage, closeBrowser } = require("./_browser.js");
const WheelState = require("../wheel/wheel-state.js");

const PAGE = path.resolve(__dirname, "..", "wheel", "index.html");
const { STORAGE_KEY, SNAPSHOT_KEY, SEEN_KEY, AXIS_COUNT, DEFAULT_SCORE } = WheelState;

after(closeBrowser);

test("der Browser steht bereit, wo er verlangt wird", () => {
  // Lokal darf Playwright fehlen — in CI wäre ein stiller Komplettdurchfall
  // sonst grün. SMOKE_REQUIRED=1 macht daraus einen Fehlschlag.
  assert.ok(!SKIP || !process.env.SMOKE_REQUIRED, String(SKIP));
});

/** Öffnet die Seite mit bereits gesehener Einführung. */
function open(extraStorage = {}, options = {}) {
  return openPage(PAGE, {
    storage: { [SEEN_KEY]: "true", ...extraStorage },
    ...options,
  });
}

const sliderValues = (page) =>
  page.$$eval('input[type="range"][data-idx]', (inputs) => inputs.map((i) => Number(i.value)));

const shownValues = (page) =>
  page.$$eval("#sliders .slider-value", (els) => els.map((e) => Number(e.textContent)));

/** Setzt einen Schieberegler so, dass die Seite es wie eine Eingabe merkt. */
function setSlider(page, index, value) {
  return page.$eval(
    'input[type="range"][data-idx="' + index + '"]',
    (input, v) => {
      input.value = String(v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    value
  );
}

// ---------------------------------------------------------------------------
// Grundzustand
// ---------------------------------------------------------------------------

test("die Seite lädt ohne Fehler in der Konsole", { skip: SKIP }, async () => {
  const { consoleErrors, failedFiles, close } = await open();
  try {
    assert.deepStrictEqual(consoleErrors, []);
    assert.deepStrictEqual(failedFiles, []);
  } finally {
    await close();
  }
});

test("die Einführung erscheint beim ersten Besuch und merkt sich das Schliessen", { skip: SKIP }, async () => {
  const { page, close } = await openPage(PAGE);
  try {
    await page.waitForSelector("#splash.open");
    await page.click("#btn-splash-close");
    assert.strictEqual(await page.locator("#splash").evaluate((el) => el.classList.contains("open")), false);
    assert.strictEqual(await page.evaluate((k) => localStorage.getItem(k), SEEN_KEY), "true");

    await page.reload();
    assert.strictEqual(await page.locator("#splash").evaluate((el) => el.classList.contains("open")), false);
  } finally {
    await close();
  }
});

test("zwölf Bereiche, zwölf Regler, zwölf Achsen", { skip: SKIP }, async () => {
  const { page, close } = await open();
  try {
    assert.strictEqual((await sliderValues(page)).length, AXIS_COUNT);
    assert.strictEqual(await page.locator("#sliders .slider-label").count(), AXIS_COUNT);
    assert.strictEqual(await page.locator("#wheel .axis-hit").count(), AXIS_COUNT);

    const labels = await page.$$eval("#sliders .slider-label", (els) => els.map((e) => e.textContent.trim()));
    assert.ok(labels.every((l) => l.length > 3), "Bereichsnamen fehlen: " + JSON.stringify(labels));
    assert.strictEqual(new Set(labels).size, AXIS_COUNT, "Bereichsnamen doppeln sich");
  } finally {
    await close();
  }
});

test("ohne gespeicherte Daten stehen alle Bereiche auf dem Vorgabewert", { skip: SKIP }, async () => {
  const { page, close } = await open();
  try {
    assert.deepStrictEqual(await sliderValues(page), new Array(AXIS_COUNT).fill(DEFAULT_SCORE));
    assert.strictEqual(await page.locator("#avg-score").textContent(), DEFAULT_SCORE.toFixed(1));
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Eingabe und Speichern
// ---------------------------------------------------------------------------

test("ein Regler bewegt Anzeige, Durchschnitt und Rad mit", { skip: SKIP }, async () => {
  const { page, close } = await open();
  try {
    const before = await page.locator("#wheel polygon").first().getAttribute("points");
    await setSlider(page, 0, 9);

    assert.strictEqual((await shownValues(page))[0], 9);
    assert.strictEqual((await sliderValues(page))[0], 9);
    // 9 statt 5 in einem von zwölf Bereichen: 5 + 4/12 = 5,3
    assert.strictEqual(await page.locator("#avg-score").textContent(), "5.3");
    assert.notStrictEqual(await page.locator("#wheel polygon").first().getAttribute("points"), before);
  } finally {
    await close();
  }
});

test("ein nicht gespeicherter Wert ist nach dem Neuladen wieder weg", { skip: SKIP }, async () => {
  const { page, close } = await open();
  try {
    await setSlider(page, 0, 9);
    await page.reload();
    assert.strictEqual((await sliderValues(page))[0], DEFAULT_SCORE);
  } finally {
    await close();
  }
});

test("Speichern übersteht das Neuladen", { skip: SKIP }, async () => {
  const { page, close } = await open();
  try {
    await setSlider(page, 0, 9);
    await setSlider(page, 11, 2);
    await page.click("#btn-save");
    await page.waitForFunction(
      (k) => JSON.parse(localStorage.getItem(k) || "{}").scores?.[0] === 9,
      STORAGE_KEY
    );

    await page.reload();
    const scores = await sliderValues(page);
    assert.strictEqual(scores[0], 9);
    assert.strictEqual(scores[11], 2);
    assert.match(await page.locator("#last-update").textContent(), /\d/);
  } finally {
    await close();
  }
});

test("ein Snapshot landet in der Liste", { skip: SKIP }, async () => {
  const { page, close } = await open();
  try {
    assert.strictEqual(await page.locator(".snapshot-empty").count(), 1);
    await setSlider(page, 3, 8);
    await page.click("#btn-snapshot-save");

    await page.waitForSelector(".snapshot-btn");
    assert.strictEqual(await page.locator(".snapshot-btn").count(), 1);
    const stored = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), SNAPSHOT_KEY);
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].scores[3], 8);
    assert.strictEqual(stored[0].version, WheelState.SCHEMA_VERSION, "ohne Version wäre der Snapshot später nicht einzuordnen");
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Migration — der Grund, warum es diese Suite gibt
// ---------------------------------------------------------------------------

test("alt gespeicherte Werte werden beim Öffnen auf die heutigen Bereiche gelegt", { skip: SKIP }, async () => {
  // Ein Stand aus der Zeit vor den Bereichen 1..12: kein version-Feld,
  // Werte in der alten Achsen-Reihenfolge.
  const legacy = [3, 9, 1, 7, 4, 10, 2, 6, 8, 5, 9, 3];
  const expected = WheelState.migrateScores(legacy, undefined);
  assert.notDeepStrictEqual(expected, legacy, "Voraussetzung: die Migration ordnet um");

  const { page, close } = await open({
    [STORAGE_KEY]: JSON.stringify({ scores: legacy, notes: {}, lang: "de" }),
  });
  try {
    assert.deepStrictEqual(await sliderValues(page), expected);

    // Und der migrierte Stand darf beim nächsten Speichern nicht erneut wandern.
    await page.click("#btn-save");
    await page.reload();
    assert.deepStrictEqual(await sliderValues(page), expected);
  } finally {
    await close();
  }
});

test("beschädigte Daten blockieren die Seite nicht", { skip: SKIP }, async () => {
  const { page, consoleErrors, close } = await open({
    [STORAGE_KEY]: "{das ist kein JSON",
    [SNAPSHOT_KEY]: '["auch nicht"]',
  });
  try {
    assert.deepStrictEqual(consoleErrors, []);
    assert.deepStrictEqual(await sliderValues(page), new Array(AXIS_COUNT).fill(DEFAULT_SCORE));
    assert.strictEqual(await page.locator("#sliders .slider-label").count(), AXIS_COUNT);
  } finally {
    await close();
  }
});

// ---------------------------------------------------------------------------
// Sprache und Druck
// ---------------------------------------------------------------------------

test("die Sprachumschaltung tauscht den Text und merkt sich die Wahl", { skip: SKIP }, async () => {
  const { page, close } = await open({}, { locale: "de-DE" });
  try {
    assert.strictEqual((await page.locator(".sliders-title").textContent()).trim(), "Bewertung");

    await page.click('.top-bar .lang-toggle button[data-lang="en"]');
    assert.strictEqual((await page.locator(".sliders-title").textContent()).trim(), "Rating");

    await page.reload();
    assert.strictEqual((await page.locator(".sliders-title").textContent()).trim(), "Rating");
    assert.strictEqual(await page.locator("html").getAttribute("lang"), "en");
  } finally {
    await close();
  }
});

test("ein englischer Browser bekommt die Seite auf Englisch", { skip: SKIP }, async () => {
  // Ohne gespeicherte Wahl entscheidet navigator.language.
  const { page, close } = await open({}, { locale: "en-GB" });
  try {
    assert.strictEqual((await page.locator(".sliders-title").textContent()).trim(), "Rating");
    assert.strictEqual(await page.locator("html").getAttribute("lang"), "en");
  } finally {
    await close();
  }
});

test("die Druckansicht wird gebaut, bevor gedruckt wird", { skip: SKIP }, async () => {
  const { page, close } = await open(
    {},
    {
      beforeLoad: (p) =>
        p.addInitScript(() => {
          // window.print() blockiert im Browser — hier nur mitschreiben.
          window.__printCalls = 0;
          window.print = () => { window.__printCalls++; };
        }),
    }
  );
  try {
    assert.strictEqual((await page.locator("#print-output").innerHTML()).trim(), "");
    await setSlider(page, 0, 8);
    await page.click("#btn-print");

    await page.waitForFunction(() => window.__printCalls > 0);
    const printed = await page.locator("#print-output").innerText();
    assert.ok(printed.trim().length > 100, "Druckansicht ist leer geblieben");

    // Der Druckklon darf die IDs der Seite nicht verdoppeln.
    const duplicates = await page.evaluate(() => {
      const seen = new Set();
      const twice = [];
      for (const el of document.querySelectorAll("[id]")) {
        if (seen.has(el.id)) twice.push(el.id);
        seen.add(el.id);
      }
      return twice;
    });
    assert.deepStrictEqual(duplicates, []);
  } finally {
    await close();
  }
});
