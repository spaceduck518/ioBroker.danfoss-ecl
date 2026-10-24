'use strict';

const utils = require('@iobroker/adapter-core');
const {
    CMD_READ_EEPROM,
    CMD_READ_MODE,
    CMD_WRITE_EEPROM16,
    EclConnection,
    EclError,
    buildFrame,
    ramReadFrame,
    ramWrite16Frame,
    ramWrite8Frame,
} = require('./lib/protocol');
const { APP_TYPES, APPLICATIONS, CHANNELS, MODES, buildDatapoints } = require('./lib/datapoints');
const { commonFor, decode, isWritable, toRaw, toValue } = require('./lib/convert');
const { DAYS, slotsToText, slotsToWords, textToSlots, weekplanAddress, wordsToSlots } = require('./lib/weekplan');

const RECONNECT_DELAY = 30 * 1000;
const WEEKPLAN_ID = /^circuit([12])\.weekplan\.(\w+)$/;

class DanfossEcl extends utils.Adapter {
    constructor(options = {}) {
        super({ ...options, name: 'danfoss-ecl' });
        this.ecl = null;
        this.datapoints = new Map();
        this.modeCircuits = [1, 2, 3];
        this.failing = new Set();
        this.timers = { start: null, poll: null, weekplan: null };
        this.unloading = false;

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        await this.setStateAsync('info.connection', false, true);
        if (!this.config.port) {
            this.log.error('Kein serieller Port konfiguriert');
            return;
        }
        this.ecl = new EclConnection({
            path: this.config.port,
            commandGap: Number(this.config.commandGap) || 500,
            responseTimeout: Number(this.config.responseTimeout) || 1500,
            debug: msg => this.log.silly(msg),
        });
        this.ecl.on('close', () => {
            if (this.unloading) return;
            this.log.warn('Serielle Verbindung geschlossen, wird bei der nächsten Abfrage neu geöffnet');
            this.setState('info.connection', false, true);
        });
        await this.start();
    }

    /** Port öffnen, Applikation bestimmen, Objekte anlegen, Polling starten. Wiederholt sich bis es klappt. */
    async start() {
        this.timers.start = null;
        const retry = msg => {
            this.log.error(`${msg} – neuer Versuch in ${RECONNECT_DELAY / 1000} s`);
            this.timers.start = setTimeout(() => this.start(), RECONNECT_DELAY);
        };

        try {
            await this.ecl.open();
        } catch (err) {
            return retry(`Port ${this.config.port} kann nicht geöffnet werden: ${err.message}`);
        }

        let detected = null;
        try {
            const resp = await this.ecl.request(buildFrame(CMD_READ_EEPROM, 0x09));
            detected = (APP_TYPES[resp[2]] || '?') + resp[3];
            await this.setStateAsync('info.application', detected, true);
        } catch (err) {
            this.log.warn(`Applikation konnte nicht gelesen werden: ${err.message}`);
        }

        const configured = this.config.application && this.config.application !== 'auto' ? this.config.application : null;
        const application = configured || detected;
        if (!application) return retry('Keine Antwort von der ECL');

        if (!APPLICATIONS[application]) {
            this.log.warn(`Applikation ${application} ist nicht in der Adresstabelle, es werden nur Messwerte und allgemeine Parameter gelesen`);
        } else if (configured && detected && configured !== detected) {
            this.log.warn(`Konfigurierte Applikation ${configured} weicht von der ECL (${detected}) ab`);
        } else {
            this.log.info(`Applikation ${application}`);
        }

        await this.createObjects(application);
        this.subscribeStates('*');
        await this.poll();
        await this.pollWeekplans();
    }

