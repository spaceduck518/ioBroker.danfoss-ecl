'use strict';

/*
 * Wochenplan (nur im EEPROM): Heizkreis 1 = Wochenplan I, Heizkreis 2 = Wochenplan II.
 * 48 Bit pro Tag, 1 Bit = halbe Stunde, 1 = Komfort, 0 = Absenk, verteilt auf 3 EEPROM-Worte.
 * Pro Wort: Datenbyte 1 = 8 Halbstunden, Datenbyte 2 = die nächsten 8, Bit 0 = früheste.
 * Max. 3 Komfortperioden pro Tag, die ECL prüft das nicht selbst!
 */

const DAYS = [
    { id: 'monday', name: 'Montag' },
    { id: 'tuesday', name: 'Dienstag' },
    { id: 'wednesday', name: 'Mittwoch' },
    { id: 'thursday', name: 'Donnerstag' },
    { id: 'friday', name: 'Freitag' },
    { id: 'saturday', name: 'Samstag' },
    { id: 'sunday', name: 'Sonntag' },
];

const MAX_PERIODS = 3;

/**
 * @param {1|2} circuit
 * @param {number} day 0 = Montag
 * @param {number} word 0..2
 */
const weekplanAddress = (circuit, day, word) => 0x72 + day * 6 + (circuit - 1) * 3 + word;

const hhmm = slot => `${String(Math.floor(slot / 2)).padStart(2, '0')}:${slot % 2 ? '30' : '00'}`;

/** @param {number[][]} words 3x [Datenbyte 1, Datenbyte 2] */
function wordsToSlots(words) {
    const slots = [];
    for (const [b1, b2] of words) {
        for (const b of [b1, b2]) {
            for (let bit = 0; bit < 8; bit++) slots.push(((b >> bit) & 1) === 1);
        }
    }
    return slots;
}

function slotsToWords(slots) {
    const words = [];
    for (let w = 0; w < 3; w++) {
        const bytes = [0, 0];
        for (let i = 0; i < 16; i++) {
            if (slots[w * 16 + i]) bytes[i >> 3] |= 1 << (i & 7);
        }
        words.push(bytes);
    }
    return words;
}

/** -> "05:00-10:00, 16:00-22:00" bzw. "-" ohne Komfortzeit */
function slotsToText(slots) {
    const periods = [];
    let start = 0;
    for (let i = 0; i < 48; i++) {
        if (slots[i] && !slots[i - 1]) start = i;
        if (slots[i] && !slots[i + 1]) periods.push(`${hhmm(start)}-${hhmm(i + 1)}`);
    }
    return periods.length ? periods.join(', ') : '-';
}

function textToSlots(text) {
    const slots = new Array(48).fill(false);
    const t = String(text ?? '').trim();
    if (t === '' || t === '-') return slots;
    const parts = t.split(',');
    if (parts.length > MAX_PERIODS) throw new Error(`Maximal ${MAX_PERIODS} Komfortperioden pro Tag`);
    for (const part of parts) {
        const p = part.trim();
        const m = p.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/);
        if (!m) throw new Error(`Ungültige Periode "${p}", Format HH:MM-HH:MM`);
        if (![m[2], m[4]].every(mm => mm === '00' || mm === '30')) throw new Error(`Nur volle oder halbe Stunden: "${p}"`);
        const from = Number(m[1]) * 2 + (m[2] === '30' ? 1 : 0);
        const to = Number(m[3]) * 2 + (m[4] === '30' ? 1 : 0);
        if (from >= to || to > 48) throw new Error(`Ungültiger Zeitraum "${p}"`);
        for (let i = from; i < to; i++) slots[i] = true;
    }
    return slots;
}

module.exports = { DAYS, weekplanAddress, wordsToSlots, slotsToWords, slotsToText, textToSlots };
