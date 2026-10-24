'use strict';

/*
 * Datenpunkte und Adressen laut Protokollbeschreibung.
 *
 * adr:     RAM-Adresse (12 Bit)
 * type:    temp = 16 Bit signed / 128, s16 = 16 Bit signed, u8 / s8 = 8 Bit (Datenbyte 1)
 * factor/offset: Wert = Rohwert / factor - offset
 * min/max: gültiger Bereich als ROHWERT -> nur dann beschreibbar (die ECL prüft das nicht selbst!)
 * optional: Lesefehler nur im Debug-Log (Sensor/Wert in vielen Applikationen nicht vorhanden)
 */

const APP_TYPES = ['A', 'b', 'C', 'd', 'E', 'F', 'G', 'H', 'L', 'n', 'o', 'P', 'U'];

const MODES = { 0: 'Handbetrieb', 1: 'Automatik (Uhr)', 2: 'Komfort', 3: 'Absenk', 4: 'Standby' };

const CHANNELS = {
    sensors: 'Fühler',
    circuit1: 'Heizkreis 1',
    circuit2: 'Heizkreis 2',
    circuit3: 'Heizkreis 3',
    hotwater: 'Warmwasser',
};

// Messwerte (Tabelle 4), nur lesen
const MEASUREMENTS = [
    { id: 'sensors.outdoor', name: 'Außentemperatur', adr: 0xe3c },
    { id: 'sensors.sensor1', name: 'Fühler 1', adr: 0xe3a, optional: true },
    { id: 'sensors.sensor2', name: 'Fühler 2', adr: 0xe38, optional: true },
    { id: 'sensors.sensor3', name: 'Fühler 3', adr: 0xe36, optional: true },
    { id: 'sensors.sensor4', name: 'Fühler 4', adr: 0xe34, optional: true },
    { id: 'sensors.sensor5', name: 'Fühler 5', adr: 0xe32, optional: true },
    { id: 'sensors.sensor6', name: 'Fühler 6', adr: 0xe30, optional: true },
    { id: 'circuit1.roomTemperature', name: 'Raumtemperatur', adr: 0xe3e, optional: true },
    { id: 'circuit2.roomTemperature', name: 'Raumtemperatur', adr: 0xe40, optional: true },
    { id: 'circuit1.flowCalculated', name: 'Berechnete Vorlauftemperatur (Soll)', adr: 0xe46 },
    { id: 'circuit2.flowCalculated', name: 'Berechnete Vorlauftemperatur (Soll)', adr: 0xe48 },
    { id: 'circuit1.returnCalculated', name: 'Berechnete Rücklauftemperatur', adr: 0xe4a },
    { id: 'circuit2.returnCalculated', name: 'Berechnete Rücklauftemperatur', adr: 0xe4c },
].map(d => ({ ...d, type: 'temp' }));

// Parameter, die in allen Applikationen an derselben Adresse liegen (Tabelle 5 + 6)
const COMMON_PARAMS = {
    'circuit1.heatingCurve': 0xec9,
    'circuit1.summerCutout': 0xec2,
    'circuit2.summerCutout': 0xec3,
    'circuit1.roomSetpointDay': 0xe9e,
    'circuit1.roomSetpointNight': 0xea0,
    'circuit2.roomSetpointDay': 0xe9f,
    'circuit2.roomSetpointNight': 0xea1,
    'circuit1.roomInfluenceMax': 0xe76,
    'circuit1.roomInfluenceMin': 0xe78,
    'circuit2.roomInfluenceMax': 0xe72,
    'circuit2.roomInfluenceMin': 0xe74,
};