    async createObjects(application) {
        const dps = buildDatapoints(application, { hotwaterOffset: Number(this.config.hotwaterOffset) || 0 });
        this.datapoints = new Map(dps.map(dp => [dp.id, dp]));
        const known = new Set(['info.connection', 'info.application', 'info.lastUpdate']);

        const channels = new Set(['circuit1', 'circuit2', 'circuit3', ...dps.map(dp => dp.id.split('.')[0])]);
        for (const ch of channels) {
            await this.extendObjectAsync(ch, { type: 'channel', common: { name: CHANNELS[ch] }, native: {} });
        }

        for (const dp of dps) {
            await this.extendObjectAsync(dp.id, {
                type: 'state',
                common: commonFor(dp),
                native: { address: dp.adr.toString(16).toUpperCase() },
            });
            known.add(dp.id);
        }

        for (const circuit of [1, 2, 3]) {
            const id = `circuit${circuit}.mode`;
            await this.extendObjectAsync(id, {
                type: 'state',
                common: { name: 'Betriebsart', type: 'number', role: 'value', read: true, write: false, states: MODES },
                native: {},
            });
            known.add(id);
        }

        for (const circuit of [1, 2]) {
            await this.extendObjectAsync(`circuit${circuit}.weekplan`, {
                type: 'folder',
                common: { name: 'Wochenplan (Komfortzeiten)' },
                native: {},
            });
            for (const day of DAYS) {
                const id = `circuit${circuit}.weekplan.${day.id}`;
                await this.extendObjectAsync(id, {
                    type: 'state',
                    common: {
                        name: day.name,
                        desc: 'Komfortzeiten, z.B. "05:00-10:00, 16:00-22:00", max. 3 pro Tag, "-" = ganztägig Absenk',
                        type: 'string',
                        role: 'text',
                        read: true,
                        write: !!this.config.allowEepromWrite,
                    },
                    native: {},
                });
                known.add(id);
            }
        }

        // Datenpunkte entfernen, die es für die (neue) Applikation nicht mehr gibt
        const existing = await this.getAdapterObjectsAsync();
        for (const [fullId, obj] of Object.entries(existing)) {
            const id = fullId.slice(this.namespace.length + 1);
            if (obj.type === 'state' && !known.has(id)) {
                this.log.info(`Entferne Datenpunkt ${id}`);
                await this.delObjectAsync(id);
            }
        }
    }

    // ------------------------------------------------------------ Lesen

    async poll() {
        clearTimeout(this.timers.poll);
        try {
            if (!this.ecl.isOpen) await this.ecl.open();
            let ok = 0;
            for (const dp of this.datapoints.values()) {
                if (await this.readValue(dp.id, ramReadFrame(dp.adr), resp => decode(dp, resp), dp.optional)) ok++;
            }
            for (const circuit of [...this.modeCircuits]) {
                if (await this.readMode(circuit)) ok++;
            }
            await this.setStateAsync('info.connection', ok > 0, true);
            if (ok > 0) await this.setStateAsync('info.lastUpdate', Date.now(), true);
        } catch (err) {
            this.log.warn(`Abfrage fehlgeschlagen: ${err.message}`);
            await this.setStateAsync('info.connection', false, true);
        } finally {
            if (!this.unloading) {
                const minutes = Number(this.config.pollInterval) || 15;
                this.timers.poll = setTimeout(() => this.poll(), minutes * 60 * 1000);
            }
        }
    }

    /** Liest einen Wert und schreibt ihn in den State. Wiederholte Fehler nur einmal als Warnung loggen. */
    async readValue(id, frame, decodeFn, optional = false) {
        try {
            const value = decodeFn(await this.ecl.request(frame));
            await this.setStateAsync(id, value, true);
            if (this.failing.delete(id) && !optional) this.log.info(`${id}: wieder OK`);
            return true;
        } catch (err) {
            if (optional || this.failing.has(id)) this.log.debug(`${id}: ${err.message}`);
            else this.log.warn(`${id}: ${err.message}`);
            this.failing.add(id);
            return false;
        }
    }

    async readMode(circuit) {
        try {
            const resp = await this.ecl.request(buildFrame(CMD_READ_MODE, circuit));
            await this.setStateAsync(`circuit${circuit}.mode`, resp[3], true);
            return true;
        } catch (err) {
            if (err instanceof EclError && err.code === 0x20) {
                this.log.info(`Heizkreis ${circuit} ist in dieser Applikation nicht vorhanden`);
                this.modeCircuits = this.modeCircuits.filter(c => c !== circuit);
            } else {
                this.log.warn(`circuit${circuit}.mode: ${err.message}`);
            }
            return false;
        }
    }

    async readWeekplanDay(circuit, day) {
        const words = [];
        for (let w = 0; w < 3; w++) {
            const resp = await this.ecl.request(buildFrame(CMD_READ_EEPROM, weekplanAddress(circuit, day, w)));
            words.push([resp[2], resp[3]]);
        }
        const text = slotsToText(wordsToSlots(words));
        await this.setStateAsync(`circuit${circuit}.weekplan.${DAYS[day].id}`, text, true);
        return text;
    }

