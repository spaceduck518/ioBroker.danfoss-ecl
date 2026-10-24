'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { slotsToText, slotsToWords, textToSlots, weekplanAddress, wordsToSlots } = require('../lib/weekplan');

// Beispiel aus der Protokollbeschreibung: Montag Wochenplan I
const MONDAY = [[0x00, 0xfc], [0x0f, 0x00], [0xff, 0x0f]];

test('Wochenplan dekodieren', () => {
    assert.strictEqual(slotsToText(wordsToSlots(MONDAY)), '05:00-10:00, 16:00-22:00');
    assert.strictEqual(slotsToText(new Array(48).fill(false)), '-');
    assert.strictEqual(slotsToText(new Array(48).fill(true)), '00:00-24:00');
});

test('Wochenplan kodieren (Rundreise)', () => {
    assert.deepStrictEqual(slotsToWords(textToSlots('05:00-10:00, 16:00-22:00')), MONDAY);
    for (const t of ['06:30-08:00', '00:00-01:00, 12:00-13:30, 23:30-24:00', '-']) {
        assert.strictEqual(slotsToText(textToSlots(t)), t);
    }
});

test('Wochenplan Eingabe prüfen', () => {
    assert.throws(() => textToSlots('1:00-2:00, 3:00-4:00, 5:00-6:00, 7:00-8:00'), /Maximal 3/);
    assert.throws(() => textToSlots('06:15-08:00'), /halbe Stunden/);
    assert.throws(() => textToSlots('10:00-08:00'), /Zeitraum/);
    assert.throws(() => textToSlots('morgens'), /Format/);
});

test('Wochenplan Adressen (Tabelle 7)', () => {
    assert.strictEqual(weekplanAddress(1, 0, 0), 0x72);
    assert.strictEqual(weekplanAddress(2, 0, 0), 0x75);
    assert.strictEqual(weekplanAddress(1, 1, 0), 0x78);
    assert.strictEqual(weekplanAddress(2, 6, 2), 0x9b);
});
