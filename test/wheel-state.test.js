"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const W = require("../wheel/wheel-state.js");

const {
  AXES,
  LEGACY_AXES_N_V2,
  SCHEMA_VERSION,
  DEFAULT_SCORE,
  MAX_SNAPSHOTS,
  STEPS,
  WHEEL,
} = W;

/**
 * Feste, gültige Punktzahl je Bereich (1..10 — Bereichsnummern selbst taugen
 * nicht als Werte, 11 und 12 lägen ausserhalb der Skala).
 */
const scoreFor = (n) => ((n * 7) % 10) + 1;

/** Werte in heutiger Reihenfolge: Position i trägt den Wert für AXES[i].n. */
const scoresByCategory = () => AXES.map((a) => scoreFor(a.n));

/** Dieselben Werte, aber in der alten Achsen-Reihenfolge abgelegt. */
const legacyScores = () => LEGACY_AXES_N_V2.map(scoreFor);

const BEFORE_V3 = "2026-04-29T10:00:00.000Z";
const AFTER_V3 = "2026-05-02T09:00:00.000Z";

// =====================================================
// clampScore / normalizeScores
// =====================================================

test("clampScore hält Werte im Bereich 1..10", () => {
  assert.strictEqual(W.clampScore(1), 1);
  assert.strictEqual(W.clampScore(10), 10);
  assert.strictEqual(W.clampScore(11), 10);
  assert.strictEqual(W.clampScore(-4), 1);
});

test("clampScore rundet Kommawerte auf ganze Punkte", () => {
  assert.strictEqual(W.clampScore(7.4), 7);
  assert.strictEqual(W.clampScore(7.5), 8);
});

test("clampScore macht aus einer gespeicherten 0 die 1, nicht die 5", () => {
  // Der alte Ausdruck Number(s) || 5 sprang bei 0 in die Mitte der Skala.
  assert.strictEqual(W.clampScore(0), 1);
  assert.strictEqual(W.clampScore("0"), 1);
});

test("clampScore fällt bei unlesbaren Werten auf den Startwert zurück", () => {
  for (const bad of [NaN, undefined, null, "", "abc", {}, Infinity]) {
    assert.strictEqual(W.clampScore(bad), DEFAULT_SCORE, "für " + String(bad));
  }
});

test("clampScore liest numerische Strings", () => {
  assert.strictEqual(W.clampScore("8"), 8);
});

test("normalizeScores liefert immer genau 12 gültige Werte", () => {
  assert.deepStrictEqual(W.normalizeScores([]), AXES.map(() => DEFAULT_SCORE));
  assert.deepStrictEqual(W.normalizeScores(null), AXES.map(() => DEFAULT_SCORE));
  assert.strictEqual(W.normalizeScores([1, 2, 3]).length, 12);
  assert.strictEqual(W.normalizeScores(new Array(30).fill(3)).length, 12);
});

// =====================================================
// Migration der Hauptwerte
// =====================================================

test("Migration legt alte Achsenwerte auf die richtigen Bereiche", () => {
  assert.deepStrictEqual(W.migrateScores(legacyScores(), undefined), scoresByCategory());
});

test("Migration greift auch bei version 1 und 2", () => {
  assert.deepStrictEqual(W.migrateScores(legacyScores(), 1), scoresByCategory());
  assert.deepStrictEqual(W.migrateScores(legacyScores(), 2), scoresByCategory());
});

test("Migration lässt bereits migrierte Daten unangetastet", () => {
  const current = scoresByCategory();
  assert.deepStrictEqual(W.migrateScores(current, SCHEMA_VERSION), current);
  assert.deepStrictEqual(W.migrateScores(current, 4), current);
});

test("Migration ist idempotent — zweimal laufen verdreht nichts", () => {
  const once = W.migrateScores(legacyScores(), 2);
  const twice = W.migrateScores(once, SCHEMA_VERSION);
  assert.deepStrictEqual(twice, once);
});

test("Migration ist eine Permutation — kein Wert geht verloren", () => {
  const migrated = W.migrateScores(legacyScores(), 2);
  assert.deepStrictEqual(
    migrated.slice().sort((a, b) => a - b),
    legacyScores().sort((a, b) => a - b)
  );
});

