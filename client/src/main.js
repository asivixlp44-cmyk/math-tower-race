import { Client } from '@colyseus/sdk';
import {
    T, V3, $, canvas, scene, camera, sun, renderer, solids, prompts, camFill, billboard, buildRig, animRig, airPose, dancePoseRig,
    floatText, updateEffects, lerpAngle, updateSky, toLambert } from './engine.js';
import { S, actions, net } from './state.js';
import { initAudio, resumeAudio, audioDebug, startMusic, setTrack, sfx, setVolume, audioSuspended } from './audio.js';
import * as BX from './bloxity.js';
import { createAvatar, loadBase, packAvatar, unpackAvatar } from './avatar.js';
import { pad, pollGamepad, rumble, onGamepadConnection } from './gamepad.js';
import {
    render, updateFx, dust, sparkleColumn, ring, fireworks, confetti, setQuality, getQuality, autoQualityAllowed, gemBurst, flame, smoke, nukeFx,
} from './fx.js';
import {
    buildWorld, SPAWN_POS, SPAWN_YAW, updateWorld, setScreen, setVotes, renderBoards, setVipDoor, refreshShopLabels, gems, setGemDown, torches,
} from './world.js';
import { syncTowers, updateTowers, burnTower, towerOf, towerDebug, towerPrewarmGroup } from './towers.js';
import { updateLava, lavaRising, lavaSurfaceY } from './lava.js';
import { PetTrain, petModel } from './pets.js';
import { onQuestion, onAnswerResult, onResults, onNoRetries, updateQuiz, answerKey, quizVisible } from './quiz.js';
import {
    updateHud, setStatus, announce, toast, flash, teleportFx, showPlacements, banner, animateCounters, gemGain, refreshModal, openModal,
    notEnough, codeResult, showHatch, buy, closeTop, anyPopup, promptEl, promptTxtEl,
} from './ui.js';
import { CFG, KITS, SKINS, EMOJIS, PETS, petById, diffById, lavaRise, fmt, clock, ordinal, clamp } from '../../shared/config.js';

// =====================================================================================
// Local player
// =====================================================================================
const HW = 1, PH = 5, STEP = 1.25, PIVOT = 2.6;
const P = {
    pos: SPAWN_POS.clone(), vel: new V3(), kv: new V3(), onGround: false, ground: null, facing: SPAWN_YAW, moving: false,
    animPhase: 0, airTime: 0, peakY: 0, jumpPress: -9, coyote: 0, lastStepN: 0, squash: 1, squashV: 0, riding: false,
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let shake = 0;
function addShake(a) { if (!reduceMotion) shake = Math.min(1.2, shake + a); }
let rig = null, headLabel = null, labelKey = '', myPets = null;

// ----- a character: rig (feet, yaw) -> pivot (hips) -> body (blocky or Bloxity) -----
function buildCharacter(kit, skin) {
    const g = new T.Group();
    const pivot = new T.Group(); pivot.position.y = PIVOT; g.add(pivot);
    const body = buildRig({ ...KITS[kit % KITS.length], skin: SKINS[skin % SKINS.length], hair: 0x8a3a1a });
    body.position.y = -PIVOT;
    pivot.add(body);
    g.userData = { pivot, body, blox: null };
    return g;
}
function dressRig(group, avatar) {
    const u = group.userData;
    u.body.children.forEach((c) => { c.visible = false; });
    u.body.add(avatar.root);
    u.blox = avatar;
}
// "Wins: N" in gold over the name, like the reference
const nameLines = (name, wins, vip) => [
    { t: 'Wins: ' + fmt(wins || 0), c: '#ffd84a', s: '#3a2a00', px: 44 },
    { t: (vip ? '👑 ' : '') + (name || ' '), c: '#ffffff', s: '#14182c', px: 58 },
];
let localAvatar = null, localAvatarReq = 0;
async function setupLocalAvatar() {
    const req = ++localAvatarReq;
    const a = await createAvatar(BX.currentAvatar(), BX.getSkinTextureUrl());
    if (!a) return;
    if (req !== localAvatarReq || !rig) { a.dispose(); return; }
    if (localAvatar) localAvatar.dispose();
    localAvatar = a;
    dressRig(rig, a);
}
function syncMyAvatar() {
    const av = BX.currentAvatar();
    if (localAvatar && av) { localAvatar.setProportions(av.proportions); localAvatar.setEquipped(av, BX.getSkinTextureUrl()); }
    net.send('avatar', { av: packAvatar(av) });
}
async function playEmoteOn(avatar, id) {
    if (!avatar) return;
    const cat = await BX.loadEmotes();
    const e = cat.get(id);
    if (e && e.clip) avatar.playEmote(e.clip);
}
function chatBubble(group, text) {
    if (!group) return;
    if (group.userData.bubble) { group.remove(group.userData.bubble); group.userData.bubble.material.map.dispose(); }
    const b = billboard([{ t: '💬 ' + text, c: '#ffffff', s: '#14182c', px: 44 }], 9, 1024, new V3(0, 11, 0), group);
    group.userData.bubble = b;
    setTimeout(() => { if (group.userData.bubble === b) { group.remove(b); b.material.map.dispose(); group.userData.bubble = null; } }, 5000);
}
// Reaction emoji popping up over a player's head
const reactions = [];
function reactOn(group, i) {
    if (!group || !EMOJIS[i]) return;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); x.font = '100px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(EMOJIS[i], 64, 72);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), transparent: true, depthWrite: false, depthTest: false }));
    sp.renderOrder = 11;
    sp.position.set(0, 9.5, 0); sp.scale.setScalar(0.1);
    group.add(sp);
    reactions.push({ sp, group, t: 0 });
}
function updateReactions(dt) {
    for (let i = reactions.length - 1; i >= 0; i--) {
        const r = reactions[i];
        r.t += dt;
        const k = r.t / 2.2;
        r.sp.scale.setScalar(r.t < 0.25 ? 4 * (r.t / 0.25) * (1.2 - 0.2 * (r.t / 0.25)) : 4);
        r.sp.position.y = 9.5 + k * 3;
        r.sp.material.opacity = k > 0.7 ? Math.max(0, 1 - (k - 0.7) / 0.3) : 1;
        if (k >= 1) { r.group.remove(r.sp); r.sp.material.map.dispose(); r.sp.material.dispose(); reactions.splice(i, 1); }
    }
}

function buildPlayer(kit, skin) {
    if (rig) scene.remove(rig);
    rig = buildCharacter(kit, skin);
    rig.userData.kit = kit;
    scene.add(rig);
    labelKey = '';
    headLabel = billboard(nameLines(S.name, S.wins, S.passes.VIP), 6.5, 512, new V3(0, 8.2, 0), rig);
    headLabel.material.depthTest = false; headLabel.renderOrder = 10;
    rig.position.copy(P.pos);
    localAvatar = null;
    setupLocalAvatar();
    if (!myPets) myPets = new PetTrain(scene);
}

