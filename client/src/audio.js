// Procedural soundtrack and sound effects (Web Audio, no asset files).
//
// Music:
//  - "Brain Bop" (lobby): an original bouncy 112 BPM game-show groove in C major (C - Am - F - G),
//    plucky bass, marimba melody, claps and shakers, glockenspiel sparkles.
//  - "Quiz Time" (in a game): 128 BPM in A minor (Am - F - C - E), a pulsing synth bass, a ticking
//    clock hi-hat, pizzicato arpeggios and toms, tense but fun.
// The two share one scheduler; switching waits for the next bar so it never cuts mid-phrase.
//
// Effects: answer dings and buzzers, wooden block pops that climb in pitch as the tower grows,
// clock ticks, the lava rumble, the elimination sizzle, the victory fanfare, gems, the nuke...

let ctx = null, master, comp, musicBus, musicOut, duckFilter, sfxBus, reverb, delay;
let noiseBuf = null, meter = null;
let musicOn = false, wantMusic = false, schedTimer = null, step16 = 0, nextTime = 0, ducked = false;
let track = 'lobby', nextTrack = 'lobby';
const settings = { music: 0.5, sfx: 0.85, master: 1, muted: false };
try { Object.assign(settings, JSON.parse(localStorage.getItem('mtr_audio') || '{}')); } catch (e) { /* defaults */ }

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const TRACKS = {
    lobby: {
        bpm: 112,
        // [bass root, chord notes] per bar, 4 bars
        chords: [[36, [60, 64, 67]], [33, [57, 60, 64]], [29, [57, 60, 65]], [31, [59, 62, 67]]],
        // marimba phrases (step in 16ths, midi, length in 16ths), one per bar of an 8-bar cycle
        melody: [
            [[0, 72, 2], [2, 76, 2], [4, 79, 2], [6, 76, 2], [8, 77, 2], [10, 76, 2], [12, 74, 4]],
            [[0, 72, 2], [3, 74, 1], [4, 76, 2], [8, 72, 4], [12, 69, 4]],
            [[0, 72, 2], [2, 77, 2], [4, 81, 2], [6, 79, 2], [8, 77, 2], [10, 76, 2], [12, 74, 2], [14, 72, 2]],
            [[0, 74, 3], [4, 79, 2], [6, 77, 2], [8, 76, 2], [10, 74, 2], [12, 71, 4]],
        ],
    },
    match: {
        bpm: 128,
        chords: [[33, [57, 60, 64]], [29, [57, 60, 65]], [36, [55, 60, 64]], [28, [56, 59, 64]]],
        melody: null,
    },
};

export function initAudio() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.2;
    master = ctx.createGain(); master.gain.value = 1.0;
    comp.connect(master).connect(ctx.destination);
    meter = ctx.createAnalyser(); meter.fftSize = 2048; master.connect(meter);
    musicBus = ctx.createGain();
    duckFilter = ctx.createBiquadFilter(); duckFilter.type = 'lowpass'; duckFilter.frequency.value = 20000; duckFilter.Q.value = 0.5;
    musicOut = ctx.createGain();
    musicBus.connect(duckFilter).connect(musicOut).connect(comp);
    sfxBus = ctx.createGain(); sfxBus.connect(comp);
    applyVolumes();

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const ir = (secs, decay) => {
        const len = ctx.sampleRate * secs, b = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) { const ch = b.getChannelData(c); for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
        return b;
    };
    reverb = ctx.createConvolver(); reverb.buffer = ir(1.8, 3);
    const revGain = ctx.createGain(); revGain.gain.value = 0.25;
    reverb.connect(revGain).connect(comp);
    delay = ctx.createDelay(1);
    delay.delayTime.value = 60 / 112 * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const dlf = ctx.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 3000;
    const dlGain = ctx.createGain(); dlGain.gain.value = 0.2;
    delay.connect(dlf).connect(fb).connect(delay);
    dlf.connect(dlGain).connect(musicBus);

    document.addEventListener('visibilitychange', () => {
        if (!ctx) return;
        if (document.hidden) ctx.suspend(); else ctx.resume();
    });
}