test("die alte Achsenliste deckt alle zwölf Bereiche genau einmal ab", () => {
  assert.deepStrictEqual(
    LEGACY_AXES_N_V2.slice().sort((a, b) => a - b),
    AXES.map((a) => a.n)
  );
});

// =====================================================
// parseStoredState
// =====================================================

test("ohne gespeicherte Daten kommen Startwerte", () => {
  const state = W.parseStoredState(null, "de-DE");
  assert.deepStrictEqual(state.scores, AXES.map(() => DEFAULT_SCORE));
  assert.deepStrictEqual(state.notes, {});
  assert.strictEqual(state.date, null);
});

test("Sprache kommt beim ersten Besuch vom Browser", () => {
  assert.strictEqual(W.parseStoredState(null, "en-GB").lang, "en");
  assert.strictEqual(W.parseStoredState(null, "de-AT").lang, "de");
  assert.strictEqual(W.parseStoredState(null, "fr-FR").lang, "de");
  assert.strictEqual(W.parseStoredState(null, undefined).lang, "de");
});

test("kaputtes JSON blockiert die Seite nicht", () => {
  for (const raw of ["{", "nicht json", "[1,2,3", '{"scores":'])
    assert.deepStrictEqual(
      W.parseStoredState(raw, "de").scores,
      AXES.map(() => DEFAULT_SCORE)
    );
});

test("JSON, das kein Objekt ist, wird abgewiesen", () => {
  for (const raw of ["null", "42", '"text"', "[1,2,3]"]) {
    const state = W.parseStoredState(raw, "de");
    assert.deepStrictEqual(state.scores, AXES.map(() => DEFAULT_SCORE));
    assert.deepStrictEqual(state.notes, {});
  }
});

test("Werte falscher Länge werden verworfen statt halb übernommen", () => {
  const raw = JSON.stringify({ version: 3, scores: [1, 2, 3] });
  assert.deepStrictEqual(
    W.parseStoredState(raw, "de").scores,
    AXES.map(() => DEFAULT_SCORE)
  );
});

test("unbrauchbare Einzelwerte werden repariert, der Rest bleibt", () => {
  const scores = AXES.map(() => 6);
  scores[0] = null;
  scores[1] = "abc";
  scores[2] = 99;
  scores[3] = -5;
  const state = W.parseStoredState(JSON.stringify({ version: 3, scores }), "de");
  assert.strictEqual(state.scores[0], DEFAULT_SCORE);
  assert.strictEqual(state.scores[1], DEFAULT_SCORE);
  assert.strictEqual(state.scores[2], 10);
  assert.strictEqual(state.scores[3], 1);
  assert.strictEqual(state.scores[4], 6);
});

test("gespeicherte Daten ohne version werden migriert", () => {
  const raw = JSON.stringify({ scores: legacyScores() });
  assert.deepStrictEqual(W.parseStoredState(raw, "de").scores, scoresByCategory());
});

test("nur de und en werden als Sprache übernommen", () => {
  const state = (lang) => W.parseStoredState(JSON.stringify({ lang }), "en-GB").lang;
  assert.strictEqual(state("en"), "en");
  assert.strictEqual(state("de"), "de");
  assert.strictEqual(state("fr"), "de");
  assert.strictEqual(state(42), "de");
});

test("Notizen müssen ein Objekt sein", () => {
  assert.deepStrictEqual(W.parseStoredState(JSON.stringify({ notes: [1, 2] }), "de").notes, {});
  assert.deepStrictEqual(W.parseStoredState(JSON.stringify({ notes: "x" }), "de").notes, {});
  const notes = { 1: { definition: "hallo" } };
  assert.deepStrictEqual(W.parseStoredState(JSON.stringify({ notes }), "de").notes, notes);
});

test("ein unlesbares Datum wird zu null statt Invalid Date", () => {
  assert.strictEqual(W.parseStoredState(JSON.stringify({ date: "kein datum" }), "de").date, null);
  const ok = W.parseStoredState(JSON.stringify({ date: AFTER_V3 }), "de").date;
  assert.ok(ok instanceof Date);
  assert.strictEqual(ok.toISOString(), AFTER_V3);
});

