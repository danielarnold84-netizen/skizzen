/*
 * lint-pages.js — Konventions-Check für alle Skizzen-Seiten.
 *
 * Die Seiten hier sind handgeschriebenes HTML und gehen ohne Review direkt
 * live. Dieser Linter prüft genau die Zusagen, die im README stehen (jede
 * Skizze noindex, eigener Unterordner) plus die Handvoll Dinge, die beim
 * Kopieren einer Seite erfahrungsgemäss verloren gehen: Viewport, lang,
 * Titel, tote Links, fehlendes rel="noopener", doppelte IDs.
 *
 * Ohne Abhängigkeiten, damit `npm test` in einem frischen Checkout läuft.
 *
 *   node tools/lint-pages.js            # gesamtes Repo
 *   node tools/lint-pages.js wheel      # nur ein Unterordner
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const IGNORED_DIRS = new Set([".git", "node_modules", ".github", "tools", "test"]);

// ---------------------------------------------------------------------------
// HTML-Scanner (regex-basiert — reicht für handgeschriebene Seiten und hält
// den Linter abhängigkeitsfrei)
// ---------------------------------------------------------------------------

/** Entfernt Kommentare, damit auskommentiertes Markup nicht mitgeprüft wird. */
function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

function attr(tag, name) {
  const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', "i")) ||
            tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", "i"));
  return m ? m[1] : null;
}

function openingTags(html, tagName) {
  const out = [];
  const re = new RegExp("<" + tagName + "\\b[^>]*>", "gi");
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[0]);
  return out;
}

function metaContent(html, name) {
  for (const tag of openingTags(html, "meta")) {
    const n = attr(tag, "name");
    if (n && n.toLowerCase() === name.toLowerCase()) return attr(tag, "content") || "";
  }
  return null;
}

function collectIds(html) {
  const ids = [];
  const re = /\bid\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) ids.push(m[1]);
  return ids;
}

/** Relative Link- und Asset-Ziele einer Seite (ohne Anker, Protokolle, Daten-URIs). */
function localReferences(html) {
  const refs = [];
  const re = /\b(?:href|src)\s*=\s*"([^"]*)"/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(raw)) continue;
    // Template-Literale aus Inline-JS ('...' + x + '...') überspringen
    if (raw.includes("${") || raw.includes("' +") || raw.includes('" +')) continue;
    refs.push(raw.split("#")[0].split("?")[0]);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Regeln pro Seite
// ---------------------------------------------------------------------------

/**
 * Prüft eine einzelne Seite. `resolve(ref)` meldet, ob ein relativer Verweis
 * existiert — als Parameter, damit die Regeln ohne Dateisystem testbar sind.
 */
function lintPage(html, relPath, resolve) {
  const problems = [];
  const fail = (rule, message) => problems.push({ file: relPath, rule, message });
  const source = stripComments(html);

  const robots = metaContent(source, "robots");
  if (robots === null) {
    fail("noindex", 'Kein <meta name="robots"> — README verlangt noindex,nofollow auf jeder Seite');
  } else if (!/noindex/i.test(robots) || !/nofollow/i.test(robots)) {
    fail("noindex", 'meta robots ist "' + robots + '", erwartet "noindex,nofollow"');
  }

  if (metaContent(source, "viewport") === null) {
    fail("viewport", 'Kein <meta name="viewport"> — Seite bricht auf dem Handy');
  }

  const htmlTag = openingTags(source, "html")[0];
  if (!htmlTag || !attr(htmlTag, "lang")) {
    fail("lang", "<html> ohne lang-Attribut");
  }

  if (!openingTags(source, "meta").some((t) => attr(t, "charset"))) {
    fail("charset", "Kein <meta charset>");
  }

  const title = (source.match(/<title>([\s\S]*?)<\/title>/i) || [])[1];
  if (!title || !title.trim()) {
    fail("title", "Kein oder leerer <title>");
  }

  for (const tag of openingTags(source, "a")) {
    const target = attr(tag, "target");
    if (target !== "_blank") continue;
    const rel = attr(tag, "rel") || "";
    if (!/\bnoopener\b/i.test(rel)) {
      fail("noopener", 'target="_blank" ohne rel="noopener": ' + tag.slice(0, 80));
    }
  }

  const seen = new Set();
  for (const id of collectIds(source)) {
    if (seen.has(id)) fail("duplicate-id", 'id="' + id + '" kommt mehrfach vor');
    seen.add(id);
  }

  if (resolve) {
    for (const ref of localReferences(source)) {
      if (!resolve(ref)) fail("dead-link", "Verweis geht ins Leere: " + ref);
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------
// Repo-weite Regeln
// ---------------------------------------------------------------------------

function findHtmlFiles(root) {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".html")) out.push(full);
    }
  })(root);
  return out.sort();
}

/** Top-Level-Ordner, die mindestens eine Seite enthalten — also eine Skizze sind. */
function sketchDirs(root, htmlFiles) {
  const dirs = new Set();
  for (const file of htmlFiles) {
    const rel = path.relative(root, file);
    const top = rel.split(path.sep)[0];
    if (top.endsWith(".html")) continue;
    dirs.add(top);
  }
  return [...dirs].sort();
}

/**
 * Jede Skizze muss von der Startseite aus erreichbar sein — sonst existiert
 * sie nur für den, der die URL auswendig kennt.
 */
function lintIndexCoverage(indexHtml, dirs) {
  const linked = new Set(
    localReferences(stripComments(indexHtml))
      .map((ref) => ref.replace(/^\.\//, "").split("/")[0])
      .filter(Boolean)
  );
  return dirs
    .filter((dir) => !linked.has(dir))
    .map((dir) => ({
      file: "index.html",
      rule: "unlinked-sketch",
      message: "Skizze /" + dir + "/ ist von der Übersicht aus nicht verlinkt",
    }));
}

function lintRepo(root) {
  const htmlFiles = findHtmlFiles(root);
  const problems = [];

  for (const file of htmlFiles) {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const html = fs.readFileSync(file, "utf8");
    const resolve = (ref) => {
      const target = path.resolve(path.dirname(file), ref);
      if (!fs.existsSync(target)) return false;
      return fs.statSync(target).isDirectory()
        ? fs.existsSync(path.join(target, "index.html"))
        : true;
    };
    problems.push(...lintPage(html, rel, resolve));
  }

  const indexPath = path.join(root, "index.html");
  if (fs.existsSync(indexPath)) {
    problems.push(
      ...lintIndexCoverage(fs.readFileSync(indexPath, "utf8"), sketchDirs(root, htmlFiles))
    );
  }

  return { htmlFiles, problems };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const root = argv[0] ? path.resolve(REPO_ROOT, argv[0]) : REPO_ROOT;
  const { htmlFiles, problems } = lintRepo(root);

  if (problems.length === 0) {
    console.log("✓ " + htmlFiles.length + " Seiten geprüft, keine Beanstandungen.");
    return 0;
  }

  const byFile = new Map();
  for (const p of problems) {
    if (!byFile.has(p.file)) byFile.set(p.file, []);
    byFile.get(p.file).push(p);
  }
  for (const [file, list] of [...byFile.entries()].sort()) {
    console.error("\n" + file);
    for (const p of list) console.error("  [" + p.rule + "] " + p.message);
  }
  console.error(
    "\n✗ " + problems.length + " Beanstandung(en) in " + byFile.size +
    " von " + htmlFiles.length + " Seiten."
  );
  return 1;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = {
  lintPage,
  lintRepo,
  lintIndexCoverage,
  findHtmlFiles,
  sketchDirs,
  localReferences,
  metaContent,
  collectIds,
  stripComments,
};
