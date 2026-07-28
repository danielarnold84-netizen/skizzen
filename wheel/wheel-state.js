/*
 * wheel-state.js — Zustand, Migration und Geometrie des Wheel of Life.
 *
 * Wird von wheel/index.html als klassisches <script> geladen (global
 * `WheelState`) und von der Node-Test-Suite direkt eingebunden. Kein DOM-
 * Zugriff: alles hier ist rein, damit es ohne Browser prüfbar ist. Das
 * Rendern bleibt in index.html.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WheelState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ---------------------------------------------------------------------
  // Konstanten
  // ---------------------------------------------------------------------

  const SCHEMA_VERSION = 3;
  const STORAGE_KEY = "wheel-of-life-yoga-v2";
  const SNAPSHOT_KEY = "wheel-of-life-yoga-v2-snapshots";
  const SEEN_KEY = "wheel-of-life-yoga-v2-seen-intro";

  // Achsen im Uhrzeigersinn ab 12 Uhr (oben), Bereiche aufsteigend 1..12
  const AXES = [
    { idx: 0,  n: 1 }, { idx: 1,  n: 2 }, { idx: 2,  n: 3 },
    { idx: 3,  n: 4 }, { idx: 4,  n: 5 }, { idx: 5,  n: 6 },
    { idx: 6,  n: 7 }, { idx: 7,  n: 8 }, { idx: 8,  n: 9 },
    { idx: 9,  n:10 }, { idx:10,  n:11 }, { idx:11,  n:12 },
  ];

  // Alte Yoga-Achsen-Reihenfolge (V2 vor 29.04. abend) — für Migration
  const LEGACY_AXES_N_V2 = [12, 11, 2, 9, 10, 6, 7, 8, 3, 4, 5, 1];

  // Zeitpunkt, ab dem die Seite v3 (Kategorien 1..12) geschrieben hat.
  // Snapshots ohne version-Feld sind nur dann in alter Achsen-Reihenfolge,
  // wenn sie davor entstanden sind — spätere sind bereits v3, nur ohne Feld.
  const V3_RELEASED_AT = Date.parse("2026-04-29T13:49:26Z");

  const STEPS = ["definition", "highsLows", "strategy", "dreamFactory"];

  const AXIS_COUNT = 12;
  const STATEMENT_COUNT = 5;
  const MIN_SCORE = 1;
  const MAX_SCORE = 10;
  const DEFAULT_SCORE = 5;
  const MAX_SNAPSHOTS = 12;
  const LEVER_MINIMUM = 3;
  const WHEEL = { cx: 270, cy: 270, rMax: 200 };

  // ---------------------------------------------------------------------
  // Werte
  // ---------------------------------------------------------------------

  /**
   * Bringt einen beliebigen gespeicherten Wert auf eine gültige Punktzahl.
   * Unlesbares wird DEFAULT_SCORE, alles andere auf 1..10 gerundet und
   * geklemmt — eine gespeicherte 0 wird also 1 (nächstgültiger Wert) und
   * nicht 5.
   */
  function clampScore(value) {
    if (value === null || value === undefined || value === "") return DEFAULT_SCORE;
    const n = Number(value);
    if (!Number.isFinite(n)) return DEFAULT_SCORE;
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(n)));
  }

  /** Genau AXIS_COUNT gültige Werte — fehlende werden aufgefüllt. */
  function normalizeScores(scores) {
    const out = [];
    for (let i = 0; i < AXIS_COUNT; i++) {
      const v = Array.isArray(scores) ? scores[i] : undefined;
      out.push(v === undefined || v === null ? DEFAULT_SCORE : clampScore(v));
    }
    return out;
  }

  function normalizeStatementScores(values) {
    const out = [];
    for (let i = 0; i < STATEMENT_COUNT; i++) {
      const v = Array.isArray(values) ? values[i] : undefined;
      out.push(v === undefined || v === null ? DEFAULT_SCORE : clampScore(v));
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Migration
  // ---------------------------------------------------------------------

  function isLegacyVersion(version) {
    return !(Number(version) >= SCHEMA_VERSION);
  }

  /** Werte aus der alten Achsen-Reihenfolge auf die Bereiche 1..12 legen. */
  function remapLegacyAxes(scores) {
    const byCategory = {};
    LEGACY_AXES_N_V2.forEach((n, i) => { byCategory[n] = scores[i]; });
    return AXES.map((a) => (byCategory[a.n] != null ? byCategory[a.n] : DEFAULT_SCORE));
  }

  /** Idempotent: einmal migrierte Werte (version >= 3) bleiben unverändert. */
  function migrateScores(scores, version) {
    const normalized = normalizeScores(scores);
    return isLegacyVersion(version) ? remapLegacyAxes(normalized) : normalized;
  }

  // ---------------------------------------------------------------------
  // Persistenz: Hauptzustand
  // ---------------------------------------------------------------------

  function pickInitialLang(navigatorLanguage) {
    return String(navigatorLanguage || "de").toLowerCase().startsWith("en") ? "en" : "de";
  }

  function emptyScores() {
    return AXES.map(() => DEFAULT_SCORE);
  }

  /**
   * Liest den gespeicherten Zustand. Kaputte, alte oder halb geschriebene
   * Daten dürfen die Seite nie blockieren — im Zweifel Startwerte.
   */
  function parseStoredState(raw, navigatorLanguage) {
    if (!raw) {
      return {
        scores: emptyScores(),
        notes: {},
        lang: pickInitialLang(navigatorLanguage),
        date: null,
      };
    }

    const state = { scores: emptyScores(), notes: {}, lang: "de", date: null };

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return state;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return state;

    if (Array.isArray(parsed.scores) && parsed.scores.length === AXIS_COUNT) {
      state.scores = migrateScores(parsed.scores, parsed.version);
    }
    if (parsed.notes && typeof parsed.notes === "object" && !Array.isArray(parsed.notes)) {
      state.notes = parsed.notes;
    }
    if (parsed.lang === "de" || parsed.lang === "en") {
      state.lang = parsed.lang;
    }
    if (parsed.date) {
      const d = new Date(parsed.date);
      if (!Number.isNaN(d.getTime())) state.date = d;
    }
    return state;
  }

  function serializeState(state) {
    return JSON.stringify({
      version: SCHEMA_VERSION,
      scores: state.scores,
      notes: state.notes,
      lang: state.lang,
      date: state.date instanceof Date ? state.date.toISOString() : state.date,
    });
  }

  // ---------------------------------------------------------------------
  // Notizen
  // ---------------------------------------------------------------------

  /**
   * Ergänzt fehlende Felder einer Bereichs-Notiz, ohne Geschriebenes
   * anzufassen. Schreibt das Ergebnis zurück in notesMap und gibt es zurück.
   */
  function ensureNotes(notesMap, n) {
    const existing = notesMap[n];
    const note = existing && typeof existing === "object" && !Array.isArray(existing)
      ? existing
      : {};

    STEPS.forEach((step) => {
      if (typeof note[step] !== "string") note[step] = "";
    });
    if (!note.done || typeof note.done !== "object") note.done = {};
    STEPS.forEach((step) => { note.done[step] = !!note.done[step]; });

    note.statementScores = normalizeStatementScores(note.statementScores);

    if (note.initialScore === undefined) note.initialScore = null;
    if (note.completed === undefined) note.completed = false;
    if (note.completedScore === undefined) note.completedScore = null;

    notesMap[n] = note;
    return note;
  }

  function statementsAverage(statementScores) {
    const values = normalizeStatementScores(statementScores);
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function statementsAsScore(statementScores) {
    return clampScore(statementsAverage(statementScores));
  }

  // ---------------------------------------------------------------------
  // Snapshots
  // ---------------------------------------------------------------------

  /**
   * Ein Snapshot liegt in alter Achsen-Reihenfolge, wenn er kein version-Feld
   * hat und vor dem v3-Release entstanden ist. Ohne lesbares Datum wird
   * konservativ von "alt" ausgegangen — vor v3 gab es kein version-Feld.
   */
  function snapshotIsLegacy(snapshot) {
    if (!snapshot) return false;
    if (!isLegacyVersion(snapshot.version)) return false;
    const t = Date.parse(snapshot.date);
    if (Number.isNaN(t)) return true;
    return t < V3_RELEASED_AT;
  }

  /**
   * Bringt eine Snapshot-Liste auf das aktuelle Schema. Das fehlte bisher:
   * der Hauptzustand wurde migriert, die Snapshots nicht — alte Snapshots
   * wurden dadurch mit vertauschten Bereichen ins Wheel gezeichnet.
   */
  function migrateSnapshots(rawSnapshots) {
    if (!Array.isArray(rawSnapshots)) return [];
    return rawSnapshots
      .filter((s) => s && typeof s === "object" && Array.isArray(s.scores))
      .map((s) => {
        const normalized = normalizeScores(s.scores);
        return {
          date: s.date,
          version: SCHEMA_VERSION,
          scores: snapshotIsLegacy(s) ? remapLegacyAxes(normalized) : normalized,
        };
      });
  }

  function parseSnapshots(raw) {
    let parsed;
    try {
      parsed = JSON.parse(raw || "[]");
    } catch (e) {
      return [];
    }
    return migrateSnapshots(parsed);
  }

  function appendSnapshot(snapshots, scores, isoDate) {
    const next = migrateSnapshots(snapshots);
    next.push({ date: isoDate, version: SCHEMA_VERSION, scores: normalizeScores(scores) });
    while (next.length > MAX_SNAPSHOTS) next.shift();
    return next;
  }

  function findSnapshot(snapshots, date) {
    if (!date || !Array.isArray(snapshots)) return null;
    const snap = snapshots.find((s) => s && s.date === date);
    return snap ? snap.scores : null;
  }

  // ---------------------------------------------------------------------
  // Auswertung
  // ---------------------------------------------------------------------

  function summarize(scores) {
    const s = normalizeScores(scores);
    const min = Math.min.apply(null, s);
    const max = Math.max.apply(null, s);
    return {
      average: s.reduce((a, b) => a + b, 0) / s.length,
      min: min,
      max: max,
      spread: max - min,
      weakestIdx: s.indexOf(min),
    };
  }

  function firstNonEmptyLine(text) {
    const lines = String(text == null ? "" : text)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return lines.length ? lines[0] : "";
  }

  /**
   * Abgeschlossene Bereiche, sortiert nach grösster Verschiebung, bei
   * Gleichstand nach niedrigstem Stand. Bei vollem Gleichstand bleibt die
   * Achsen-Reihenfolge erhalten (stabile Sortierung).
   */
  function computeLevers(notesMap, scores) {
    const values = normalizeScores(scores);
    const completed = [];
    AXES.forEach((a, i) => {
      const note = notesMap ? notesMap[a.n] : null;
      if (!note || !note.completed) return;
      const initial = note.initialScore != null ? note.initialScore : null;
      const after = note.completedScore != null ? note.completedScore : values[i];
      const diff = initial != null && after != null ? Math.abs(after - initial) : 0;
      completed.push({
        n: a.n,
        idx: i,
        initial: initial,
        after: after,
        diff: diff,
        score: values[i],
        firstStep: firstNonEmptyLine(note.strategy),
      });
    });
    return completed.sort((a, b) => (b.diff !== a.diff ? b.diff - a.diff : a.score - b.score));
  }

  function insightDiffKey(first, after) {
    if (first == null || after == null) return "insightDiffSame";
    const diff = Math.abs(after - first);
    if (diff >= 2) return "insightDiffLarge";
    if (diff >= 1) return "insightDiffSmall";
    return "insightDiffSame";
  }

  // ---------------------------------------------------------------------
  // Geometrie
  // ---------------------------------------------------------------------

  /** Uhr-Position: n=12 → 12 Uhr (oben), n=1..11 → 1..11 Uhr im Uhrzeigersinn. */
  function angleRad(idx) {
    const a = AXES[idx];
    const clockPos = a && a.n === 12 ? 0 : a ? a.n : 0;
    return ((clockPos * 30 - 90) * Math.PI) / 180;
  }

  function point(idx, r) {
    const a = angleRad(idx);
    return [WHEEL.cx + Math.cos(a) * r, WHEEL.cy + Math.sin(a) * r];
  }

  function scoreRadius(score) {
    return score * (WHEEL.rMax / MAX_SCORE);
  }

  /** Zeigerposition auf die Achse projizieren und auf 1..10 klemmen. */
  function projectToScore(idx, svgX, svgY) {
    const a = angleRad(idx);
    const proj = (svgX - WHEEL.cx) * Math.cos(a) + (svgY - WHEEL.cy) * Math.sin(a);
    const score = Math.round(proj / (WHEEL.rMax / MAX_SCORE));
    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, score));
  }

  function axisIndexOf(n) {
    return AXES.findIndex((a) => a.n === n);
  }

  function nextAxisCategory(n, dir) {
    const idx = axisIndexOf(n);
    if (idx < 0) return null;
    return AXES[(idx + dir + AXIS_COUNT) % AXIS_COUNT].n;
  }

  // ---------------------------------------------------------------------
  // Ausgabe
  // ---------------------------------------------------------------------

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STORAGE_KEY: STORAGE_KEY,
    SNAPSHOT_KEY: SNAPSHOT_KEY,
    SEEN_KEY: SEEN_KEY,
    AXES: AXES,
    LEGACY_AXES_N_V2: LEGACY_AXES_N_V2,
    V3_RELEASED_AT: V3_RELEASED_AT,
    STEPS: STEPS,
    AXIS_COUNT: AXIS_COUNT,
    STATEMENT_COUNT: STATEMENT_COUNT,
    MIN_SCORE: MIN_SCORE,
    MAX_SCORE: MAX_SCORE,
    DEFAULT_SCORE: DEFAULT_SCORE,
    MAX_SNAPSHOTS: MAX_SNAPSHOTS,
    LEVER_MINIMUM: LEVER_MINIMUM,
    WHEEL: WHEEL,

    clampScore: clampScore,
    normalizeScores: normalizeScores,
    normalizeStatementScores: normalizeStatementScores,
    isLegacyVersion: isLegacyVersion,
    remapLegacyAxes: remapLegacyAxes,
    migrateScores: migrateScores,
    pickInitialLang: pickInitialLang,
    parseStoredState: parseStoredState,
    serializeState: serializeState,
    ensureNotes: ensureNotes,
    statementsAverage: statementsAverage,
    statementsAsScore: statementsAsScore,
    snapshotIsLegacy: snapshotIsLegacy,
    migrateSnapshots: migrateSnapshots,
    parseSnapshots: parseSnapshots,
    appendSnapshot: appendSnapshot,
    findSnapshot: findSnapshot,
    summarize: summarize,
    firstNonEmptyLine: firstNonEmptyLine,
    computeLevers: computeLevers,
    insightDiffKey: insightDiffKey,
    angleRad: angleRad,
    point: point,
    scoreRadius: scoreRadius,
    projectToScore: projectToScore,
    axisIndexOf: axisIndexOf,
    nextAxisCategory: nextAxisCategory,
    escapeHtml: escapeHtml,
  };
});