test("Speichern und Laden ergibt wieder denselben Zustand", () => {
  const original = {
    scores: scoresByCategory(),
    notes: { 3: { definition: "Text", done: { definition: true } } },
    lang: "en",
    date: new Date(AFTER_V3),
  };
  const restored = W.parseStoredState(W.serializeState(original), "de");
  assert.deepStrictEqual(restored.scores, original.scores);
  assert.strictEqual(restored.lang, "en");
  assert.strictEqual(restored.date.toISOString(), AFTER_V3);
});

test("Gespeichertes trägt immer die aktuelle Schema-Version", () => {
  const written = JSON.parse(
    W.serializeState({ scores: scoresByCategory(), notes: {}, lang: "de", date: null })
  );
  assert.strictEqual(written.version, SCHEMA_VERSION);
});

// =====================================================
// ensureNotes
// =====================================================

test("ensureNotes legt eine vollständige leere Notiz an", () => {
  const notes = {};
  const note = W.ensureNotes(notes, 5);
  assert.strictEqual(notes[5], note);
  for (const step of STEPS) {
    assert.strictEqual(note[step], "");
    assert.strictEqual(note.done[step], false);
  }
  assert.deepStrictEqual(note.statementScores, [5, 5, 5, 5, 5]);
  assert.strictEqual(note.initialScore, null);
  assert.strictEqual(note.completed, false);
  assert.strictEqual(note.completedScore, null);
});

test("ensureNotes rührt Geschriebenes nicht an", () => {
  const notes = { 2: { definition: "mein Satz", initialScore: 7, completed: true } };
  const note = W.ensureNotes(notes, 2);
  assert.strictEqual(note.definition, "mein Satz");
  assert.strictEqual(note.initialScore, 7);
  assert.strictEqual(note.completed, true);
  assert.strictEqual(note.highsLows, "");
});

test("ensureNotes repariert statementScores falscher Länge", () => {
  // Die alte Prüfung war nur auf Wahrheitswert — ein zu kurzes Array blieb
  // stehen und verzerrte den Durchschnitt.
  assert.deepStrictEqual(
    W.ensureNotes({ 1: { statementScores: [8, 8, 8] } }, 1).statementScores,
    [8, 8, 8, 5, 5]
  );
  assert.deepStrictEqual(
    W.ensureNotes({ 1: { statementScores: [1, 2, 3, 4, 5, 6, 7] } }, 1).statementScores,
    [1, 2, 3, 4, 5]
  );
  assert.deepStrictEqual(
    W.ensureNotes({ 1: { statementScores: "kaputt" } }, 1).statementScores,
    [5, 5, 5, 5, 5]
  );
});

test("ensureNotes macht aus einem halben done-Objekt ein vollständiges", () => {
  const note = W.ensureNotes({ 4: { done: { definition: true, strategy: 1 } } }, 4);
  // Wahrheitswerte werden zu echten Booleans — so hat die Seite sie immer gelesen.
  assert.strictEqual(note.done.definition, true);
  assert.strictEqual(note.done.strategy, true);
  assert.strictEqual(note.done.highsLows, false);
  assert.strictEqual(note.done.dreamFactory, false);
});

test("ensureNotes verträgt kaputte Notiz-Einträge", () => {
  for (const broken of [null, "text", 42, []]) {
    const note = W.ensureNotes({ 6: broken }, 6);
    assert.strictEqual(note.definition, "");
    assert.deepStrictEqual(note.statementScores, [5, 5, 5, 5, 5]);
  }
});

test("ensureNotes ist idempotent", () => {
  const notes = { 7: { definition: "x", statementScores: [9] } };
  const first = JSON.parse(JSON.stringify(W.ensureNotes(notes, 7)));
  const second = JSON.parse(JSON.stringify(W.ensureNotes(notes, 7)));
  assert.deepStrictEqual(second, first);
});

// =====================================================
// Quick-Check-Durchschnitt
// =====================================================

