'use strict';

/*
 * Danfoss ECL Comfort 200/300 RS232-Protokoll (Danfoss, März 2000)
 *
 *   Anfrage:  CMD  ADR  D1  D2  CHK
 *   Antwort:  ERR  CMD  D1  D2  CHK      ERR 02 = OK
 *   CHK = XOR über die ersten 4 Bytes  ->  XOR über alle 5 Bytes ergibt 0
 *
 * 1200 Baud, 8 Datenbits, Parität odd, 1 Stopbit, min. 400 ms Pause zwischen Kommandos.
 */

const { EventEmitter } = require('node:events');

const FRAME_LEN = 5;

const CMD_READ_MODE = 0x11;
const CMD_READ_EEPROM = 0x80;
const CMD_WRITE_EEPROM16 = 0x90;

const ERRORS = {
    0x00: 'Unbekannter Wert',
    0x10: 'Ungültiger Wert für Datum oder Uhrzeit',
    0x20: 'Heizkreis existiert nicht',
    0x30: 'Modus existiert nicht',
    0x40: 'Port existiert nicht',
    0xf0: 'Kommunikationsfehler',
};

const xor = bytes => bytes.reduce((acc, b) => acc ^ b, 0);

function buildFrame(cmd, adr, val1 = 0, val2 = 0) {
    const body = [cmd, adr, val1, val2];
    return Buffer.from([...body, xor(body)]);
}

// RAM-Adressen sind 12 Bit (z.B. E3C): Lesen Cx, Schreiben 16 Bit Dx, Schreiben 8 Bit Fx
const ramReadFrame = adr => buildFrame(0xc0 | (adr >> 8), adr & 0xff);
const ramWrite16Frame = (adr, raw) => buildFrame(0xd0 | (adr >> 8), adr & 0xff, (raw >> 8) & 0xff, raw & 0xff);
const ramWrite8Frame = (adr, raw) => buildFrame(0xf0 | (adr >> 8), adr & 0xff, raw & 0xff, 0);

const checksumOk = frame => frame.length === FRAME_LEN && xor(frame) === 0;
const hex = buf => buf.toString('hex').match(/../g).join(' ');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

class EclError extends Error {
    constructor(code, frame) {
        super(`ECL meldet "${ERRORS[code]}" auf ${hex(frame)}`);
        this.code = code;
    }
}

/**
 * Serielle Verbindung zur ECL. Alle Requests laufen seriell durch eine Queue,
 * damit sich Abfragen und Schreibbefehle nie überschneiden und die Pause eingehalten wird.
 *
 * Events: 'close' (Port wurde geschlossen, z.B. USB-Adapter abgezogen)
 */
class EclConnection extends EventEmitter {
    /**
     * @param {object} options
     * @param {string} options.path
     * @param {number} [options.commandGap]       ms Pause zwischen Kommandos
     * @param {number} [options.responseTimeout]  ms bis eine Antwort als verloren gilt
     * @param {(msg: string) => void} [options.debug]
     */
    constructor({ path, commandGap = 500, responseTimeout = 1500, debug = () => {} }) {
        super();
        this.path = path;
        this.commandGap = commandGap;
        this.responseTimeout = responseTimeout;
        this.debug = debug;
        this.port = null;
        this.rxBuf = Buffer.alloc(0);
        this.pending = null;
        this.queue = Promise.resolve();
    }

    get isOpen() {
        return !!(this.port && this.port.isOpen);
    }

    async open() {
        if (this.isOpen) return;
        const { SerialPort } = require('serialport');
        const port = new SerialPort({
            path: this.path,
            baudRate: 1200,
            dataBits: 8,
            parity: 'odd',
            stopBits: 1,
            autoOpen: false,
        });
        // Eigener Empfangspuffer statt ByteLength-Parser: Vor jedem Request wird der Puffer
        // geleert. Ein verlorenes oder zusätzliches Byte verschiebt so nicht alle folgenden Antworten.
        port.on('data', chunk => this._onData(chunk));
        port.on('error', () => {}); // Fehler kommen über open()/write() bzw. 'close'
        port.on('close', () => this.emit('close'));
        await new Promise((resolve, reject) => port.open(err => (err ? reject(err) : resolve())));
        this.port = port;
    }

    async close() {
        const port = this.port;
        this.port = null;
        if (port && port.isOpen) await new Promise(resolve => port.close(() => resolve()));
    }

    _onData(chunk) {
        this.rxBuf = Buffer.concat([this.rxBuf, chunk]);
        if (this.pending && this.rxBuf.length >= FRAME_LEN) {
            const frame = Buffer.from(this.rxBuf.subarray(0, FRAME_LEN));
            this.rxBuf = this.rxBuf.subarray(FRAME_LEN);
            const p = this.pending;
            this.pending = null;
            clearTimeout(p.timer);
            p.resolve(frame);
        }
    }

    _transact(frame) {
        return new Promise((resolve, reject) => {
            if (!this.isOpen) return reject(new Error('Port ist nicht geöffnet'));
            this.rxBuf = Buffer.alloc(0);
            const p = {
                resolve,
                timer: setTimeout(() => {
                    if (this.pending === p) this.pending = null;
                    reject(new Error(`Timeout, keine Antwort auf ${hex(frame)}`));
                }, this.responseTimeout),
            };
            this.pending = p;
            this.port.write(frame, err => {
                if (!err) return;
                clearTimeout(p.timer);
                if (this.pending === p) this.pending = null;
                reject(err);
            });
        });
    }

    /**
     * Sendet einen Frame und liefert die geprüfte Antwort.
     *
     * @param {Buffer} frame
     * @param {boolean} [isRead] bei Leseanfragen muss die Antwort mit 02 + Kommando beginnen
     * @returns {Promise<Buffer>}
     */
    request(frame, isRead = true) {
        const job = this.queue
            .then(async () => {
                this.debug(`TX ${hex(frame)}`);
                const resp = await this._transact(frame);
                this.debug(`RX ${hex(resp)}`);
                if (!checksumOk(resp)) throw new Error(`Prüfsumme falsch: ${hex(resp)}`);
                if (ERRORS[resp[0]] !== undefined) throw new EclError(resp[0], frame);
                if (isRead && (resp[0] !== 0x02 || resp[1] !== frame[0])) {
                    throw new Error(`Unerwartete Antwort ${hex(resp)} auf ${hex(frame)}`);
                }
                return resp;
            })
            .finally(() => sleep(this.commandGap));
        this.queue = job.catch(() => {});
        return job;
    }
}

module.exports = {
    CMD_READ_MODE,
    CMD_READ_EEPROM,
    CMD_WRITE_EEPROM16,
    ERRORS,
    EclConnection,
    EclError,
    buildFrame,
    checksumOk,
    hex,
    ramReadFrame,
    ramWrite16Frame,
    ramWrite8Frame,
    xor,
};
