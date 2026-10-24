'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildDatapoints } = require('../lib/datapoints');
const { commonFor, decode, toRaw } = require('../lib/convert');

const answer = (d1, d2) => Buffer.from([0x02, 0xce, d1, d2, 0x02 ^ 0xce ^ d1 ^ d2]);
const byId = (dps, id) => dps.find(dp => dp.id === id);

test('C67: applikationsabhängige Adressen', () => {
    const dps = buildDatapoints('C67', { hotwaterOffset: 15 });
    assert.strictEqual(byId(dps, 'circuit2.heatingCurve').adr, 0xed9);
    assert.strictEqual(byId(dps, 'hotwater.setpointNight').adr, 0xed1);
    assert.strictEqual(byId(dps, 'hotwater.setpointNight').offset, 15);
    assert.strictEqual(byId(dps, 'circuit2.flowMax').adr, 0xedc);
    assert.strictEqual(new Set(dps.map(dp => dp.id)).size, dps.length);
});

test('Unbekannte Applikation: nur Messwerte und gemeinsame Parameter', () => {
    const dps = buildDatapoints('X99');
    assert.ok(byId(dps, 'sensors.outdoor'));
    assert.ok(byId(dps, 'circuit1.heatingCurve'));
    assert.ok(!byId(dps, 'hotwater.setpointDay'));
});

test('Dekodieren', () => {
    const dps = buildDatapoints('C67', { hotwaterOffset: 15 });
    assert.strictEqual(decode(byId(dps, 'sensors.sensor1'), answer(0x00, 0xff)), 2); // Doku: 1,99 °C
    assert.strictEqual(decode(byId(dps, 'sensors.outdoor'), answer(0xfe, 0x00)), -4);
    assert.strictEqual(decode(byId(dps, 'sensors.sensor3'), answer(0x60, 0x00)), null); // 192 °C
    assert.strictEqual(decode(byId(dps, 'sensors.sensor3'), answer(0xe0, 0x00)), null); // -64 °C
    assert.strictEqual(decode(byId(dps, 'circuit1.heatingCurve'), answer(0x15, 0x19)), 2.1);
    assert.strictEqual(decode(byId(dps, 'circuit1.parallelDisplacement'), answer(0xfe, 0x00)), -2);
    assert.strictEqual(decode(byId(dps, 'circuit1.roomInfluenceMax'), answer(0xff, 0xdc)), -36);
    assert.strictEqual(decode(byId(dps, 'hotwater.setpointDay'), answer(60, 0)), 45);
});

test('Wertebereiche in ioBroker-Einheiten', () => {
    const dps = buildDatapoints('C67', { hotwaterOffset: 15 });
    const hw = byId(dps, 'hotwater.setpointNight');
    assert.deepStrictEqual([commonFor(hw).min, commonFor(hw).max], [-5, 95]);
    assert.strictEqual(toRaw(hw, 45), 60);
    const curve = byId(dps, 'circuit1.heatingCurve');
    assert.deepStrictEqual([commonFor(curve).min, commonFor(curve).max], [0.2, 3.4]);
    assert.strictEqual(commonFor(byId(dps, 'sensors.outdoor')).write, false);
});