test("statementsAverage mittelt die fünf Werte", () => {
  assert.strictEqual(W.statementsAverage([1, 2, 3, 4, 5]), 3);
  assert.strictEqual(W.statementsAverage([10, 10, 10, 10, 10]), 10);
});

test("statementsAverage rechnet auch bei kurzen Listen über fünf Werte", () => {
  // [10,10] darf nicht 10 ergeben — die fehlenden zählen als Startwert.
  assert.strictEqual(W.statementsAverage([10, 10]), (10 + 10 + 5 + 5 + 5) / 5);
});

test("statementsAsScore rundet auf einen gültigen Punktwert", () => {
  assert.strictEqual(W.statementsAsScore([1, 2, 3, 4, 5]), 3);
  assert.strictEqual(W.statementsAsScore([4, 4, 4, 4, 5]), 4);
  assert.strictEqual(W.statementsAsScore([1, 1, 1, 1, 1]), 1);
  assert.strictEqual(W.statementsAsScore([10, 10, 10, 10, 10]), 10);
});

// =====================================================
// Snapshots
// =====================================================

test("ein Snapshot von vor dem v3-Release wird migriert", () => {
  const stored = [{ date: BEFORE_V3, scores: legacyScores() }];
  assert.deepStrictEqual(W.migrateSnapshots(stored)[0].scores, scoresByCategory());
});

test("ein Snapshot von nach dem v3-Release bleibt unverändert", () => {
  const stored = [{ date: AFTER_V3, scores: scoresByCategory() }];
  assert.deepStrictEqual(W.migrateSnapshots(stored)[0].scores, scoresByCategory());
});

test("ein Snapshot mit version 3 wird nie erneut migriert", () => {
  const stored = [{ date: BEFORE_V3, version: 3, scores: scoresByCategory() }];
  assert.deepStrictEqual(W.migrateSnapshots(stored)[0].scores, scoresByCategory());
});

test("Snapshot-Migration ist idempotent", () => {
  const stored = [{ date: BEFORE_V3, scores: legacyScores() }];
  const once = W.migrateSnapshots(stored);
  assert.deepStrictEqual(W.migrateSnapshots(once), once);
});

test("migrierte Snapshots bekommen die Schema-Version geschrieben", () => {
  const out = W.migrateSnapshots([{ date: BEFORE_V3, scores: legacyScores() }]);
  assert.strictEqual(out[0].version, SCHEMA_VERSION);
});

test("Snapshots ohne brauchbares Datum gelten als alt", () => {
  assert.ok(W.snapshotIsLegacy({ scores: [], date: undefined }));
  assert.ok(W.snapshotIsLegacy({ scores: [], date: "unfug" }));
});

test("kaputte Snapshot-Einträge werden aussortiert statt zu stören", () => {
  const stored = [
    null,
    "text",
    { date: AFTER_V3 },
    { date: AFTER_V3, scores: "keine liste" },
    { date: AFTER_V3, scores: scoresByCategory() },
  ];
  const out = W.migrateSnapshots(stored);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(out[0].scores, scoresByCategory());
});

test("parseSnapshots verträgt fehlende und kaputte Daten", () => {
  assert.deepStrictEqual(W.parseSnapshots(null), []);
  assert.deepStrictEqual(W.parseSnapshots(""), []);
  assert.deepStrictEqual(W.parseSnapshots("{kaputt"), []);
  assert.deepStrictEqual(W.parseSnapshots('{"nicht":"liste"}'), []);
});

test("appendSnapshot hängt den aktuellen Stand an", () => {
  const out = W.appendSnapshot([], scoresByCategory(), AFTER_V3);
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].date, AFTER_V3);
  assert.deepStrictEqual(out[0].scores, scoresByCategory());
});

test("appendSnapshot kopiert die Werte statt sie zu verknüpfen", () => {
  const scores = scoresByCategory();
  const original = scores[0];
  const out = W.appendSnapshot([], scores, AFTER_V3);
  scores[0] = original === 1 ? 2 : 1; // späteres Schieben darf den Snapshot nicht ändern
  assert.notStrictEqual(out[0].scores, scores);
  assert.strictEqual(out[0].scores[0], original);
});

