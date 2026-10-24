# ioBroker.danfoss-ecl

ioBroker-Adapter für die Heizungsregler **Danfoss ECL Comfort 200/300** über RS232
(Frontbuchse der ECL 300 oder RS232-Optionskarte ECA 81).

Grundlage ist die Danfoss-Protokollbeschreibung „ECL Comfort 200/300 RS232 protocol“ (März 2000),
siehe [Protokoll](#protokoll).

## Funktionen

- Messwerte: Außentemperatur, Fühler 1–6, Raumtemperaturen, berechnete Vor-/Rücklauftemperaturen
- Betriebsart je Heizkreis (Handbetrieb, Automatik, Komfort, Absenk, Standby)
- Parameter lesen **und schreiben**: Raumtemperatur-Sollwerte, Sommerabschaltung, Heizkurve,
  Parallelverschiebung, Vorlauf min/max, Raumeinfluss, Warmwasser-Sollwerte
- Applikation (z.B. C67) wird erkannt, die Adressen der applikationsabhängigen Parameter werden
  automatisch gewählt
- Wochenplan Heizkreis 1 + 2 lesen, z.B. `05:00-10:00, 16:00-22:00`, optional schreiben

## Voraussetzungen

- ECL Comfort 300: Kabel an die Frontbuchse (RJ12) oder RS232-Optionskarte ECA 81 (087B1151)
- ECL Comfort 200: RS232-Optionskarte ECA 81
- USB-RS232-Adapter am ioBroker-Rechner. Der Benutzer `iobroker` muss auf den Port zugreifen
  dürfen (unter Linux Gruppe `dialout`)

Die Belegung des Kabels steht in der Danfoss-Protokollbeschreibung (Kapitel 3, siehe [Protokoll](#protokoll)).

## Installation

Der Adapter ist (noch) nicht im offiziellen ioBroker-Repository und wird direkt von GitHub
installiert:

**Admin:** *Adapter* → GitHub-Symbol („Installieren aus eigener URL“) → Reiter *Benutzerdefiniert* →
URL `https://github.com/spaceduck518/ioBroker.danfoss-ecl` eintragen → *Installieren*.
Danach unter *Instanzen* eine Instanz anlegen, falls das nicht automatisch passiert.

**Konsole:**

```bash
iob url https://github.com/spaceduck518/ioBroker.danfoss-ecl
iob add danfoss-ecl
```

Ein Update funktioniert genauso: erneut über die URL installieren, die Instanz startet danach neu.

Während der Installation wird das Modul `serialport` für den Rechner eingerichtet, das kann
einige Minuten dauern.

## Konfiguration

| Einstellung | Bedeutung |
|---|---|
| Serieller Port | z.B. `/dev/ttyUSB0`. Besser `/dev/serial/by-id/…`, der Name ändert sich nach einem Neustart nicht |
| Applikation | `Automatisch erkennen` oder fest vorgeben |
| Abfrageintervall | Minuten zwischen zwei Abfragen (Standard 15). Ein Durchlauf dauert ca. 20–25 s |
| Wochenplan lesen alle | Stunden (Standard 24) |
| Warmwasser-Offset | Datenpunkt = Wert der ECL minus Offset. In der Anlage des Autors 15 (Display 60 = 45 °C) |
| Wochenplan schreiben erlauben | Schreibt dauerhaft ins EEPROM der ECL, standardmäßig aus |

## Datenpunkte

| Datenpunkt | Inhalt |
|---|---|
| `info.connection` | ECL antwortet |
| `info.application` | Applikation laut ECL, z.B. `C67` |
| `info.lastUpdate` | Zeitpunkt der letzten erfolgreichen Abfrage |
| `sensors.outdoor`, `sensors.sensor1` … `sensor6` | Temperaturen. `null` = kein Fühler (192 °C) oder Kurzschluss (−64 °C) |
| `circuitN.mode` | Betriebsart (0 Handbetrieb, 1 Automatik, 2 Komfort, 3 Absenk, 4 Standby), nur lesen |
| `circuitN.roomTemperature` | Raumtemperatur (falls Raumfühler vorhanden) |
| `circuitN.flowCalculated` / `returnCalculated` | Berechnete Vorlauf-/Rücklauftemperatur (Soll) |
| `circuitN.roomSetpointDay` / `roomSetpointNight` | Raumtemperatur-Sollwerte, 10–30 °C |
| `circuitN.summerCutout` | Sommerabschaltung, 10–30 °C |
| `circuitN.heatingCurve` | Heizkurve 0,2–3,4 |
| `circuitN.parallelDisplacement` | Parallelverschiebung −9…9 K |
| `circuitN.flowMin` / `flowMax` | Vorlauftemperatur-Begrenzung 10–110 °C |
| `circuitN.roomInfluenceMax` / `roomInfluenceMin` | Raumeinfluss −99…0 / 0…99 |
| `circuitN.weekplan.monday` … `sunday` | Komfortzeiten, max. 3 pro Tag, `-` = ganztägig Absenk |
| `hotwater.setpointDay` / `setpointNight` | Warmwasser-Sollwerte (mit Offset) |

Welche Parameter vorhanden sind, hängt von der Applikation ab.

### Schreiben

Ein `setState` **ohne ack** auf einen beschreibbaren Datenpunkt wird an die ECL gesendet und zur
Kontrolle zurückgelesen. Werte außerhalb des gültigen Bereichs werden abgelehnt, die ECL selbst
prüft das nicht.

- Parameter werden ins **RAM** geschrieben: sofort aktiv und im Display sichtbar, nach einem
  Stromausfall gelten wieder die Werte aus dem EEPROM.
- Der Wochenplan liegt nur im **EEPROM** (dauerhaft, begrenzte Schreibzyklen). Das Display der
  ECL zeigt den neuen Plan erst, wenn die Anzeige neu aufgerufen wird.

Nicht möglich laut Protokoll: Betriebsart schreiben, Uhrzeit/Datum lesen oder stellen.

## Getestete Applikationen

| Applikation | Status |
|---|---|
| C67 (ECL Comfort 300) | ✅ an einer echten Anlage getestet |
| alle anderen | Adressen aus der Protokollbeschreibung übernommen, ungetestet |

Rückmeldungen zu anderen Applikationen sind sehr willkommen, gern als
[Issue](https://github.com/spaceduck518/ioBroker.danfoss-ecl/issues): Applikation, welche Werte
stimmen und welche nicht, Ausschnitt aus dem Log (Meldungen „ECL meldet …“).

## Beispiel: Warmwasser-Automation

[`examples/warmwasser-automation.js`](examples/warmwasser-automation.js) ist ein Skript für den
JavaScript-Adapter aus der Anlage des Autors: Warmwasser-Sollwert je nach Anwesenheit umschalten
und auf Anforderung 15 Minuten lang anheben. Datenpunkte wie `hm-rega.0.950` müssen an die
eigene Installation angepasst werden.

## Protokoll

Der Adapter setzt die Protokollbeschreibung von Danfoss um:

> **ECL Comfort 200/300 RS232 protocol**, Danfoss A/S, Building Controls Division, März 2000

Eine Kopie ist z.B. hier abrufbar: [ECL300 RS-232 protocol (Scribd)](https://de.scribd.com/document/395854402/ECL300-RS-232-protocol-pdf)

Das Dokument liegt bewusst nicht in diesem Repository: Danfoss erlaubt die unveränderte
Weitergabe, aber nicht die Verbreitung zusammen mit anderen Produkten ohne schriftliche
Genehmigung.

Kurzfassung:

- 1200 Baud, 8 Datenbits, Parität odd, 1 Stopbit, mindestens 400 ms Pause zwischen zwei Kommandos
- Anfrage `CMD ADR D1 D2 CHK`, Antwort `ERR CMD D1 D2 CHK` (`ERR` 02 = OK),
  `CHK` = XOR über die ersten vier Bytes
- RAM-Adressen sind 12 Bit (z.B. `E3C`): Lesen `Cx`, Schreiben 16 Bit `Dx`, Schreiben 8 Bit `Fx`,
  `x` = erste Stelle der Adresse
- Temperaturen: 16 Bit mit Vorzeichen / 128. 192 °C = kein Fühler, −64 °C = Kurzschluss
- Wochenplan im EEPROM (Lesen `80`, Schreiben `90`), 48 Bit pro Tag, ein Bit je halbe Stunde

## Haftungsausschluss

Der Adapter schreibt auf Wunsch Parameter und Wochenpläne in die ECL. Die ECL prüft geschriebene
Werte nicht selbst. Der Adapter begrenzt die Werte auf die Bereiche aus der Protokollbeschreibung,
die Nutzung erfolgt trotzdem auf eigene Gefahr. Danfoss ist Inhaber der Marke und des Protokolls,
dieses Projekt steht in keiner Verbindung zu Danfoss.

## Entwicklung

```bash
npm test
```

Die Tests prüfen Frames, Prüfsummen, Wochenplan-Kodierung und Umrechnungen anhand der Beispiele
aus der Protokollbeschreibung. Drei Prüfsummen in den Beispielen der Doku sind falsch
(`CE 3A` → F4 statt 4F, `DE 76 FF C4` → 93 statt 89, `CD 0D` → C0 statt C2).

## Changelog

### 0.1.1
- Installation direkt von GitHub, README für andere Nutzer überarbeitet

### 0.1.0
- Erste Version (aus dem Skript v0.4)
