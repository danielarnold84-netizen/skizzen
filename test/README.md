# Tests

Zwei Dinge werden geprüft — beide ohne Abhängigkeiten, mit dem eingebauten
Test-Runner von Node:

```
npm run lint    # Konventionen aller Seiten (tools/lint-pages.js)
npm test        # Unit-Tests (test/)
npm run check   # beides
```

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