test("appendSnapshot hält die Liste bei höchstens zwölf Einträgen", () => {
  let list = [];
  for (let i = 0; i < MAX_SNAPSHOTS + 5; i++) {
    list = W.appendSnapshot(list, AXES.map(() => ((i % 10) + 1)), AFTER_V3);
  }
  assert.strictEqual(list.length, MAX_SNAPSHOTS);
  // Der jüngste Eintrag steht hinten, der älteste ist herausgefallen.
  assert.strictEqual(list[list.length - 1].scores[0], ((MAX_SNAPSHOTS + 4) % 10) + 1);
});

test("appendSnapshot migriert alte Einträge gleich mit", () => {
  const stored = [{ date: BEFORE_V3, scores: legacyScores() }];
  const out = W.appendSnapshot(stored, scoresByCategory(), AFTER_V3);
  assert.deepStrictEqual(out[0].scores, scoresByCategory());
  assert.deepStrictEqual(out[1].scores, scoresByCategory());
});

test("findSnapshot liefert die Werte zum gewählten Datum", () => {
  const list = W.appendSnapshot([], scoresByCategory(), AFTER_V3);
  assert.deepStrictEqual(W.findSnapshot(list, AFTER_V3), scoresByCategory());
  assert.strictEqual(W.findSnapshot(list, BEFORE_V3), null);
  assert.strictEqual(W.findSnapshot(list, null), null);
  assert.strictEqual(W.findSnapshot(null, AFTER_V3), null);
});

test("ein alter Snapshot wird gegen den heutigen Stand richtig gestellt", () => {
  // Regression: früher wurde der Hauptzustand migriert, der Snapshot nicht —
  // die Vergleichslinie zeigte dann fremde Bereiche.
  const heute = W.parseStoredState(
    JSON.stringify({ scores: legacyScores() }),
    "de"
  ).scores;
  const damals = W.parseSnapshots(
    JSON.stringify([{ date: BEFORE_V3, scores: legacyScores() }])
  )[0].scores;
  assert.deepStrictEqual(damals, heute);
});

// =====================================================
// Auswertung
// =====================================================

test("summarize rechnet Durchschnitt, Spreizung und schwächsten Bereich", () => {
  const scores = AXES.map(() => 5);
  scores[0] = 10;
  scores[7] = 2;
  const s = W.summarize(scores);
  assert.strictEqual(s.min, 2);
  assert.strictEqual(s.max, 10);
  assert.strictEqual(s.spread, 8);
  assert.strictEqual(s.weakestIdx, 7);
  assert.strictEqual(s.average, scores.reduce((a, b) => a + b, 0) / 12);
});

test("summarize nimmt bei Gleichstand den ersten schwächsten Bereich", () => {
  const scores = AXES.map(() => 5);
  scores[3] = 1;
  scores[9] = 1;
  assert.strictEqual(W.summarize(scores).weakestIdx, 3);
});

test("summarize meldet bei lauter gleichen Werten Spreizung 0", () => {
  const s = W.summarize(AXES.map(() => 7));
  assert.strictEqual(s.spread, 0);
  assert.strictEqual(s.average, 7);
});

test("firstNonEmptyLine nimmt die erste Zeile mit Inhalt", () => {
  assert.strictEqual(W.firstNonEmptyLine("\n\n  erster Schritt\nzweiter"), "erster Schritt");
  assert.strictEqual(W.firstNonEmptyLine("a\r\nb"), "a");
  assert.strictEqual(W.firstNonEmptyLine("   \n  \n"), "");
  assert.strictEqual(W.firstNonEmptyLine(null), "");
  assert.strictEqual(W.firstNonEmptyLine(undefined), "");
});

/** Notiz für einen abgeschlossenen Bereich. */
function done(initial, after, strategy) {
  return {
    completed: true,
    initialScore: initial,
    completedScore: after,
    strategy: strategy || "",
  };
}