function applyVolumes() {
    if (!ctx) return;
    const t = ctx.currentTime;
    const m = settings.master ?? 1;
    musicOut.gain.setTargetAtTime(settings.muted ? 0 : settings.music * 1.5 * m * (ducked ? 0.55 : 1), t, 0.08);
    sfxBus.gain.setTargetAtTime(settings.sfx * m, t, 0.05);
}
function save() { try { localStorage.setItem('mtr_audio', JSON.stringify(settings)); } catch (e) { /* ignore */ } }
export function getVolumes() { return { ...settings }; }
export function setVolume(kind, v) {
    settings[kind] = Math.max(0, Math.min(1, v));
    save();
    applyVolumes();
}
// Browsers keep audio off until a click or key press: every gesture retries until it's running
export function resumeAudio() { initAudio(); if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {}); if (ctx && !musicOn && wantMusic) startMusic(); }
const level = () => { if (!meter) return 0; const a = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(a); let p = 0; for (const v of a) p = Math.max(p, Math.abs(v)); return +p.toFixed(3); };
export const audioDebug = () => ({ peak: level(), state: ctx && ctx.state, musicOn, track, settings: { ...settings } });
export const audioSuspended = () => !ctx || ctx.state !== 'running';
// Menus open: the music goes muffled and a little quieter
export function setMusicDuck(on) {
    if (!ctx || on === ducked) return;
    ducked = on;
    duckFilter.frequency.setTargetAtTime(on ? 900 : 20000, ctx.currentTime, 0.12);
    applyVolumes();
}

// ----- building blocks -----
function noise(t, dur, type, freq, q, gain, out, freqEnd, attack) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q || 1;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out || musicBus);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    return { f, g };
}
function tone(t, type, f0, f1, dur, gain, out, attack) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    if (attack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); } else g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out || sfxBus); o.start(t); o.stop(t + dur + 0.05);
    return o;
}

// ----- instruments -----
function kick(t, gain) { tone(t, 'sine', 150, 42, 0.32, gain, musicBus); noise(t, 0.02, 'lowpass', 1200, 1, gain * 0.25, musicBus); }
function clap(t, gain) {
    for (let i = 0; i < 3; i++) noise(t + i * 0.011, 0.03, 'bandpass', 1500, 1.4, gain * 0.7, musicBus);
    noise(t + 0.033, 0.16, 'bandpass', 1400, 1.2, gain, musicBus);
}
function hat(t, gain, open) { noise(t, open ? 0.14 : 0.03, 'highpass', 8000, 0.8, gain, musicBus); }
function shaker(t, gain) { noise(t, 0.05, 'bandpass', 6000, 1.2, gain, musicBus, 0, 0.015); }
function tom(t, n, gain) { tone(t, 'sine', midi(n) * 1.6, midi(n), 0.28, gain, musicBus); }
function pluckBass(t, n, dur, gain) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'triangle'; o2.type = 'square';
    o.frequency.value = midi(n); o2.frequency.value = midi(n);
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    f.type = 'lowpass'; f.frequency.setValueAtTime(1600, t); f.frequency.exponentialRampToValueAtTime(260, t + dur); f.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); o2.connect(g2).connect(f); f.connect(g).connect(musicBus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
}
// Marimba: a sine with a fast-decaying 4th partial and a mallet click
function marimba(t, n, dur, gain, out) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(0.9, 0.25 + dur));
    g.connect(out || musicBus); g.connect(reverb);
    for (const [k, a, d] of [[1, 1, 0.9], [4, 0.35, 0.08], [10, 0.08, 0.02]]) {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = 'sine'; o.frequency.value = midi(n) * k;
        og.gain.setValueAtTime(a, t); og.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(og).connect(g); o.start(t); o.stop(t + d + 0.05);
    }
}
function glock(t, n, gain) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    g.connect(musicBus); g.connect(delay); g.connect(reverb);
    for (const [k, a] of [[1, 1], [2.76, 0.3], [5.4, 0.12]]) {
        const o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n) * k; og.gain.value = a;
        o.connect(og).connect(g); o.start(t); o.stop(t + 1.15);
    }
}
function pad(t, notes, dur, gain) {
    for (const n of notes) {
        const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
        o.type = 'sawtooth'; o.frequency.value = midi(n); o.detune.value = (Math.random() - 0.5) * 12;
        f.type = 'lowpass'; f.frequency.value = 1100;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.15); g.gain.setValueAtTime(gain, t + dur - 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(f).connect(g).connect(musicBus); g.connect(reverb);
        o.start(t); o.stop(t + dur + 0.05);
    }
}
function pizz(t, n, gain) {
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = midi(n);
    f.type = 'lowpass'; f.frequency.setValueAtTime(2600, t); f.frequency.exponentialRampToValueAtTime(400, t + 0.18);
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(f).connect(g).connect(musicBus); g.connect(reverb);
    o.start(t); o.stop(t + 0.25);
}