// =====================================================================================
// Collision: axis-aligned boxes
// =====================================================================================
const overlaps = (c, x, y, z) => !c.off && c.max.x > x - HW && c.min.x < x + HW && c.max.y > y && c.min.y < y + PH && c.max.z > z - HW && c.min.z < z + HW;
function freeAt(x, y, z) {
    for (const c of solids) if (overlaps(c, x, y, z)) return false;
    return true;
}
function moveAxis(axis, d) {
    if (d === 0) return;
    const p = P.pos;
    p[axis] += d;
    for (const c of solids) {
        if (!overlaps(c, p.x, p.y, p.z)) continue;
        if (axis === 'y') {
            if (d < 0) { p.y = c.max.y; P.vel.y = Math.max(0, P.vel.y); P.onGround = true; P.ground = c; }
            else { p.y = c.min.y - PH - 1e-4; if (P.vel.y > 0) P.vel.y = 0; }
        } else {
            const rise = c.max.y - p.y;
            if (rise > 0 && rise <= STEP && (P.onGround || P.vel.y <= 0) && freeAt(p.x, c.max.y + 0.01, p.z)) { p.y = c.max.y + 0.001; continue; }
            if (d > 0) p[axis] = c.min[axis] - HW - 1e-4; else p[axis] = c.max[axis] + HW + 1e-4;
        }
    }
}
function groundProbe(maxDrop) {
    const p = P.pos;
    let best = -Infinity, bs = null;
    for (const c of solids) {
        if (c.off) continue;
        if (c.max.x <= p.x - HW || c.min.x >= p.x + HW || c.max.z <= p.z - HW || c.min.z >= p.z + HW) continue;
        if (c.max.y <= p.y + 0.01 && c.max.y >= p.y - maxDrop && c.max.y > best) { best = c.max.y; bs = c; }
    }
    if (bs) { p.y = best; P.onGround = true; P.ground = bs; P.vel.y = Math.max(0, P.vel.y); }
    return !!bs;
}

// A free-ish spot on the spawn pad (players joining together don't start inside each other)
function spawnSpot() {
    const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6;
    return new V3(SPAWN_POS.x + Math.cos(a) * r, SPAWN_POS.y, SPAWN_POS.z + Math.sin(a) * r);
}
function teleport(pos, yaw, fx) {
    P.pos.copy(pos); P.vel.set(0, 0, 0); P.kv.set(0, 0, 0);
    P.facing = yaw ?? P.facing; cam.yaw = P.facing + Math.PI;
    cam.target.set(pos.x, pos.y + 5, pos.z);   // snap the camera too, instead of flying across the map
    P.peakY = pos.y; P.airTime = 0;
    sendMove(true);
    if (fx) { teleportFx(); sfx('teleport'); }
}

// =====================================================================================
// Other players
// =====================================================================================
const remotes = new Map();
let joinSynced = false;
class Remote {
    constructor(p) {
        this.rig = buildCharacter(p.kit, p.skin);
        this.rig.position.set(p.x, p.y, p.z);
        this.rig.rotation.y = p.ry;
        scene.add(this.rig);
        this.label = billboard(nameLines(p.name, p.wins, p.vip), 6, 512, new V3(0, 8.2, 0), this.rig);
        this.labelKey = '';
        this.av = null; this.blox = null; this.dead = false; this.phase = 0; this.vel = 0;
        this.lastX = p.x; this.lastZ = p.z; this.burnT = 0;
        this.pets = new PetTrain(scene); this.petKey = '';
        this.setAvatar(p.av);
    }
    setAvatar(av) {
        this.av = av;
        const data = av ? unpackAvatar(av) : null;
        if (this.blox) { this.blox.setProportions(data && data.proportions); this.blox.setEquipped(data || {}); return; }
        if (this.loading) return;
        this.loading = true;
        createAvatar(data).then((a) => {
            this.loading = false;
            if (!a) return;
            if (this.dead) { a.dispose(); return; }
            this.blox = a;
            dressRig(this.rig, a);
            if (this.av !== av) this.setAvatar(this.av);
        });
    }
    update(p, dt, t) {
        const r = this.rig, u = r.userData;
        const k = 1 - Math.exp(-dt * 12);
        if ((r.position.x - p.x) ** 2 + (r.position.z - p.z) ** 2 + (r.position.y - p.y) ** 2 > 900) r.position.set(p.x, p.y, p.z);
        else { r.position.x += (p.x - r.position.x) * k; r.position.y += (p.y - r.position.y) * k; r.position.z += (p.z - r.position.z) * k; }
        // standing on a tower: their feet follow the tower top as it grows here
        const tw = p.inMatch && p.alive ? towerOf(this.id) : null;
        if (tw) r.position.y = Math.max(r.position.y, tw.top());
        const dance = (p.celebrate || p.dancing) ? (p.dance || 'classic') : '';
        if (!dance || p.dance !== 'tornado') r.rotation.y = lerpAngle(r.rotation.y, p.ry, k);
        else r.rotation.y += dt * 9;
        if (p.av !== this.av) this.setAvatar(p.av);
        const moved = Math.hypot(r.position.x - this.lastX, r.position.z - this.lastZ);
        this.vel += ((dt > 0 ? moved / dt : 0) - this.vel) * Math.min(1, dt * 6);
        this.lastX = r.position.x; this.lastZ = r.position.z;
        const air = p.anim === 2, moving = p.anim === 1 && this.vel > 1;
        this.phase += dt * (moving ? Math.min(18, 4 + this.vel * 0.3) : 0);
        let bounce = 0;
        if (dance && !moving) bounce = dancePoseRig(u.body, dance, t);
        else if (air) airPose(u.body); else if (moving) animRig(u.body, this.phase, 0.85); else animRig(u.body, 0, 0);
        u.pivot.position.y = PIVOT + bounce * 0.5;
        if (this.blox) this.blox.update(dt, { moving, air, speed: this.vel, t, dance: dance && !moving ? dance : '' });
        const key = p.name + '|' + p.wins + '|' + p.vip;
        if (key !== this.labelKey) { this.labelKey = key; this.label.userData.set(nameLines(p.name, p.wins, p.vip)); }
        if (p.pets !== this.petKey) { this.petKey = p.pets; this.pets.set(String(p.pets || '').split(',').map((id) => petById[id]).filter(Boolean)); }
        this.pets.update(r.position, r.rotation.y, dt, t, showOther && r.visible);
        if (this.burnT > 0) { this.burnT -= dt; if (Math.random() < dt * 30) flame(r.position.clone().add(new V3(0, 2.5, 0)), 2, 1.8); }
    }
    dispose() {
        this.dead = true;
        if (this.blox) this.blox.dispose();
        this.pets.dispose();
        scene.remove(this.rig);
    }
}
let showOther = true;
try { showOther = localStorage.getItem('mtr_pets') !== '0'; } catch (e) { /* default */ }
actions.showOtherPets = () => showOther;
actions.toggleOtherPets = () => { showOther = !showOther; try { localStorage.setItem('mtr_pets', showOther ? '1' : '0'); } catch (e) { /* ignore */ } };

function syncRemotes(dt, t) {
    const room = net.room;
    if (!room || !room.state || !room.state.players) return;
    const seen = new Set();
    room.state.players.forEach((p, id) => {
        if (id === room.sessionId) {
            S.name = p.name;
            if (!rig || rig.userData.kit !== p.kit) buildPlayer(p.kit, p.skin);
            return;
        }
        seen.add(id);
        let r = remotes.get(id);
        if (!r) {
            r = new Remote(p); r.id = id; remotes.set(id, r);
            if (joinSynced) BX.playerJoined(p.name); else BX.playerInRoom(p.name);
        }
        r.update(p, dt, t);
    });
    for (const [id, r] of remotes) if (!seen.has(id)) { r.dispose(); remotes.delete(id); }
    joinSynced = true;
}
const rigOf = (id) => (net.room && id === net.room.sessionId ? rig : remotes.get(id) ? remotes.get(id).rig : null);