test("computeLevers listet nur abgeschlossene Bereiche", () => {
  const notes = { 1: done(5, 8), 2: { completed: false, initialScore: 1 }, 3: done(4, 4) };
  const levers = W.computeLevers(notes, AXES.map(() => 5));
  assert.deepStrictEqual(levers.map((l) => l.n), [1, 3]);
});

test("computeLevers sortiert nach grösster Verschiebung", () => {
  const notes = { 1: done(5, 6), 2: done(2, 9), 3: done(5, 7) };
  const levers = W.computeLevers(notes, AXES.map(() => 5));
  assert.deepStrictEqual(levers.map((l) => l.n), [2, 3, 1]);
  assert.deepStrictEqual(levers.map((l) => l.diff), [7, 2, 1]);
});

test("bei gleicher Verschiebung kommt der niedrigere Stand zuerst", () => {
  const scores = AXES.map(() => 5);
  scores[0] = 9; // Bereich 1
  scores[1] = 3; // Bereich 2
  const notes = { 1: done(5, 6), 2: done(5, 6) };
  assert.deepStrictEqual(W.computeLevers(notes, scores).map((l) => l.n), [2, 1]);
});

test("bei völligem Gleichstand bleibt die Bereichsreihenfolge erhalten", () => {
  const notes = { 5: done(5, 6), 2: done(5, 6), 9: done(5, 6) };
  assert.deepStrictEqual(W.computeLevers(notes, AXES.map(() => 5)).map((l) => l.n), [2, 5, 9]);
});

test("die Verschiebung wird als Betrag gezählt — auch nach unten", () => {
  const levers = W.computeLevers({ 1: done(9, 3) }, AXES.map(() => 5));
  assert.strictEqual(levers[0].diff, 6);
});

test("ohne completedScore zählt der aktuelle Stand", () => {
  const scores = AXES.map(() => 5);
  scores[0] = 8;
  const levers = W.computeLevers({ 1: { completed: true, initialScore: 3 } }, scores);
  assert.strictEqual(levers[0].after, 8);
  assert.strictEqual(levers[0].diff, 5);
});

test("ohne initialScore ist die Verschiebung 0", () => {
  const levers = W.computeLevers({ 1: { completed: true, completedScore: 9 } }, AXES.map(() => 5));
  assert.strictEqual(levers[0].initial, null);
  assert.strictEqual(levers[0].diff, 0);
});

test("computeLevers nimmt den ersten Strategie-Schritt mit", () => {
  const notes = { 1: done(5, 8, "  \n mehr Wasser trinken \n und schlafen") };
  assert.strictEqual(W.computeLevers(notes, AXES.map(() => 5))[0].firstStep, "mehr Wasser trinken");
});

test("computeLevers verträgt fehlende Notizen", () => {
  assert.deepStrictEqual(W.computeLevers({}, AXES.map(() => 5)), []);
  assert.deepStrictEqual(W.computeLevers(null, AXES.map(() => 5)), []);
});

test("insightDiffKey unterscheidet gleich, klein und deutlich", () => {
  assert.strictEqual(W.insightDiffKey(5, 5), "insightDiffSame");
  assert.strictEqual(W.insightDiffKey(5, 6), "insightDiffSmall");
  assert.strictEqual(W.insightDiffKey(6, 5), "insightDiffSmall");
  assert.strictEqual(W.insightDiffKey(5, 7), "insightDiffLarge");
  assert.strictEqual(W.insightDiffKey(9, 2), "insightDiffLarge");
});

test("insightDiffKey verträgt fehlende Werte", () => {
  assert.strictEqual(W.insightDiffKey(null, 5), "insightDiffSame");
  assert.strictEqual(W.insightDiffKey(5, null), "insightDiffSame");
  assert.strictEqual(W.insightDiffKey(undefined, undefined), "insightDiffSame");
});

// =====================================================
// Geometrie
// =====================================================

test("Bereich 12 sitzt oben, Bereich 3 rechts", () => {
  const [x12, y12] = W.point(11, 100); // n = 12
  assert.ok(Math.abs(x12 - WHEEL.cx) < 1e-9);
  assert.ok(y12 < WHEEL.cy, "Bereich 12 muss über der Mitte liegen");

  const [x3, y3] = W.point(2, 100); // n = 3
  assert.ok(x3 > WHEEL.cx, "Bereich 3 muss rechts der Mitte liegen");
  assert.ok(Math.abs(y3 - WHEEL.cy) < 1e-9);
});