// ----- the soundtrack: 16th-note steps, 16 per bar -----
function playStep(s, t, spb) {
    const T16 = spb / 4;
    const bar = Math.floor(s / 16), st = s % 16;
    const tr = TRACKS[track];
    const [root, notes] = tr.chords[bar % 4];
    if (track === 'lobby') {
        const swing = st % 2 ? T16 * 0.12 : 0;
        if (st === 0 || st === 8 || st === 10) kick(t, 0.5);
        if (st === 4 || st === 12) clap(t, 0.32);
        if (st % 2 === 0) hat(t, 0.05);
        else shaker(t + swing, 0.035);
        // bouncy bass: root, octave, fifth
        const bassPat = { 0: 0, 3: 12, 6: 7, 8: 0, 11: 12, 14: 7 };
        if (bassPat[st] !== undefined) pluckBass(t + swing, root + bassPat[st], T16 * 2.2, 0.32);
        // offbeat chord stabs
        if (st === 2 || st === 6 || st === 10 || st === 14) for (const n of notes) marimba(t + swing, n, T16, 0.06);
        // melody on bars 4-7 and 12-15 of the 16-bar cycle
        const cyc = bar % 16;
        if ((cyc >= 4 && cyc < 8) || (cyc >= 12)) {
            for (const [ms, n, len] of tr.melody[bar % 4]) if (ms === st) marimba(t + swing, n, len * T16, 0.17);
        }
        if (cyc % 4 === 3 && st === 14) glock(t, 84 + (bar % 2) * 7, 0.07);
    } else {
        if (st % 4 === 0) kick(t, 0.5);
        if (st === 4 || st === 12) clap(t, 0.24);
        hat(t, st % 4 === 2 ? 0.07 : 0.035, st % 8 === 6);     // the ticking clock
        if (st % 2 === 0) pluckBass(t, root + (st % 8 === 6 ? 12 : 0), T16 * 1.6, 0.3);
        // pizzicato arpeggio up and down the chord
        const arp = [notes[0], notes[1], notes[2], notes[1] + 12, notes[2], notes[1]];
        if (st % 2 === 1) pizz(t, arp[(st >> 1) % arp.length] + 12, 0.07);
        if (st === 0) pad(t, notes, spb * 4 - 0.05, 0.025);
        if (bar % 4 === 3 && st >= 12 && st % 1 === 0) tom(t, 45 - (st - 12) * 2, 0.22);
    }
}
function scheduler() {
    while (nextTime < ctx.currentTime + 0.15) {
        if (step16 % 16 === 0 && nextTrack !== track) { track = nextTrack; step16 = 0; }
        const spb = 60 / TRACKS[track].bpm;
        playStep(step16, nextTime, spb);
        nextTime += spb / 4;
        step16++;
    }
}
export function startMusic() {
    wantMusic = true;
    if (!ctx || musicOn || ctx.state !== 'running') return;
    musicOn = true;
    nextTime = ctx.currentTime + 0.1;
    step16 = 0;
    schedTimer = setInterval(scheduler, 40);
}
export function setTrack(name) { if (TRACKS[name]) nextTrack = name; }