// =====================================================================================
// Networking
// =====================================================================================
const BLOXITY_GAME_ID = import.meta.env.VITE_BLOXITY_GAME_ID || '';
const ON_BLOXITY_HOST = /\.play\.bloxity\.io$/.test(location.hostname);
const DEV_CHANNEL = /\.dev\.play\.bloxity\.io$/.test(location.hostname);
const SERVER_URL = import.meta.env.VITE_SERVER_URL
    || (ON_BLOXITY_HOST ? `https://${location.hostname.replace(/\.play\.bloxity\.io$/, '.host.bloxity.io')}`
        : BLOXITY_GAME_ID ? `https://${BLOXITY_GAME_ID}.host.bloxity.io`
        : import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2607` : location.origin);
async function serverEndpoint() {
    let url = SERVER_URL;
    if (BLOXITY_GAME_ID) {
        const r = await BX.resolveEndpoint(BLOXITY_GAME_ID, DEV_CHANNEL ? 'preview' : undefined);
        if (r && r.cold) $('#loading').textContent = 'Waking up a server…';
        url = (r && r.endpoint) || SERVER_URL;
    }
    if (!/^https?:/i.test(url)) return url;
    if (!(await serverUp(url))) {
        $('#loading').textContent = 'Waking up a server…';
        const until = Date.now() + 60000;
        while (Date.now() < until) {
            await new Promise((res) => setTimeout(res, 2000));
            if (await serverUp(url)) break;
        }
    }
    return url;
}
async function serverUp(url) {
    try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(url.replace(/\/$/, '') + '/health', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        return r.ok;
    } catch (e) { return false; }
}
let lastMoveSent = 0, lastMoveKey = '';
function sendMove(force) {
    const now = performance.now();
    if (!force && now - lastMoveSent < 66) return;
    const a = !P.onGround && !P.riding ? 2 : P.moving ? 1 : 0;
    const m = { x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), ry: +P.facing.toFixed(3), a };
    const key = m.x + ',' + m.y + ',' + m.z + ',' + m.ry + ',' + a;
    if (!force && key === lastMoveKey && now - lastMoveSent < 500) return;
    lastMoveKey = key; lastMoveSent = now;
    net.send('move', m);
}

function storageGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storageSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
function playerUid() {
    let uid = storageGet('mtr_uid');
    if (!uid) {
        uid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
        storageSet('mtr_uid', uid);
    }
    return uid;
}

let lastQuestion = null, lastElimText = '', lastWinText = '';
async function connect(name) {
    const client = new Client(await serverEndpoint());
    const id = BX.identity();
    const room = await client.joinOrCreate('race', {
        uid: playerUid(), name: name || id.name, token: id.token, av: packAvatar(BX.currentAvatar()),
        save: storageGet('mtr_save') || '',
    });
    net.room = room;
    joinSynced = false;
    room.onMessage('hello', (m) => { net.offset = m.now - Date.now(); net.bloxity = !!m.bloxity; });
    room.onMessage('authed', () => { net.bloxity = true; });
    room.onMessage('emote', (m) => { const r = remotes.get(m.s); if (r) playEmoteOn(r.blox, m.id); });
    room.onMessage('chat', (m) => {
        toast((m.vip ? '👑 ' : '') + m.name + ': ' + m.text, m.vip ? '#ffd028' : '#ffffff');
        chatBubble(rigOf(m.s), m.text);
    });
    BX.updateRoom(room.roomId);
    BX.gameplayStart();
    room.onMessage('profile', (m) => {
        if (m.save) storageSet('mtr_save', m.save);
        delete m.save;
        Object.assign(S, m);
        S.profileAt = Date.now();
        setVipDoor(S.passes && S.passes.VIP);
        refreshShopLabels();
        refreshModal();
    });
    room.onMessage('toast', (m) => toast(m.text, m.color));
    room.onMessage('announce', (m) => {
        announce(m.text, m.dur, m.style);
        if (m.style === 'danger') lastElimText = m.text;
        if (m.style === 'victory') lastWinText = m.text;
        if (m.text.startsWith('The lava will rise')) sfx('whoosh');
    });
    room.onMessage('earn', (m) => {
        gemGain(m.n);
        floatText('+' + fmt(m.n) + ' 💎', '#e8b4ff', P.pos.clone().add(new V3(0, 7.5, 0)), 4.4);
        if (m.why === 'pickup') sfx('gem');
    });
    room.onMessage('broke', (m) => { notEnough(m); sfx('denied'); });
    room.onMessage('needPass', (m) => buy('pass', m.key));
    room.onMessage('codeResult', codeResult);
    room.onMessage('boards', renderBoards);
    room.onMessage('hatched', (m) => showHatch(m));
    room.onMessage('fx', (m) => {
        sparkleColumn(P.pos, m.kind === 'unlock' ? 0xc46cff : 0xffd028);
        ring(P.pos, 0xffd028, 10, 0.8);
        if (m.kind === 'confetti' || m.kind === 'unlock') confetti(P.pos, 40);
        sfx(m.kind === 'unlock' ? 'unlock' : 'buy');
        if (m.key === 'PlusBlocks') sfx('blocks');
    });
    // the server moves you (voting, your tower, back to the lobby)
    room.onMessage('place', (m) => {
        teleport(new V3(m.x, m.y + 0.02, m.z), m.yaw, m.fx === 'vote' || m.fx === 'lobby' || m.fx === 'eliminated');
        if (m.fx === 'tower') { ring(P.pos, 0x7dff6b, 8, 0.7); cam.dist = Math.max(cam.dist, 24); }
        if (m.fx === 'vote') toast('Stand on a pad to vote for the difficulty!', '#ffe254');
    });
    room.onMessage('gems', (m) => { for (const [i, until] of m.down || []) setGemDown(i, until); });
    room.onMessage('gemTaken', (m) => {
        setGemDown(m.i, m.until);
        const g = gems[m.i];
        if (g && m.s === room.sessionId) gemBurst(new V3(g.x, g.y, g.z));
    });
    room.onMessage('react', (m) => reactOn(rigOf(m.s), m.i));
    // ----- the match -----
    room.onMessage('question', (m) => {
        lastQuestion = m;
        const me = net.me();
        onQuestion(m, !!(me && me.inMatch && me.alive), spec.on);
    });
    room.onMessage('answerResult', (m) => onAnswerResult(m));
    room.onMessage('noRetries', () => onNoRetries());
    room.onMessage('results', (m) => {
        lastQuestion = { ...lastQuestion, reveal: m.reveal };
        const st = room.state;
        onResults(m, (sid) => { const p = st.players.get(sid); return p ? p.kit : 0; }, room.sessionId, spec.on);
    });
    room.onMessage('elim', (m) => {
        for (const id of m.ids) {
            burnTower(id);
            const r = remotes.get(id);
            if (r) r.burnT = 1.4;
            if (id === room.sessionId) {
                myBurn = 1.4;
                banner('ELIMINATED!', 'The lava got you... watch the rest or wait for the next game!', true);
                sfx('eliminated'); addShake(0.7); rumble(0.8, 400);
            }
        }
        if (!m.ids.includes(room.sessionId)) sfx('elimOther');
    });
    room.onMessage('placed', (m) => {
        if (m.counted && m.place === 1) {
            banner('YOU WIN!', '+' + fmt(m.gems) + ' Gems · survived ' + m.rounds + ' rounds', false);
            sfx('victory'); rumble(0.8, 600);
            fireworks(P.pos, 12, () => sfx('firework'));
            confetti(P.pos, 90);
        } else if (m.counted) {
            toast('You finished ' + ordinal(m.place) + ' of ' + m.total + '!' + (m.gems ? ' +' + m.gems + ' 💎' : ''), m.place <= 3 ? '#ffd028' : '#ffffff');
            if (m.place <= 3) sfx('placed');
        } else toast('Practice game: you survived ' + m.rounds + ' rounds and answered ' + m.correct + ' correctly!', '#9ae8ff');
    });
    room.onMessage('ended', (m) => { if (m.counted) setTimeout(() => showPlacements(m.placements || []), 1300); spec.stop(); });
    room.onMessage('nuke', (m) => nukeStrike(m));
    room.onLeave((code, reason) => {
        console.warn('[net] left room', code, reason || '');
        net.room = null;
        if (code !== 1000) $('#offline').hidden = false;
    });
    return room;
}

// ----- the nuke: a missile falls from the sky, then a blinding flash -----
let myBurn = 0;
function nukeStrike(m) {
    const arena = m.where === 'arena';
    const target = arena ? new V3(0, Math.max(lavaSurfaceY(), -12), 0) : SPAWN_POS.clone().add(new V3(0, 0, -40));
    toast('☢️ ' + m.by + ' launched a NUKE!', '#c8ff2a');
    sfx('nukeLaunch');
    const missile = new T.Group();
    const body = new T.Mesh(new T.CylinderGeometry(1.6, 1.6, 10, 16), toLambert({ color: 0x4a5a4a, metalness: 0.5, roughness: 0.4 }));
    const nose = new T.Mesh(new T.ConeGeometry(1.6, 3.4, 16), toLambert({ color: 0xe8342a, roughness: 0.4 }));
    nose.position.y = -6.7; nose.rotation.x = Math.PI;
    missile.add(body, nose);
    for (let k = 0; k < 4; k++) { const fin = new T.Mesh(new T.BoxGeometry(0.3, 3, 2.6), body.material); fin.position.set(Math.cos(k * Math.PI / 2) * 1.6, 4, Math.sin(k * Math.PI / 2) * 1.6); fin.rotation.y = -k * Math.PI / 2; missile.add(fin); }
    missile.position.copy(target).add(new V3(0, 380, 0));
    scene.add(missile);
    const t0 = performance.now();
    (function fall() {
        const k = Math.min(1, (performance.now() - t0) / 1700);
        missile.position.y = target.y + 380 * (1 - k * k);
        if (Math.random() < 0.8) flame(missile.position.clone().add(new V3(0, 5, 0)), 1.5, 2.2, new V3(0, 30, 0));
        if (k < 1) { requestAnimationFrame(fall); return; }
        scene.remove(missile);
        nukeFx(target); flash('#ffffe0', 1400); sfx('nuke'); addShake(1.2); rumble(1, 900);
        ring(target, 0xffd028, 60, 1.2);
        // in the lobby, everyone but the buyer is blown off their feet
        const me = net.me();
        if (!arena && me && !me.inMatch && m.s !== net.room.sessionId) {
            P.vel.y = 70; P.kv.set((Math.random() - 0.5) * 70, 0, (Math.random() - 0.5) * 70); P.onGround = false;
        }
    })();
}

// =====================================================================================
// Camera & input
// =====================================================================================
const cam = { yaw: SPAWN_YAW + Math.PI, pitch: 0.32, dist: 22, target: new V3() };
let camDistS = 22;
let camSens = 1;
const keys = {};
const touchMove = { x: 0, y: 0 };
let touchJump = false, running = false;

function pressJump() { P.jumpPress = clockT; }
addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { if (e.key === 'Enter') e.target.blur(); return; }
    if (running && /^(Digit|Numpad)[1-4]$/.test(e.code) && answerKey(+e.code.slice(-1) - 1)) { e.preventDefault(); return; }
    if (e.code === 'Space' && !e.repeat && running) pressJump();
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'KeyE' && running && activePrompt) usePrompt();
    if (spec.on && (e.code === 'KeyQ' || e.code === 'KeyZ')) spec.step(-1);
    if (spec.on && (e.code === 'KeyR' || e.code === 'KeyX')) spec.step(1);
    if (e.code === 'Escape') {
        if (closeTop()) return;
        if (spec.on) { spec.stop(); return; }
        if (running && BX.isEmbedded()) BX.showPortalMenu();
    }
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
// No browser menu anywhere in the game (it would swallow the mouse-up of a right-drag), except in
// text fields
addEventListener('contextmenu', (e) => { if (!(e.target && e.target.closest && e.target.closest('input, textarea'))) e.preventDefault(); });

// Camera: drag with the left or right mouse button (or a finger) to look around
const drags = new Map();
canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
    drags.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvas.focus();
});
canvas.addEventListener('pointermove', (e) => {
    const d = drags.get(e.pointerId);
    if (!d) return;
    // the button came up somewhere we never heard about (a menu, another window): stop dragging
    // instead of turning the camera with every mouse move
    if (e.pointerType === 'mouse' && !(e.buttons & 3)) { drags.delete(e.pointerId); return; }
    const k = (e.pointerType === 'touch' ? 0.008 : 0.005) * camSens;
    // one event can't turn the camera more than a little (a jump in the pointer position after a
    // lost capture would otherwise flip it)
    const dx = clamp(e.clientX - d.x, -120, 120), dy = clamp(e.clientY - d.y, -120, 120);
    cam.yaw -= dx * k;
    cam.pitch = clamp(cam.pitch + dy * k, -0.45, 1.25);
    d.x = e.clientX; d.y = e.clientY;
});
const endDrag = (e) => drags.delete(e.pointerId);
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('lostpointercapture', endDrag);
addEventListener('blur', () => drags.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) drags.clear(); });
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist + Math.sign(e.deltaY) * 3, 8, 110); e.preventDefault(); }, { passive: false });

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
(function joystick() {
    const stick = $('#stick'), knob = $('#knob');
    let id = null;
    const set = (e) => {
        const r = stick.getBoundingClientRect();
        let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        const max = r.width / 2, l = Math.hypot(dx, dy);
        if (l > max) { dx *= max / l; dy *= max / l; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        touchMove.x = dx / max; touchMove.y = dy / max;
    };
    stick.addEventListener('pointerdown', (e) => { id = e.pointerId; stick.setPointerCapture(id); set(e); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; knob.style.transform = ''; touchMove.x = touchMove.y = 0; };
    stick.addEventListener('pointerup', end); stick.addEventListener('pointercancel', end);
    const jb = $('#jumpBtn');
    jb.addEventListener('pointerdown', (e) => { e.preventDefault(); touchJump = true; pressJump(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) jb.addEventListener(ev, () => { touchJump = false; });
})();

// Ray against the boxes (camera collision); barriers and the VIP door don't block the view
function rayHit(o, d, maxT) {
    let best = maxT;
    for (const c of solids) {
        if (c.off || c.mat === 'barrier' || c.mat === 'door') continue;
        let t0 = 0, t1 = best, hit = true;
        for (const a of ['x', 'y', 'z']) {
            if (Math.abs(d[a]) < 1e-9) { if (o[a] < c.min[a] || o[a] > c.max[a]) { hit = false; break; } continue; }
            let ta = (c.min[a] - o[a]) / d[a], tb = (c.max[a] - o[a]) / d[a];
            if (ta > tb) { const q = ta; ta = tb; tb = q; }
            t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
            if (t0 > t1) { hit = false; break; }
        }
        if (hit && t0 > 0 && t0 < best) best = t0;
    }
    return best;
}

// ----- spectating: watch the players still alive in the game -----
const spec = {
    on: false, i: 0, id: null,
    list() {
        const st = net.state(), out = [];
        if (st) st.players.forEach((p, id) => { if (id !== net.room.sessionId && p.inMatch && p.alive) out.push({ id, p }); });
        return out.sort((a, b) => b.p.height - a.p.height);
    },
    start() {
        const me = net.me();
        if (me && me.inMatch && me.alive) return;
        if (!this.list().length) { toast('No game to watch right now!', '#9ae8ff'); return; }
        this.on = true; this.i = 0;
        $('#spectate').hidden = false;
        this.focus();
        if (lastQuestion && net.state().phase === 'question') onQuestion(lastQuestion, false, true);
    },
    stop() { if (!this.on) return; this.on = false; this.id = null; $('#spectate').hidden = true; },
    step(d) { this.i += d; this.focus(); },
    focus() {
        const l = this.list();
        if (!l.length) { this.stop(); return; }
        this.i = ((this.i % l.length) + l.length) % l.length;
        this.id = l[this.i].id;
        $('#specName').textContent = l[this.i].p.name;
    },
};
actions.spectate = () => spec.start();
$('#specPrev').addEventListener('click', () => spec.step(-1));
$('#specNext').addEventListener('click', () => spec.step(1));
$('#specStop').addEventListener('click', () => spec.stop());

const camDir = new V3(), camGoal = new V3(), camPos = new V3();
function updateCamera(dt) {
    const t = performance.now() / 1000;
    if (!running) {
        camera.position.set(Math.sin(t * 0.06) * 140, 70 + Math.sin(t * 0.1) * 12, Math.cos(t * 0.06) * 140);
        camera.lookAt(0, 10, 0);
        updateSky(camera.position, t);
        return;
    }
    let focus = P.pos;
    if (spec.on) {
        const r = remotes.get(spec.id);
        if (r) focus = r.rig.position; else spec.focus();
        const st = net.state(), p = st && st.players.get(spec.id);
        if (p) $('#specInfo').textContent = 'Tower: ' + p.height + ' blocks';
    }
    cam.target.lerp(camGoal.set(focus.x, focus.y + 5, focus.z), 1 - Math.exp(-dt * 14));
    const cp = Math.cos(cam.pitch);
    camDir.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    // pull in at once when something gets between the camera and you, ease back out afterwards
    const want = Math.max(2.5, rayHit(cam.target, camDir, cam.dist) - 0.8);
    camDistS = want < camDistS ? want : camDistS + (want - camDistS) * (1 - Math.exp(-dt * 5));
    camPos.copy(cam.target).addScaledVector(camDir, camDistS);
    // never look from under the lava
    camPos.y = Math.max(camPos.y, lavaSurfaceY() + 1.5);
    camera.position.copy(camPos);
    camera.lookAt(cam.target);
    if (shake > 0.001) {
        const s = shake * shake * 0.9;
        camera.position.x += (Math.random() * 2 - 1) * s;
        camera.position.y += (Math.random() * 2 - 1) * s;
        shake = Math.max(0, shake - dt * 2.2);
    }
    sun.position.set(focus.x + 60, focus.y + 110, focus.z - 80);
    sun.target.position.copy(focus);
    camFill.position.copy(camera.position).setY(camera.position.y + 6);
    camFill.target.position.copy(cam.target);
    updateSky(camera.position, t);
}

// Proximity prompts
let activePrompt = null;
const projV = new V3();
function updatePrompt() {
    let best = null, bd = Infinity;
    if (!P.riding) for (const p of prompts) {
        const d = Math.hypot(p.pos.x - P.pos.x, p.pos.z - P.pos.z);
        if (d < p.r && d < bd && Math.abs(P.pos.y - p.pos.y) < 8) { bd = d; best = p; }
    }
    activePrompt = best;
    if (!best || anyPopup()) { promptEl.hidden = true; return; }
    projV.copy(best.pos).setY(best.pos.y + 3).project(camera);
    if (projV.z > 1) { promptEl.hidden = true; return; }
    promptEl.hidden = false;
    promptEl.style.left = ((projV.x + 1) / 2 * innerWidth) + 'px';
    promptEl.style.top = ((1 - projV.y) / 2 * innerHeight) + 'px';
    const txt = best.label();
    if (promptTxtEl.textContent !== txt) promptTxtEl.textContent = txt;
}
function usePrompt() { if (activePrompt) activePrompt.act(); }
promptEl.addEventListener('click', usePrompt);
actions.chest = () => net.send('chest');

// Controller: popups first, then gameplay
let padJumpWas = false;
function padButtons() {
    if (pad.jump && !padJumpWas && running) pressJump();
    padJumpWas = pad.jump;
    const p = pad.pressed;
    if (!p.size) return;
    if (p.has('B') && closeTop()) return;
    if (!running) return;
    // answers on the face buttons while a question is up: A B X Y = 1 2 3 4
    const ansMap = { A: 0, B: 1, X: 2, Y: 3 };
    for (const [b, i] of Object.entries(ansMap)) if (p.has(b) && answerKey(i)) return;
    if (p.has('X') && activePrompt) usePrompt();
    if (p.has('Y')) openModal('select');
    if (p.has('BACK')) openModal('pets');
    if (p.has('START')) openModal('settings');
    if (spec.on && p.has('LB')) spec.step(-1);
    if (spec.on && p.has('RB')) spec.step(1);
    if (p.has('UP')) cam.dist = clamp(cam.dist - 5, 8, 110);
    if (p.has('DOWN')) cam.dist = clamp(cam.dist + 5, 8, 110);
}
onGamepadConnection((g, on) => { if (running) toast(on ? '🎮 Controller connected' : '🎮 Controller disconnected', on ? '#7dff6b' : '#ffb51c'); });

// =====================================================================================
// Status line and the big screen, from the game phase
// =====================================================================================
let lastCountdown = -1, lavaSoundAt = 0;
function phaseUi(st, me, now) {
    const phase = st.phase, left = Math.max(0, Math.ceil((st.phaseEnd - now) / 1000));
    const inGame = !!(me && me.inMatch), alive = !!(me && me.inMatch && me.alive);
    const count = st.players.size;
    // the status line
    if (phase === 'waiting') setStatus(`Waiting for players... (${count}/${st.need})`);
    else if (phase === 'intermission') setStatus(`Game starts in ${left}`);
    else if (phase === 'voting') { setStatus(`Voting ends in ${left}`); $('#placements').hidden = true; }
    else if (st.matchId && !inGame) setStatus(st.round ? `Game in progress · Round ${st.round} · ${st.alive} left` : 'Game starting...', true, quizVisible());
    else setStatus('', false, true);
    // countdown beeps
    if ((phase === 'intermission' || phase === 'voting') && left !== lastCountdown) {
        lastCountdown = left;
        if (left <= 3 && left > 0) sfx('beep');
        if (left === 0 && phase === 'intermission') sfx('go');
    }
    // the big screen over the pit
    const mode = st.mode ? diffById[st.mode] : null;
    const head = st.round ? `ROUND ${st.round} · ${(mode ? mode.name : '').toUpperCase()}` : mode ? mode.name.toUpperCase() + ' MODE' : 'MATH TOWER RACE';
    const status = st.matchId ? `${st.alive} / ${st.started} players left` : '';
    if (phase === 'waiting') setScreen({ header: 'MATH TOWER RACE', big: 'Waiting for players...', status: `${count} / ${st.need} players` });
    else if (phase === 'intermission') setScreen({ header: 'MATH TOWER RACE', timer: `Game starts in ${left}`, big: 'Next game soon!', status: 'Get ready!' });
    else if (phase === 'voting') setScreen({ header: 'VOTING', timer: `Voting ends in ${left}`, big: 'Pick a difficulty!', status: 'Stand on a pad to vote' });
    else if (phase === 'voteResult' || phase === 'starting') setScreen({ header: head, big: mode ? `"${mode.name}" was selected!` : 'Get ready!', status });
    else if (phase === 'roundIntro') setScreen({ header: head, big: `The lava will rise by ${lavaRise(st.round)} blocks after this round!`, small: true, status });
    else if (phase === 'question' && lastQuestion) setScreen({ header: head, timer: clock(left), urgent: left <= 5, big: lastQuestion.text, small: lastQuestion.small || lastQuestion.text.length > 22, visual: lastQuestion.visual, status });
    else if (phase === 'results' && lastQuestion) setScreen({ header: head, big: lastQuestion.reveal || lastQuestion.text, small: true, status });
    else if (phase === 'rising') setScreen({ header: head, big: 'Lava is rising!', status });
    else if (phase === 'elimination') setScreen({ header: head, big: lastElimText || 'Eliminated!', small: true, status });
    else if (phase === 'victory') setScreen({ header: 'GAME OVER', big: lastWinText || 'Game over!', status });
    // vote counts on the pads
    setVotes({ Easy: st.vEasy, Medium: st.vMedium, Hard: st.vHard, Algebra: st.vAlgebra });
    // the lava rumble
    if (lavaRising(st, now) && st.lavaAt !== lavaSoundAt) { lavaSoundAt = st.lavaAt; sfx('lava'); }
    // music: the quiz track while you're in a game
    setTrack(alive ? 'match' : 'lobby');
    updateHud(inGame, alive, !!st.matchId, spec.on);
    if (spec.on && (!st.matchId || alive)) spec.stop();
    return { phase, inGame, alive };
}

// =====================================================================================
// Main update
// =====================================================================================
const botInput = { f: 0, r: 0, jump: false };
let clockT = 0;
const tmpF = new V3(), tmpR = new V3(), mv = new V3();

function update(dt) {
    clockT += dt;
    const t = clockT;
    const st0 = net.state(), st = st0 && st0.players ? st0 : null, me = st ? net.me() : null, now = net.now();
    const ui = st ? phaseUi(st, me, now) : { phase: '', inGame: false, alive: false };

    // ----- input -----
    let f = botInput.f, r = botInput.r;
    if (keys.KeyW || keys.ArrowUp) f += 1;
    if (keys.KeyS || keys.ArrowDown) f -= 1;
    if (keys.KeyD || keys.ArrowRight) r += 1;
    if (keys.KeyA || keys.ArrowLeft) r -= 1;
    f -= touchMove.y + pad.ly; r += touchMove.x + pad.lx;
    cam.yaw -= pad.rx * 2.8 * dt;
    cam.pitch = clamp(cam.pitch + pad.ry * 1.8 * dt, -0.45, 1.25);
    tmpF.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
    tmpR.set(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    mv.set(0, 0, 0).addScaledVector(tmpF, f).addScaledVector(tmpR, r);
    if (mv.lengthSq() > 1) mv.normalize();
    if (anyPopup() && !isTouch) mv.set(0, 0, 0);

    // ----- on your tower in a game: you ride its top, no walking -----
    const tw = ui.alive && me ? towerOf(net.room.sessionId) : null;
    P.riding = !!tw;
    if (tw) {
        const top = tw.top();
        P.pos.x += (tw.x - P.pos.x) * Math.min(1, dt * 12);
        P.pos.z += (tw.z - P.pos.z) * Math.min(1, dt * 12);
        P.pos.y = P.pos.y < top ? P.pos.y + (top - P.pos.y) * Math.min(1, dt * 22) : top;
        if (Math.abs(P.pos.y - top) < 0.02) P.pos.y = top;
        P.vel.set(0, 0, 0); P.kv.set(0, 0, 0);
        P.onGround = true; P.moving = false; P.airTime = 0; P.peakY = P.pos.y;
        // turn to face where the camera looks while you wait
        if (mv.lengthSq() > 0.01) P.facing = lerpAngle(P.facing, Math.atan2(mv.x, mv.z), 1 - Math.exp(-dt * 10));
    } else {
        P.moving = mv.lengthSq() > 0.01;
        const pressed = t - P.jumpPress < 0.2;
        if (P.onGround) P.coyote = 0.1; else P.coyote -= dt;
        if (pressed && (P.onGround || P.coyote > 0)) {
            P.vel.y = CFG.jumpV; P.onGround = false; P.coyote = 0; P.jumpPress = -9; P.ground = null;
            sfx('jump'); P.squashV += 5;
        }
        P.vel.y -= CFG.grav * dt;
        const tx = mv.x * CFG.walk, tz = mv.z * CFG.walk;
        const vx = tx + P.kv.x, vz = tz + P.kv.z;
        P.kv.multiplyScalar(Math.exp(-dt * (P.onGround ? 9 : 1.2)));
        const dist = Math.max(Math.abs(vx), Math.abs(vz), Math.abs(P.vel.y)) * dt;
        const n = Math.max(1, Math.ceil(dist / 0.5));
        const sdt = dt / n;
        const wasOn = P.onGround;
        P.onGround = false; P.ground = null;
        let vy = P.vel.y + 0.5 * CFG.grav * dt;
        for (let i = 0; i < n; i++) {
            moveAxis('x', vx * sdt);
            moveAxis('z', vz * sdt);
            const before = P.vel.y;
            moveAxis('y', vy * sdt);
            if (P.vel.y !== before) vy = P.vel.y;
        }
        if (!P.onGround && wasOn && P.vel.y <= 0) groundProbe(0.7);
        if (P.onGround) {
            if (P.airTime > 0.3) { sfx('land'); dust(P.pos, P.airTime > 0.8 ? 10 : 5, 1); P.squashV -= P.airTime > 0.8 ? 8 : 4; }
            P.airTime = 0; P.peakY = P.pos.y;
        } else { P.airTime += dt; P.peakY = Math.max(P.peakY, P.pos.y); }
        if (P.moving) P.facing = lerpAngle(P.facing, Math.atan2(mv.x, mv.z), 1 - Math.exp(-dt * 14));
        // safety net: fell out of the world -> back to spawn
        if (P.pos.y < -60 || Math.abs(P.pos.x) > 260 || Math.abs(P.pos.z) > 260) teleport(spawnSpot(), SPAWN_YAW, true);
    }

    // gems: pick up the ones you touch (the server checks it)
    if (!ui.inGame) for (const g of gems) {
        if (g.until > now || g.pending > performance.now()) continue;
        if (g.vip && !S.passes.VIP) continue;
        const dx = g.x - P.pos.x, dy = g.y - (P.pos.y + 2.5), dz = g.z - P.pos.z;
        if (dx * dx + dy * dy + dz * dz < 3.6 * 3.6) { g.pending = performance.now() + 1500; net.send('gem', { i: g.i }); }
    }

    if (S.name && headLabel) {
        const key = S.name + '|' + S.wins + '|' + !!S.passes.VIP;
        if (key !== labelKey) { labelKey = key; headLabel.userData.set(nameLines(S.name, S.wins, S.passes.VIP)); }
    }
    updateWorld(dt, t, now, camera.position);
    updateLava(st, now, dt, t, camera.position);
    if (st) syncTowers(st.players, net.room.sessionId, st.matchId);
    updateTowers(dt, t);
    updateEffects(dt);
    updateFx(dt);
    updateReactions(dt);
    updateQuiz(now, ui.phase, ui.alive);
    for (const p of torches) if (Math.random() < dt * 14) flame(p, 0.8, 1.6);
    syncRemotes(dt, t);

    // ----- the local character -----
    if (rig) {
        const u = rig.userData;
        rig.position.copy(P.pos);
        const dance = me && (me.celebrate || (me.dancing && !P.moving && P.onGround)) ? (S.dance || 'classic') : '';
        if (dance === 'tornado') P.facing += dt * 9;
        rig.rotation.y = P.facing;
        P.animPhase += dt * (P.onGround && P.moving ? Math.min(18, 4 + CFG.walk * 0.3) : 0);
        let bounce = 0;
        if (dance) bounce = dancePoseRig(u.body, dance, t);
        else if (!P.onGround) airPose(u.body);
        else if (P.moving) animRig(u.body, P.animPhase, 0.85);
        else animRig(u.body, 0, 0);
        if (localAvatar) localAvatar.update(dt, { moving: P.moving && P.onGround, air: !P.onGround, vy: P.vel.y, speed: CFG.walk, t, dance });
        const stepN = Math.floor(P.animPhase / Math.PI);
        if (P.onGround && P.moving && stepN !== P.lastStepN) sfx('step');
        P.lastStepN = stepN;
        P.squashV += (1 - P.squash) * 180 * dt;
        P.squashV *= Math.exp(-12 * dt);
        P.squash = clamp(P.squash + P.squashV * dt, 0.75, 1.25);
        // the Bloxity avatar leans and crouches on landing by itself (animator.js): the whole-body
        // lean and squash are for the blocky stand-in
        const sq = localAvatar ? 1 : P.squash;
        rig.scale.set(1 / Math.sqrt(sq), sq, 1 / Math.sqrt(sq));
        u.pivot.position.y = PIVOT + bounce * 0.5;
        u.pivot.rotation.x = P.onGround && P.moving && !localAvatar ? 0.12 : 0;
        if (myBurn > 0) { myBurn -= dt; if (Math.random() < dt * 30) flame(P.pos.clone().add(new V3(0, 2.5, 0)), 2, 1.8); if (Math.random() < dt * 8) smoke(P.pos.clone().add(new V3(0, 4, 0)), 2); }
        if (myPets) {
            myPets.set(equippedPetDefs());
            myPets.update(P.pos, P.facing, dt, t, true);
        }
    }
    sendMove(false);
    updatePrompt();
    animateCounters(dt);
}
let petKeyCache = '', petDefsCache = [];
function equippedPetDefs() {
    const key = (S.equippedPets || []).join(',') + '|' + (S.pets || []).length;
    if (key !== petKeyCache) {
        petKeyCache = key;
        petDefsCache = (S.equippedPets || []).map((u) => (S.pets || []).find((p) => p.u === u)).filter(Boolean).map((p) => petById[p.id]).filter(Boolean);
    }
    return petDefsCache;
}

// =====================================================================================
// Boot
// =====================================================================================
let lastFrame = 0, loadingSignaled = false, fpsAcc = 0, fpsFrames = 0, showFps = false;
// Slow PC? After joining, if the game keeps running under ~40 FPS for 3 s, step the graphics down
// Steps the graphics down only when the game is really struggling for a while (not for a loading
// hitch), one level at a time and never saved: the next visit starts on the default again
const fpsWatch = { t: 0, low: 0, cool: 0 };
function watchFps(fps) {
    if (!running || document.hidden || !autoQualityAllowed()) { fpsWatch.low = 0; return; }
    fpsWatch.t += 0.5;
    if (fpsWatch.t < 12 || fpsWatch.t < fpsWatch.cool) return;
    const q = getQuality(), limit = q === 'high' ? 34 : 24;
    fpsWatch.low = fps < limit ? fpsWatch.low + 0.5 : Math.max(0, fpsWatch.low - 1);
    if (fpsWatch.low < 6) return;
    fpsWatch.low = 0;
    fpsWatch.cool = fpsWatch.t + 20;
    const next = { high: 'medium', medium: 'low' }[q];
    if (!next) return;
    setQuality(next, true);
    toast('⚙️ Graphics set to ' + (next === 'medium' ? 'Medium' : 'Low') + ' for smoother play', '#7de8ff');
}
function frame(now) {
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    fpsAcc += (now - (lastFrame || now)) / 1000; fpsFrames++;
    if (fpsAcc >= 0.5) { if (showFps) $('#fps').textContent = Math.round(fpsFrames / fpsAcc) + ' FPS'; watchFps(fpsFrames / fpsAcc); fpsAcc = 0; fpsFrames = 0; }
    lastFrame = now;
    if (!loadingSignaled) { loadingSignaled = true; BX.triggerAllSettings(); }
    pollGamepad();
    padButtons();
    // one bad frame must never stop the loop
    try {
        if (running) update(dt);
        else if (!warming) { updateWorld(dt, now / 1000, net.now(), camera.position); updateLava(null, 0, dt, now / 1000, camera.position); }
    } catch (e) { if (!frame.errored) { frame.errored = true; console.error('[frame]', e); } }
    if (!warming || running) { updateCamera(dt); render(); }
    requestAnimationFrame(frame);
}

// Straight into the game: no menu. Joins with the Bloxity name (or a guest name) automatically.
let joining = false;
async function play() {
    if (joining || running) return;
    joining = true;
    const err = $('#connectErr'), retry = $('#playBtn');
    err.hidden = true; retry.hidden = true;
    $('#loading').hidden = false;
    $('#loading').textContent = 'Joining…';
    BX.loadingStep('Joining a server…');
    initAudio();
    try {
        await waitForLogin(1500);
        const saved = (storageGet('mtr_name') || '').slice(0, 20);
        let room = null;
        for (let attempt = 0; !room; attempt++) {
            try { room = await connect(BX.identity().loggedIn ? '' : saved); } catch (e) {
                if (attempt >= 4) throw e;
                console.warn('[join] attempt', attempt + 1, 'failed:', e && e.message);
                $('#loading').textContent = 'Waking up a server…';
                await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
            }
        }
        const me = room.state.players && room.state.players.get(room.sessionId);
        S.name = me ? me.name : S.name;
    } catch (e) {
        console.error(e);
        joining = false;
        $('#loading').hidden = true;
        err.hidden = false;
        err.textContent = 'Could not reach the game server. Check your connection and try again.';
        retry.hidden = false;
        BX.loadingEnd();
        return;
    }
    $('#loading').textContent = 'Getting the island ready…';
    await Promise.race([prewarmed, new Promise((r) => setTimeout(r, 15000))]);
    joining = false;
    running = true;
    startMusic();
    $('#start').hidden = true;
    $('#hud').hidden = false;
    $('#touch').hidden = !isTouch;
    if (!rig) buildPlayer(0, 0);
    teleport(spawnSpot(), SPAWN_YAW);
    cam.target.set(P.pos.x, P.pos.y + 5, P.pos.z);
    net.send('ready');
    showTips();
    toast('Answer math questions fast to stack your tower above the lava!', '#ffe254');
    setTimeout(() => { if (audioSuspended()) toast('🔊 Click or tap anywhere for sound!', '#9ae8ff'); }, 3500);
    canvas.focus();
    BX.loadingEnd();
}
function waitForLogin(ms) {
    if (!BX.bloxity.ready || BX.identity().loggedIn) return Promise.resolve();
    return new Promise((res) => {
        const t0 = performance.now();
        (function check() { if (BX.identity().loggedIn || performance.now() - t0 > ms) res(); else setTimeout(check, 100); })();
    });
}
function showTips() {
    const el = $('#tips');
    const k = (key, what) => `<span><kbd>${key}</kbd>${what}</span>`;
    el.innerHTML = pad.connected
        ? k('L', 'Move') + k('A', 'Jump') + k('A B X Y', 'Answer 1-4') + k('R', 'Camera')
        : isTouch
            ? '<span>Joystick to move · JUMP · tap an answer · drag to look</span>'
            : k('WASD', 'Move') + k('Space', 'Jump') + k('1-4', 'Answer') + k('E', 'Use') + k('Drag', 'Camera') + k('Wheel', 'Zoom');
    el.hidden = false; el.style.opacity = 1;
    setTimeout(() => { el.style.opacity = 0; }, 10000);
    setTimeout(() => { el.hidden = true; }, 10900);
}
function unlockAudioOnGesture() {
    const unlock = () => {
        resumeAudio();
        if (!audioSuspended()) for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) removeEventListener(ev, unlock, true);
    };
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchstart', 'touchend', 'click']) addEventListener(ev, unlock, true);
}
function wirePortalSettings() {
    const embedded = (fn) => (v) => { if (BX.isEmbedded()) fn(v); };
    const pct = (v) => { const n = parseFloat(String(v)); if (!isFinite(n)) return undefined; return clamp(n > 1 ? n / 100 : n, 0, 1); };
    BX.listenSetting('master_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('master', p); }));
    BX.listenSetting('music_volume', embedded((v) => { const p = pct(v); if (p !== undefined) setVolume('music', p); }));
    BX.listenSetting('graphics_quality', embedded((v) => setQuality(v === 'Low' ? 'low' : v === 'Medium' ? 'medium' : 'high', true)));
    BX.listenSetting('camera_sensitivity', embedded((v) => { camSens = clamp(parseFloat(v) || 1, 0.1, 5); }));
    BX.listenSetting('show_fps', (v) => { showFps = v === 'true'; $('#fps').hidden = !showFps; });
}
function wirePortalEvents() {
    BX.onPortalEvent((event, data) => {
        if (event === 'respawn_request') { const me = net.me(); if (running && !(me && me.inMatch)) teleport(spawnSpot(), SPAWN_YAW, true); }
        else if (event === 'chat_message_sent' && data) net.send('chat', { text: String(data) });
        else if (event === 'play_emote' && data) { playEmoteOn(localAvatar, String(data)); net.send('emote', { id: String(data) }); }
    });
    BX.onAvatarChanged(() => syncMyAvatar());
    BX.onProportionsChanged(() => syncMyAvatar());
}
function showIdentity(id) {
    const avail = BX.bloxity.ready;
    $('#acct').hidden = !avail;
    if (!avail) return;
    $('#acctName').textContent = id.name || 'Guest';
    $('#acctBtn').textContent = id.loggedIn ? 'Log out' : 'Log in';
    const pfp = $('#acctPfp');
    pfp.hidden = !id.pfp;
    if (id.pfp) pfp.src = id.pfp;
}
function toggleLogin() { if (BX.identity().loggedIn) BX.logout(); else BX.login(); }

// ----- warm-up while the loading screen is up: every shader compiled and texture uploaded -----
let prewarmed = Promise.resolve(), warming = false;
async function prewarm() {
    warming = true;
    const t0 = performance.now();
    const standP = Promise.race([createAvatar(null), new Promise((r) => setTimeout(() => r(null), 6000))]).catch(() => null);
    // things that only show up later (every tower skin, every pet, a ring) get compiled now too
    const extra = new T.Group();
    extra.add(towerPrewarmGroup());
    for (const def of PETS) { const p = petModel(def); p.position.set(0, -200, 0); extra.add(p); }
    ring(new V3(0, -200, 0), 0xffffff, 1, 0.01);
    scene.add(extra);
    const hidden = [], culled = [];
    scene.traverse((o) => {
        if (!o.visible && o !== scene) { hidden.push(o); o.visible = true; }
        if ((o.isMesh || o.isSprite || o.isPoints) && o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
    });
    try {
        if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
        else renderer.compile(scene, camera);
    } catch (e) { console.warn('[prewarm] compile', e); }
    const seen = new Set();
    const upload = (t) => { if (t && t.isTexture && !seen.has(t)) { seen.add(t); try { renderer.initTexture(t); } catch (e) { /* skip */ } } };
    scene.traverse((o) => {
        const list = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of list) { for (const k in m) upload(m[k]); if (m.uniforms) for (const k in m.uniforms) upload(m.uniforms[k] && m.uniforms[k].value); }
    });
    try { render(); } catch (e) { console.warn('[prewarm] render', e); }
    for (const o of hidden) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
    scene.remove(extra);
    const stand = await standP;
    if (stand) {
        try {
            stand.root.position.set(SPAWN_POS.x, SPAWN_POS.y, SPAWN_POS.z + 4);
            scene.add(stand.root);
            if (renderer.compileAsync) await renderer.compileAsync(stand.root, camera, scene);
        } catch (e) { console.warn('[prewarm] avatar', e); }
        stand.dispose();
    }
    warming = false;
    console.info('[prewarm] ready in', Math.round(performance.now() - t0), 'ms,', renderer.info.programs.length, 'shaders,', seen.size, 'textures');
}

async function boot() {
    BX.initBloxity();
    BX.loadingStep('Loading fonts…');
    try { await Promise.race([document.fonts.load('700 40px Fredoka'), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* fallback font */ }
    BX.loadingStep('Building the island…');
    buildWorld();
    loadBase().catch(() => {});
    prewarmed = prewarm();
    wirePortalSettings();
    wirePortalEvents();
    BX.onIdentity((id) => {
        showIdentity(id);
        if (net.room && id.loggedIn && id.token && !net.bloxity) net.send('auth', { token: id.token });
        if (net.room) { setupLocalAvatar(); syncMyAvatar(); }
    });
    $('#acctBtn').addEventListener('click', toggleLogin);
    $('#acctPfp').addEventListener('error', (e) => { e.target.hidden = true; });
    $('#playBtn').addEventListener('click', play);
    $('#reconnectBtn').addEventListener('click', () => location.reload());
    unlockAudioOnGesture();
    requestAnimationFrame(frame);
    play();
}
boot();

// Dev-only hooks for automated QA runs (stripped from production builds)
if (import.meta.env.DEV || import.meta.env.VITE_QA) {
    window.__qa = {
        audio: () => audioDebug(), input: (o) => Object.assign(botInput, o), jump: () => pressJump(), P, S, cam, scene, camera, renderer, net, spec, setQuality, towerDebug,
        teleport: (x, y, z, yaw) => teleport(new V3(x, y, z), yaw || 0),
        look: (yaw, pitch, dist) => { cam.yaw = yaw; cam.pitch = pitch; cam.dist = dist; },
        state: () => ({ x: +P.pos.x.toFixed(2), y: +P.pos.y.toFixed(2), z: +P.pos.z.toFixed(2), onGround: P.onGround, riding: P.riding, gems: S.gems, phase: net.state() && net.state().phase }),
        answer: (i) => answerKey(i),
    };
}
