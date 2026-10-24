/*
Beispiel: Warmwasser-Automation für den Adapter danfoss-ecl (Skript für den JavaScript-Adapter).
Datenpunkte wie hm-rega.0.950 und mytime.0... an die eigene Installation anpassen.
Ersetzt die Trigger aus dem früheren Skript "DanFoss_NEU". Die Kommunikation mit der ECL
macht jetzt der Adapter: Ein setState ohne ack auf einen Sollwert wird an die ECL geschrieben.

Die Werte sind in ioBroker-Einheiten, d.h. mit dem in der Instanz eingestellten
Warmwasser-Offset (15: 45 °C hier = 60 im Display der ECL).
*/

const ECL            = 'danfoss-ecl.0.';
const BOOST_DURATION = 15 * 60 * 1000;
const HOT            = 45;
const REDUCED        = 15;

// #1 Warmwasser: Absenkbetrieb override bei Anforderung -> 45°C, nach 15 Minuten zurück auf 15°C
let boostTimer = null;

createState('0_userdata.0.Warmwasser', { type: 'boolean', role: 'switch', def: false });

on({ id: '0_userdata.0.Warmwasser', val: true, change: 'ne' }, () => {
    log(`Warmwasser Anforderung im Absenkbetrieb - Setpoint auf ${HOT}°C`);
    setState(ECL + 'hotwater.setpointNight', HOT);
    setState('mytime.0.Countdown.TimerWarmwasser.cmd', 'start');

    if (boostTimer) clearTimeout(boostTimer);
    boostTimer = setTimeout(() => {
        boostTimer = null;
        log(`Warmwasser Anforderung im Absenkbetrieb - Setpoint auf ${REDUCED}°C (Reset)`);
        setState(ECL + 'hotwater.setpointNight', REDUCED);
        setState('0_userdata.0.Warmwasser', false);
    }, BOOST_DURATION);
});

// #2/#3 Warmwasser Normalbetrieb: Anwesenheit -> 45°C, Abwesenheit -> 15°C
on({ id: 'hm-rega.0.950', change: 'ne' }, obj => {
    const present = !!obj.state.val;
    const celsius = present ? HOT : REDUCED;
    log(`Warmwasser Normalbetrieb bei ${present ? 'Anwesenheit' : 'Abwesenheit'} - Setpoint auf ${celsius}°C`);
    setState(ECL + 'hotwater.setpointDay', celsius);
});

onStop(() => {
    if (boostTimer) clearTimeout(boostTimer);
});
