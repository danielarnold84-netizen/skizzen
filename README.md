# skizzen.arnoldcoaching.de

Sandkasten für Skizzen, Mockups und Konzeptseiten — getrennt vom Live-Auftritt arnoldcoaching.de, damit Daniel hier frei pushen kann ohne Review-Klicks.

**Domain:** https://skizzen.arnoldcoaching.de · CNAME → `danielarnold84-netizen.github.io`

**Konvention:** Jede Skizze in eigenem Unterordner, eigenes `index.html`, alle mit `<meta name="robots" content="noindex,nofollow">`, und von der Startseite aus verlinkt.

**Prüfen:** `npm run check` — prüft diese Konvention auf allen Seiten und
fährt die Unit-Tests. Läuft ohne Installation (Node ≥ 20, keine
Abhängigkeiten) und bei jedem Push automatisch. Details in
[`test/README.md`](test/README.md).
