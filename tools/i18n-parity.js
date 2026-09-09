/*
 * i18n-parity.js — hält die zweisprachigen Seiten in Deckung.
 *
 * Zwei Seiten hier schalten zwischen DE und EN um, auf zwei verschiedene
 * Arten gebaut:
 *
 *   wheel/index.html    ein Wörterbuch je Sprache (const I18N = { de, en })
 *   sis-ulf/index.html  Deutsch steht im Markup, EN legt sich darüber
 *
 * Beide teilen dieselbe Schwachstelle: ein neuer Textbaustein wird ergänzt,
 * die Gegensprache vergessen. Die Seite bleibt fehlerfrei — sie zeigt beim
 * Umschalten nur weiterhin Deutsch, und niemand merkt es, weil man beim
 * Bauen ohnehin auf Deutsch liest.
 *
 * Geprüft wird darum:
 *
 *   - jeder data-i18n-Schlüssel im Markup steht in jedem Wörterbuch
 *   - beide Wörterbücher haben denselben Schlüsselsatz, auch verschachtelt
 *     (die 12 Bereiche, die 5 Aussagen je Bereich)
 *   - kein Wörterbuch-Eintrag ist tot
 *   - die Auszeichnung im Text (<b>, <span class="tag">, <br>) ist in beiden
 *     Sprachen dieselbe — sonst bricht das Layout nur in einer
 *
 *   node tools/i18n-parity.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const { findHtmlFiles } = require("./lint-pages.js");

// ---------------------------------------------------------------------------
// Ein Objektliteral aus dem Seitenquelltext lesen
// ---------------------------------------------------------------------------

/** Schneidet ein `{...}` ab der Startposition heraus, Klammern zählend. */
function braceBlock(source, start) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  return null;
}

/** Ersetzt jedes Stringliteral durch "" — übrig bleibt das Gerüst. */
function skeleton(literal) {
  return literal.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '""');
}

/**
 * Wertet ein Objektliteral aus — aber nur, wenn es reine Daten sind.
 * Enthält das Gerüst irgendetwas Ausführbares (Klammern, Pfeile, Namen),
 * wird nichts ausgewertet und null zurückgegeben.
 */