test("die zwölf Achsen stehen auf verschiedenen Winkeln, je 30 Grad", () => {
  const degrees = AXES.map((a, i) => ((W.angleRad(i) * 180) / Math.PI + 360) % 360);
  assert.strictEqual(new Set(degrees.map((d) => d.toFixed(6))).size, 12);
  for (const d of degrees) assert.ok(Math.abs((d % 30) - 0) < 1e-9 || Math.abs((d % 30) - 30) < 1e-9);
});

test("scoreRadius bildet 1..10 auf den Wheel-Radius ab", () => {
  assert.strictEqual(W.scoreRadius(10), WHEEL.rMax);
  assert.strictEqual(W.scoreRadius(5), WHEEL.rMax / 2);
  assert.strictEqual(W.scoreRadius(0), 0);
});

test("Ziehen auf einen Punkt ergibt wieder denselben Wert", () => {
  for (let idx = 0; idx < AXES.length; idx++) {
    for (let score = 1; score <= 10; score++) {
      const [x, y] = W.point(idx, W.scoreRadius(score));
      assert.strictEqual(W.projectToScore(idx, x, y), score, "Achse " + idx + ", Wert " + score);
    }
  }
});

test("Ziehen über den Rand hinaus bleibt bei 10", () => {
  const [x, y] = W.point(0, WHEEL.rMax * 3);
  assert.strictEqual(W.projectToScore(0, x, y), 10);
});

test("Ziehen in die Mitte oder auf die Gegenseite ergibt 1", () => {
  assert.strictEqual(W.projectToScore(0, WHEEL.cx, WHEEL.cy), 1);
  const [x, y] = W.point(0, -WHEEL.rMax); // gegenüberliegende Seite
  assert.strictEqual(W.projectToScore(0, x, y), 1);
});

test("seitlicher Versatz neben der Achse ändert den Wert nicht", () => {
  const idx = 2; // n = 3, waagerechte Achse
  const [x, y] = W.point(idx, W.scoreRadius(7));
  assert.strictEqual(W.projectToScore(idx, x, y + 40), 7);
});

test("axisIndexOf findet den Index zur Bereichsnummer", () => {
  assert.strictEqual(W.axisIndexOf(1), 0);
  assert.strictEqual(W.axisIndexOf(12), 11);
  assert.strictEqual(W.axisIndexOf(99), -1);
});

test("nextAxisCategory blättert vorwärts und rückwärts im Kreis", () => {
  assert.strictEqual(W.nextAxisCategory(1, 1), 2);
  assert.strictEqual(W.nextAxisCategory(12, 1), 1);
  assert.strictEqual(W.nextAxisCategory(1, -1), 12);
  assert.strictEqual(W.nextAxisCategory(99, 1), null);
});

test("zwölfmal blättern führt zum Ausgangsbereich zurück", () => {
  let n = 4;
  for (let i = 0; i < 12; i++) n = W.nextAxisCategory(n, 1);
  assert.strictEqual(n, 4);
});

// =====================================================
// escapeHtml
// =====================================================

test("escapeHtml entschärft Notiztext für die Ausgabe", () => {
  assert.strictEqual(
    W.escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;"
  );
  assert.strictEqual(W.escapeHtml("Tom & Jerry"), "Tom &amp; Jerry");
  assert.strictEqual(W.escapeHtml("it's"), "it&#39;s");
});

test("escapeHtml maskiert das kaufmännische Und zuerst", () => {
  // Sonst würde aus &lt; ein doppelt maskiertes &amp;lt;.
  assert.strictEqual(W.escapeHtml("&lt;"), "&amp;lt;");
});

test("escapeHtml verträgt null und undefined", () => {
  assert.strictEqual(W.escapeHtml(null), "");
  assert.strictEqual(W.escapeHtml(undefined), "");
  assert.strictEqual(W.escapeHtml(0), "0");
});