// Applikationsabhängige Adressen (Anhang 1)
const C25 = {
    'circuit1.parallelDisplacement': 0xea8,
    'circuit1.flowMin': 0xecb,
    'circuit1.flowMax': 0xecc,
    'hotwater.setpointDay': 0xed0,
    'hotwater.setpointNight': 0xed1,
};
const C55 = {
    'circuit2.heatingCurve': 0xecc,
    'circuit1.parallelDisplacement': 0xea9,
    'circuit2.parallelDisplacement': 0xeaa,
    'circuit1.flowMin': 0xece,
    'circuit2.flowMin': 0xecf,
    'circuit1.flowMax': 0xed0,
    'circuit2.flowMax': 0xed1,
    'hotwater.setpointDay': 0xed8,
    'hotwater.setpointNight': 0xed9,
};
const C60 = {
    'circuit2.heatingCurve': 0xed9,
    'circuit1.parallelDisplacement': 0xea8,
    'circuit2.parallelDisplacement': 0xea9,
    'circuit1.flowMin': 0xecb,
    'circuit2.flowMin': 0xedb,
    'circuit1.flowMax': 0xecc,
    'circuit2.flowMax': 0xedc,
};

const APPLICATIONS = {
    C14: { 'circuit1.flowMin': 0xea6, 'circuit1.flowMax': 0xecc },
    C25,
    C35: C25,
    C37: {
        'circuit1.parallelDisplacement': 0xea7,
        'circuit1.flowMin': 0xecd,
        'circuit1.flowMax': 0xecc,
        'hotwater.setpointDay': 0xed0,
        'hotwater.setpointNight': 0xed1,
    },
    C47: C25,
    C55,
    C60,
    C62: C60,
    C66: C25,
    C67: { ...C60, 'hotwater.setpointDay': 0xed0, 'hotwater.setpointNight': 0xed1 },
    C75: C55,
    P16: { 'hotwater.setpointDay': 0xed0, 'hotwater.setpointNight': 0xed1 },
    P17: { 'hotwater.setpointDay': 0xed0, 'hotwater.setpointNight': 0xed1 },
    P20: { 'circuit1.parallelDisplacement': 0xea8, 'circuit1.flowMin': 0xecb, 'circuit1.flowMax': 0xecc },
    P30: { 'circuit1.parallelDisplacement': 0xea8, 'circuit1.flowMin': 0xecb, 'circuit1.flowMax': 0xecc },
};

const temp8 = (name, min, max) => ({ name, type: 'u8', min, max, unit: '°C' });

// Definition je Parameter (ohne Heizkreis-Präfix)
const PARAM_DEFS = {
    heatingCurve: { name: 'Heizkurve', type: 'u8', factor: 10, min: 2, max: 34, unit: '' },
    parallelDisplacement: { name: 'Parallelverschiebung', type: 's8', min: -9, max: 9, unit: 'K' },
    flowMin: temp8('Vorlauftemperatur Minimum', 10, 110),
    flowMax: temp8('Vorlauftemperatur Maximum', 10, 110),
    summerCutout: temp8('Sommerabschaltung', 10, 30),
    roomSetpointDay: temp8('Raumtemperatur Sollwert Tag (Komfort)', 10, 30),
    roomSetpointNight: temp8('Raumtemperatur Sollwert Nacht (Absenk)', 10, 30),
    roomInfluenceMax: { name: 'Raumeinfluss Maximum', type: 's16', min: -99, max: 0, unit: '' },
    roomInfluenceMin: { name: 'Raumeinfluss Minimum', type: 's16', min: 0, max: 99, unit: '' },
    setpointDay: temp8('Warmwasser Sollwert Normalbetrieb', 10, 110),
    setpointNight: temp8('Warmwasser Sollwert Absenkbetrieb', 10, 110),
};

/**
 * Liefert alle Datenpunkte (Messwerte + Parameter) für eine Applikation.
 * Unbekannte Applikation -> nur Messwerte und die gemeinsamen Parameter.
 *
 * @param {string|null} application z.B. "C67"
 * @param {{hotwaterOffset?: number}} [options]
 */
function buildDatapoints(application, { hotwaterOffset = 0 } = {}) {
    const addresses = { ...COMMON_PARAMS, ...(APPLICATIONS[application] || {}) };
    const params = Object.entries(addresses).map(([id, adr]) => {
        const def = PARAM_DEFS[id.split('.')[1]];
        const dp = { id, adr, ...def };
        if (id.startsWith('hotwater.')) dp.offset = hotwaterOffset;
        return dp;
    });
    return [...MEASUREMENTS, ...params];
}

module.exports = { APP_TYPES, APPLICATIONS, CHANNELS, MODES, buildDatapoints };
