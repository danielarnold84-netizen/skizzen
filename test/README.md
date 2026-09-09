# Tests

Drei Stufen, absichtlich getrennt:

```
npm run lint    # Konventionen + Übersetzungen (tools/)
npm test        # Unit-Tests (test/)
npm run check   # beides — ohne jede Abhängigkeit
npm run smoke   # die Seiten im Browser (smoke/) — braucht Playwright
```

`lint` und `test` laufen in einem frischen Checkout ohne `npm install`.
Nur `smoke` braucht einen Browser; fehlt er, überspringen sich die Tests mit
einem Hinweis, statt fehlzuschlagen. In CI läuft der Browser-Job getrennt
und mit `SMOKE_REQUIRED=1`, damit ein fehlender Browser dort nicht als
"alles übersprungen, also grün" durchgeht.

## `lint-pages.test.js`

Prüft den Linter selbst an kleinen Beispielseiten und am Ende das echte Repo.
Der Linter deckt ab, was beim Kopieren einer Seite erfahrungsgemäss verloren
geht: das im README zugesagte `noindex,nofollow`, Viewport, `lang`, charset,
Titel, tote relative Links, `target="_blank"` ohne `rel="noopener"`, doppelte
IDs — und ob jede Skizze von der Startseite aus verlinkt ist.

## `wheel-state.test.js`

Deckt `wheel/wheel-state.js` ab — den einzigen Ort in diesem Repo, an dem ein
Fehler Nutzerdaten beschädigt statt nur schief auszusehen. Schwerpunkte:

- **Migration** der alten Achsen-Reihenfolge auf die Bereiche 1..12, inklusive
  Idempotenz (zweimal laufen darf nichts verdrehen)
- **Snapshots**: dieselbe Migration, die dort bisher fehlte
- **kaputte gespeicherte Daten** — halbe Schreibvorgänge, fremde Typen,
  falsche Längen dürfen die Seite nie blockieren
- **Hebel-Reihenfolge**, Insight-Schwellen, Quick-Check-Durchschnitt
- **Geometrie**: Ziehen auf einen Punkt muss wieder denselben Wert ergeben

Das Rendern selbst ist nicht abgedeckt — dafür bräuchte es einen Browser.
`wheel-state.js` enthält bewusst keinen DOM-Zugriff, damit die Logik ohne
einen prüfbar bleibt.

## `i18n-parity.test.js`

Deckt `tools/i18n-parity.js` ab — die Prüfung der beiden zweisprachigen
Seiten. Beide sind unterschiedlich gebaut (`wheel` hat ein Wörterbuch je
Sprache, `sis-ulf` legt Englisch über das deutsche Markup) und teilen
dieselbe Schwachstelle: ein neuer Textbaustein wird ergänzt, die
Gegensprache vergessen. Die Seite bleibt heil — sie zeigt beim Umschalten
nur weiterhin Deutsch.

Geprüft wird deshalb der Schlüsselsatz beider Wörterbücher (auch
verschachtelt: 12 Bereiche, 5 Aussagen je Bereich), ob jeder
`data-i18n`-Schlüssel eine Übersetzung hat, ob jeder Eintrag noch benutzt
wird — auch solche, die erst `wheel-state.js` zusammenbaut — und ob die
Auszeichnung im Text (`<b>`, `<br>`) in beiden Sprachen dieselbe ist.

Das Wörterbuch wird als Literal gelesen und nur dann ausgewertet, wenn nach
dem Entfernen aller Strings nichts Ausführbares übrig bleibt.

## `smoke/` — die Seiten im Browser

Kein Unit-Test, sondern die Gegenprobe: `pages.smoke.js` öffnet jede Seite
des Repos einmal und besteht darauf, dass nichts in der Konsole bricht, kein
lokaler Verweis ins Leere zeigt und sichtbarer Text ankommt.

`wheel.smoke.js` prüft die Verdrahtung, die `wheel-state.js` allein nicht
zeigen kann: dass der Regler wirklich am Zustand hängt, dass Speichern einen
Neustart übersteht, dass ein ungespeicherter Wert eben nicht überlebt — und
vor allem, dass ein alter gespeicherter Stand beim Öffnen tatsächlich
migriert wird und nicht nur in der Funktion, die das könnte.
