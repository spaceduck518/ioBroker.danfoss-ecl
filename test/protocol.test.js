'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildFrame, checksumOk, ramReadFrame, ramWrite16Frame, ramWrite8Frame } = require('../lib/protocol');

const bytes = buf => [...buf];

test('Prüfsumme: XOR über die ersten 4 Bytes (Beispiele aus der Protokollbeschreibung)', () => {
    // Doku nennt hier 4F, richtig ist CE XOR 3A = F4
    assert.deepStrictEqual(bytes(buildFrame(0xce, 0x3a)), [0xce, 0x3a, 0, 0, 0xf4]);
    assert.deepStrictEqual(bytes(buildFrame(0x80, 0x72)), [0x80, 0x72, 0, 0, 0xf2]);
    assert.ok(checksumOk(Buffer.from([0x02, 0xce, 0x00, 0xff, 0x33])));
    assert.ok(!checksumOk(Buffer.from([0x02, 0xce, 0x00, 0xff, 0x34])));
});

test('RAM-Frames aus 12-Bit-Adressen', () => {
    assert.deepStrictEqual(bytes(ramReadFrame(0xe76)), [0xce, 0x76, 0, 0, 0xb8]);
    assert.deepStrictEqual(bytes(ramReadFrame(0xec9)), [0xce, 0xc9, 0, 0, 0x07]);
    // Raumtemperatur Tag Heizkreis 1 = 25: FE 9E 19 00 79
    assert.deepStrictEqual(bytes(ramWrite8Frame(0xe9e, 25)), [0xfe, 0x9e, 0x19, 0x00, 0x79]);
    // Raumeinfluss max = -60: DE 76 FF C4 (Prüfsumme in der Doku falsch angegeben)
    assert.deepStrictEqual(bytes(ramWrite16Frame(0xe76, -60)).slice(0, 4), [0xde, 0x76, 0xff, 0xc4]);
});