// ----- sound effects -----
const R = (a, b) => a + Math.random() * (b - a);
const SFX = {
    click(t) { tone(t, 'sine', 760, 1300, 0.05, 0.12); noise(t, 0.01, 'bandpass', 2400, 1, 0.07, sfxBus); },
    clickBuy(t) { tone(t, 'triangle', 880, 1760, 0.08, 0.12); },
    // answers
    correct(t) { [72, 76, 79, 84].forEach((n, i) => { tone(t + i * 0.07, 'triangle', midi(n), null, 0.28, 0.16); tone(t + i * 0.07, 'sine', midi(n + 12), null, 0.2, 0.05); }); },
    wrong(t) { tone(t, 'square', 196, 180, 0.18, 0.09); tone(t + 0.2, 'square', 147, 130, 0.35, 0.09); noise(t, 0.5, 'lowpass', 500, 1, 0.05, sfxBus); },
    select(t) { tone(t, 'sine', 900, 1100, 0.06, 0.1); },
    unlock(t) { tone(t, 'triangle', midi(76), null, 0.12, 0.12); tone(t + 0.1, 'triangle', midi(83), null, 0.3, 0.12); },
    // countdown
    tick(t) { noise(t, 0.02, 'highpass', 4000, 1, 0.12, sfxBus); tone(t, 'sine', 2100, null, 0.03, 0.06); },
    tickUrgent(t) { noise(t, 0.025, 'highpass', 3000, 1, 0.16, sfxBus); tone(t, 'square', 1400, null, 0.06, 0.05); },
    beep(t) { tone(t, 'square', 880, null, 0.12, 0.06); },
    go(t) { tone(t, 'square', 1320, null, 0.25, 0.07); noise(t, 0.4, 'bandpass', 400, 2, 0.15, sfxBus, 4000, 0.05); },
    question(t) { tone(t, 'triangle', midi(79), midi(91), 0.2, 0.1); noise(t, 0.25, 'bandpass', 600, 2, 0.08, sfxBus, 5000, 0.04); },
    // world
    jump(t) { tone(t, 'sine', 300, 620, 0.12, 0.08); },
    land(t) { noise(t, 0.08, 'lowpass', 500, 1, 0.12, sfxBus); },
    step(t) { noise(t, 0.04, 'bandpass', R(900, 1400), 1.5, 0.05, sfxBus); },
    gem(t) { tone(t, 'triangle', midi(88), null, 0.12, 0.1); tone(t + 0.07, 'triangle', midi(95), null, 0.3, 0.1); noise(t, 0.2, 'highpass', 7000, 1, 0.04, sfxBus); },
    vote(t) { tone(t, 'sine', 620, 940, 0.09, 0.12); },
    teleport(t) { for (let i = 0; i < 9; i++) tone(t + i * 0.028, 'sine', midi(74 + i * 3), null, 0.16, 0.05); noise(t, 0.35, 'bandpass', 600, 1.5, 0.08, sfxBus, 5000, 0.05); },
    whoosh(t) { noise(t, 0.45, 'bandpass', 300, 2, 0.28, sfxBus, 3000, 0.18); },
    react(t) { tone(t, 'sine', 500, 1200, 0.1, 0.1); },
    // the match
    lava(t) {
        noise(t, 2.6, 'lowpass', 160, 1, 0.5, sfxBus, 90, 0.4);
        for (let i = 0; i < 9; i++) { const b = t + R(0.1, 2.3); tone(b, 'sine', R(90, 180), R(260, 420), 0.1, 0.12); }
    },
    eliminated(t) { noise(t, 0.9, 'highpass', 2000, 0.7, 0.25, sfxBus, 6000); tone(t, 'sine', 160, 50, 0.45, 0.35); noise(t, 0.3, 'lowpass', 600, 1, 0.3, sfxBus); },
    elimOther(t) { noise(t, 0.6, 'highpass', 2500, 0.7, 0.1, sfxBus, 6000); tone(t, 'sine', 140, 60, 0.3, 0.12); },
    victory(t) {
        const seq = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [72, 76, 79, 84]];
        seq.forEach((ch, i) => ch.forEach((n) => { tone(t + i * 0.22, 'sawtooth', midi(n), null, i === 3 ? 1.1 : 0.24, 0.05, sfxBus, 0.02); tone(t + i * 0.22, 'triangle', midi(n), null, i === 3 ? 1.1 : 0.24, 0.07, sfxBus, 0.01); }));
        noise(t + 0.66, 1.2, 'highpass', 5000, 0.6, 0.12, sfxBus);
    },
    firework(t) { tone(t, 'sine', 900, 200, 0.35, 0.05); noise(t + 0.35, 0.4, 'lowpass', 2500, 0.8, 0.25, sfxBus); },
    placed(t) { [67, 72, 76].forEach((n, i) => tone(t + i * 0.1, 'triangle', midi(n), null, 0.3, 0.1)); },
    blocks(t) { for (let i = 0; i < 5; i++) tone(t + i * 0.05, 'triangle', midi(64 + i * 4), null, 0.1, 0.08); },
    nuke(t) {
        noise(t, 2.8, 'lowpass', 1400, 0.8, 0.9, sfxBus, 60, 0.01);
        tone(t, 'sine', 90, 28, 1.6, 0.6);
        noise(t + 0.05, 1.4, 'highpass', 1800, 0.6, 0.25, sfxBus);
    },
    nukeLaunch(t) { tone(t, 'sawtooth', 220, 1400, 1.6, 0.05); noise(t, 1.6, 'bandpass', 800, 1.5, 0.15, sfxBus, 3000, 0.2); },
    // shop / pets
    buy(t) { [76, 79, 84, 88].forEach((n, i) => tone(t + i * 0.05, 'triangle', midi(n), null, 0.18, 0.1)); },
    denied(t) { tone(t, 'square', 220, 160, 0.18, 0.07); },
    hatchShake(t) { noise(t, 0.05, 'bandpass', 700, 2, 0.2, sfxBus); tone(t, 'sine', 300, 200, 0.06, 0.1); },
    common(t) { tone(t, 'triangle', midi(72), null, 0.25, 0.12); tone(t + 0.1, 'triangle', midi(79), null, 0.35, 0.12); },
    rare(t) { [72, 76, 79].forEach((n, i) => tone(t + i * 0.08, 'triangle', midi(n), null, 0.35, 0.12)); },
    epic(t) { [72, 76, 79, 84].forEach((n, i) => tone(t + i * 0.08, 'triangle', midi(n), null, 0.4, 0.13)); noise(t, 0.6, 'highpass', 6000, 1, 0.05, sfxBus); },
    legendary(t) { SFX.victory(t); },
    mythic(t) { SFX.victory(t); [96, 100, 103].forEach((n, i) => tone(t + 0.9 + i * 0.1, 'sine', midi(n), null, 0.5, 0.08)); },
};
export function sfx(name, opt) {
    if (!ctx || settings.sfx <= 0) return;
    if (name === 'block') return blockPop(opt || 0);
    const f = SFX[name];
    if (f) f(ctx.currentTime + 0.005);
}
// A wooden block pop that climbs in pitch as the tower grows
let lastPop = 0;
function blockPop(i) {
    const t = ctx.currentTime + 0.005;
    if (t - lastPop < 0.035) return;
    lastPop = t;
    const p = Math.min(2.2, 1 + i * 0.045);
    tone(t, 'sine', 520 * p, 190 * p, 0.09, 0.22);
    tone(t, 'triangle', 1040 * p, 600 * p, 0.04, 0.06);
    noise(t, 0.025, 'bandpass', 2400 * p, 2, 0.12, sfxBus);
}