function parseObjectLiteral(literal) {
  const bare = skeleton(literal);
  if (!/^[\s{}[\]:,0-9a-zA-Z_$"]*$/.test(bare)) return null;
  if (/\b(function|require|import|new|this)\b/.test(bare)) return null;
  try {
    // eslint-disable-next-line no-new-func
    return new Function('"use strict"; return (' + literal + ");")();
  } catch (e) {
    return null;
  }
}

/** Findet `const NAME = { … };` und gibt das Objekt zurück. */
function objectNamed(source, name) {
  const m = source.match(new RegExp("(?:const|let|var)\\s+" + name + "\\s*=\\s*\\{"));
  if (!m) return null;
  const literal = braceBlock(source, m.index + m[0].length - 1);
  return literal ? { literal, value: parseObjectLiteral(literal) } : null;
}

// ---------------------------------------------------------------------------
// Markup
// ---------------------------------------------------------------------------

/** Alle im Markup verwendeten Übersetzungsschlüssel. */
function markupKeys(html) {
  return [...new Set([...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map((m) => m[1]))];
}

/** Angebotene Sprachen laut den Umschalt-Schaltflächen. */
function switchLangs(html) {
  return [...new Set([...html.matchAll(/<button[^>]*\bdata-lang="([a-z]{2})"/g)].map((m) => m[1]))];
}

/**
 * Der Inhalt jedes data-i18n-Elements — bei sis-ulf ist das die deutsche
 * Fassung, denn dort steht Deutsch direkt im Markup.
 */
function markupValues(html) {
  const out = new Map();
  const re = /<([a-z0-9]+)\b[^>]*\bdata-i18n(?:-html)?="([^"]+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const [tag, key] = [m[1], m[2]];
    if (out.has(key)) continue; // Ein Schlüssel darf mehrfach hängen (z. B. "öffnen").
    const closer = new RegExp("<(/?)" + tag + "\\b", "gi");
    closer.lastIndex = re.lastIndex;
    let depth = 1;
    let x;
    while ((x = closer.exec(html)) !== null) {
      depth += x[1] ? -1 : 1;
      if (depth === 0) {
        out.set(key, html.slice(re.lastIndex, x.index));
        break;
      }
    }
  }
  return out;
}

/** Die Auszeichnung eines Textbausteins, sortiert — der Text selbst zählt nicht. */
function inlineTags(value) {
  return [...String(value ?? "").matchAll(/<\/?([a-z0-9]+)\b/gi)]
    .map((m) => m[1].toLowerCase())
    .sort();
}

/** Beschreibt einen Wert so, dass zwei Sprachen vergleichbar werden. */
function shape(value) {
  if (Array.isArray(value)) return "[" + value.length + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().join(",") + "}";
  return typeof value;
}

// ---------------------------------------------------------------------------
// Prüfung einer Seite
// ---------------------------------------------------------------------------

/** Ist der Schlüssel irgendwo ausserhalb des Wörterbuchs in Gebrauch? */
function isReferenced(rest, key) {
  return new RegExp("[\"'.]" + key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b").test(rest);
}

/** Lokal eingebundene Skripte — dort stehen die zur Laufzeit gebauten Schlüssel. */
function localScripts(html, dir) {
  return [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((src) => !/^(https?:)?\/\//.test(src))
    .map((src) => path.resolve(dir, src.split(/[?#]/)[0]))
    .filter((file) => fs.existsSync(file));
}

function checkPage(html, label, companions) {
  const problems = [];
  const fail = (rule, message) => problems.push({ rule, message: label + ": " + message });

  const keys = markupKeys(html);
  if (keys.length === 0) return problems; // einsprachige Seite

  const langs = switchLangs(html);
  const i18n = objectNamed(html, "I18N");
  const overlay = objectNamed(html, "EN");

  // --- Form A: ein Wörterbuch je Sprache ---
  if (i18n) {
    if (!i18n.value) {
      fail("i18n-dict", "I18N ist nicht als reine Daten lesbar");
      return problems;
    }
    const dicts = i18n.value;
    const names = Object.keys(dicts);

    for (const lang of langs) {
      if (!dicts[lang]) fail("i18n-switch", "Schaltfläche " + lang + " hat kein Wörterbuch");
    }

    const [ref, ...others] = names;
    for (const lang of others) {
      const a = Object.keys(dicts[ref]).sort();
      const b = Object.keys(dicts[lang]).sort();
      for (const k of a) if (!b.includes(k)) fail("i18n-lang-parity", lang + " fehlt der Eintrag " + k);
      for (const k of b) if (!a.includes(k)) fail("i18n-lang-parity", ref + " fehlt der Eintrag " + k);

      // Verschachteltes gleich tief und gleich breit (12 Bereiche, 5 Aussagen).
      for (const k of a) {
        if (!(k in dicts[lang])) continue;
        const sa = shape(dicts[ref][k]);
        const sb = shape(dicts[lang][k]);
        if (sa !== sb) fail("i18n-nested", k + ": " + lang + " ist " + sb + ", " + ref + " ist " + sa);
        const va = dicts[ref][k];
        const vb = dicts[lang][k];
        if (va && typeof va === "object" && !Array.isArray(va) && sa === sb) {
          for (const sub of Object.keys(va)) {
            const ssa = shape(va[sub]);
            const ssb = shape(vb[sub]);
            if (ssa !== ssb) {
              fail("i18n-nested", k + "." + sub + ": " + lang + " ist " + ssb + ", " + ref + " ist " + ssa);
            }
          }
        }
        if (typeof va === "string" && typeof vb === "string") {
          const ta = inlineTags(va).join(",");
          const tb = inlineTags(vb).join(",");
          if (ta !== tb) fail("i18n-markup", k + ": Auszeichnung " + lang + " [" + tb + "] statt [" + ta + "]");
        }
      }
    }

    for (const key of keys) {
      for (const lang of names) {
        if (!(key in dicts[lang])) fail("i18n-key-missing", 'data-i18n="' + key + '" fehlt in ' + lang);
      }
    }

    // Schlüssel wie "insightDiffLarge" entstehen erst in wheel-state.js —
    // die Suche muss die eingebundenen Skripte mitlesen.
    const rest = html.replace(i18n.literal, "") + (companions || "");
    for (const key of Object.keys(dicts[ref] || {})) {
      if (!keys.includes(key) && !isReferenced(rest, key)) {
        fail("i18n-key-unused", "Eintrag " + key + " wird nirgends verwendet");
      }
    }
    return problems;
  }

  // --- Form B: Deutsch im Markup, eine Sprache legt sich darüber ---
  if (overlay) {
    if (!overlay.value) {
      fail("i18n-dict", "EN ist nicht als reine Daten lesbar");
      return problems;
    }
    const en = overlay.value;
    const german = markupValues(html);

    for (const key of keys) {
      if (!(key in en)) fail("i18n-key-missing", 'data-i18n="' + key + '" hat keine Übersetzung');
    }
    for (const key of Object.keys(en)) {
      if (!keys.includes(key)) fail("i18n-key-unused", "Übersetzung " + key + " hängt an keinem Element");
    }
    for (const key of keys) {
      if (!(key in en) || !german.has(key)) continue;
      const de = inlineTags(german.get(key)).join(",");
      const tr = inlineTags(en[key]).join(",");
      if (de !== tr) fail("i18n-markup", key + ": Auszeichnung [" + tr + "] statt [" + de + "]");
    }
    return problems;
  }

  fail("i18n-dict", "data-i18n im Markup, aber kein Wörterbuch gefunden");
  return problems;
}

function checkRepo(root) {
  const pages = findHtmlFiles(root).filter((f) => /data-i18n/.test(fs.readFileSync(f, "utf8")));
  const problems = [];
  for (const file of pages) {
    const html = fs.readFileSync(file, "utf8");
    const companions = localScripts(html, path.dirname(file))
      .map((js) => fs.readFileSync(js, "utf8"))
      .join("\n");
    problems.push(...checkPage(html, path.relative(root, file), companions));
  }
  return { pages, problems };
}

function main() {
  const { pages, problems } = checkRepo(REPO_ROOT);
  if (pages.length === 0) {
    console.log("Keine zweisprachigen Seiten gefunden.");
    return 0;
  }
  if (problems.length === 0) {
    console.log("✓ " + pages.length + " zweisprachige Seite(n) sind vollständig übersetzt.");
    return 0;
  }
  for (const p of problems) console.error("  [" + p.rule + "] " + p.message);
  console.error("\n✗ " + problems.length + " Lücke(n) in der Übersetzung.");
  return 1;
}

if (require.main === module) process.exit(main());

module.exports = {
  checkPage,
  checkRepo,
  markupKeys,
  localScripts,
  markupValues,
  switchLangs,
  objectNamed,
  parseObjectLiteral,
  braceBlock,
  inlineTags,
  shape,
  REPO_ROOT,
};