    async pollWeekplans() {
        clearTimeout(this.timers.weekplan);
        try {
            for (const circuit of [1, 2]) {
                for (let day = 0; day < 7; day++) {
                    try {
                        await this.readWeekplanDay(circuit, day);
                    } catch (err) {
                        this.log.warn(`circuit${circuit}.weekplan.${DAYS[day].id}: ${err.message}`);
                    }
                }
            }
        } finally {
            if (!this.unloading) {
                const hours = Number(this.config.weekplanInterval) || 24;
                this.timers.weekplan = setTimeout(() => this.pollWeekplans(), hours * 3600 * 1000);
            }
        }
    }

    // ------------------------------------------------------------ Schreiben

    /** Schreibt einen Parameter ins RAM (geht bei Stromausfall verloren) und liest ihn zur Kontrolle zurück. */
    async writeDatapoint(dp, value) {
        const raw = toRaw(dp, Number(value));
        if (!Number.isFinite(raw) || raw < dp.min || raw > dp.max) {
            throw new Error(`${value} liegt außerhalb ${toValue(dp, dp.min)} … ${toValue(dp, dp.max)}`);
        }
        const frame = dp.type === 's16' ? ramWrite16Frame(dp.adr, raw) : ramWrite8Frame(dp.adr, raw);
        await this.ecl.request(frame, false);

        const actual = decode(dp, await this.ecl.request(ramReadFrame(dp.adr)));
        await this.setStateAsync(dp.id, actual, true);
        if (actual !== toValue(dp, raw)) throw new Error(`${toValue(dp, raw)} geschrieben, aber ${actual} gelesen`);
    }

    async writeWeekplanDay(circuit, day, text) {
        const words = slotsToWords(textToSlots(text));
        for (let w = 0; w < 3; w++) {
            await this.ecl.request(buildFrame(CMD_WRITE_EEPROM16, weekplanAddress(circuit, day, w), ...words[w]), false);
        }
        // Das Display der ECL zeigt den neuen Plan erst nach erneutem Aufruf der Anzeige
        return this.readWeekplanDay(circuit, day);
    }

    async onStateChange(fullId, state) {
        if (!state || state.ack || !this.ecl) return;
        const id = fullId.slice(this.namespace.length + 1);

        const wp = id.match(WEEKPLAN_ID);
        if (wp) {
            const circuit = Number(wp[1]);
            const day = DAYS.findIndex(d => d.id === wp[2]);
            try {
                if (!this.config.allowEepromWrite) throw new Error('Wochenplan schreiben ist in der Instanz-Konfiguration deaktiviert');
                const text = await this.writeWeekplanDay(circuit, day, state.val);
                this.log.info(`${id} geschrieben: ${text}`);
            } catch (err) {
                this.log.error(`${id}: ${err.message}`);
                this.readWeekplanDay(circuit, day).catch(() => {});
            }
            return;
        }

        const dp = this.datapoints.get(id);
        if (!dp || !isWritable(dp)) return;
        try {
            await this.writeDatapoint(dp, state.val);
            this.log.info(`${id} auf ${state.val} gesetzt`);
        } catch (err) {
            this.log.error(`${id}: ${err.message}`);
            this.readValue(id, ramReadFrame(dp.adr), resp => decode(dp, resp)).catch(() => {});
        }
    }

    // ------------------------------------------------------------ Admin

    async onMessage(obj) {
        if (!obj || obj.command !== 'listPorts' || !obj.callback) return;
        const list = [];
        try {
            const { SerialPort } = require('serialport');
            for (const p of await SerialPort.list()) {
                const label = p.manufacturer ? `${p.path} (${p.manufacturer})` : p.path;
                // /dev/serial/by-id bleibt gleich, auch wenn sich ttyUSBx nach einem Neustart ändert
                if (p.pnpId && process.platform === 'linux') list.push({ value: `/dev/serial/by-id/${p.pnpId}`, label: `/dev/serial/by-id/${p.pnpId}` });
                list.push({ value: p.path, label });
            }
        } catch (err) {
            this.log.warn(`Serielle Ports konnten nicht gelistet werden: ${err.message}`);
        }
        this.sendTo(obj.from, obj.command, list, obj.callback);
    }

    async onUnload(callback) {
        this.unloading = true;
        try {
            Object.values(this.timers).forEach(t => clearTimeout(t));
            if (this.ecl) await this.ecl.close();
        } finally {
            callback();
        }
    }
}

if (require.main !== module) {
    module.exports = options => new DanfossEcl(options);
} else {
    new DanfossEcl();
}
