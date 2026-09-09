# skizzen.arnoldcoaching.de

Sandkasten für Skizzen, Mockups und Konzeptseiten — getrennt vom Live-Auftritt arnoldcoaching.de, damit Daniel hier frei pushen kann ohne Review-Klicks.

**Domain:** https://skizzen.arnoldcoaching.de · CNAME → `danielarnold84-netizen.github.io`

**Konvention:** Jede Skizze in eigenem Unterordner, eigenes `index.html`, alle mit `<meta name="robots" content="noindex,nofollow">`, und von der Startseite aus verlinkt.

**Prüfen:** `npm run check` — prüft diese Konvention auf allen Seiten,
kontrolliert die Übersetzungen der zweisprachigen Seiten und fährt die
Unit-Tests. Läuft ohne Installation (Node ≥ 20) und bei jedem Push
automatisch.

`npm run smoke` öffnet zusätzlich jede Seite in einem echten Browser. Das
ist der einzige Teil mit einer Abhängigkeit (Playwright) und läuft in CI als
eigener Job; fehlt der Browser lokal, überspringt sich der Lauf. Details in
[`test/README.md`](test/README.md).
