'use strict';

const round1 = v => Math.round(v * 10) / 10;

const toValue = (dp, raw) => round1(raw / (dp.factor || 1) - (dp.offset || 0));
const toRaw = (dp, value) => Math.round((value + (dp.offset || 0)) * (dp.factor || 1));
const isWritable = dp => dp.min !== undefined;

/** Antwort (5 Byte) -> Wert. Temperaturen 192 °C (kein Fühler) und -64 °C (Kurzschluss) -> null */
function decode(dp, resp) {
    if (dp.type === 'temp') {
        const t = resp.readInt16BE(2) / 128;
        if (t === 192 || t === -64) return null;
        return round1(t);
    }
    const raw = dp.type === 's16' ? resp.readInt16BE(2) : dp.type === 's8' ? resp.readInt8(2) : resp[2];
    return toValue(dp, raw);
}

/** ioBroker common für einen Datenpunkt */
function commonFor(dp) {
    const common = {
        name: dp.name,
        type: 'number',
        unit: dp.unit ?? '°C',
        read: true,
        write: isWritable(dp),
        role: dp.type === 'temp' ? 'value.temperature' : 'value',
    };
    if (common.write) {
        common.role = dp.unit === '°C' ? 'level.temperature' : 'level';
        common.min = toValue(dp, dp.min);
        common.max = toValue(dp, dp.max);
    }
    return common;
}

module.exports = { commonFor, decode, isWritable, round1, toRaw, toValue };
