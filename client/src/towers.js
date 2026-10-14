// Every player's tower in the lava pit. Heights come from the server (PlayerState.height); this
// module stacks the blocks with the owner's block animation, in the owner's tower skin, and burns
// and sinks a tower when its owner is eliminated. One InstancedMesh per tower.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { T, scene, NEON_BOOST, lavaGlowY } from './engine.js';
import { blockBurst, flame, smoke, sparkleColumn } from './fx.js';
import { sfx } from './audio.js';
import { CFG, towerById, towerColor, TOWERS } from '../../shared/config.js';
import { SLOTS, towerTopY, FLOOR_Y } from '../../shared/arena.js';

const H = CFG.blockH, HW = CFG.towerW / 2;
export const BLOCK = new RoundedBoxGeometry(CFG.towerW, H, CFG.towerW, 2, 0.16);
export const towerColorOf = towerColor;

// Every block reads as its own bevelled brick: a dark groove along its edges, a light bevel just
// inside, sides shaded a little darker towards the bottom and an inset frame on the top face.
// It's worked out in the shader from the block's own (local) position, so it works for every
// skin, the instance colours and any scale.
// The lava's warm glow on the blocks just above it is worked out here too (cheaper than a light).
const f = (v) => v.toFixed(3);
function blockify(m) {
    m.onBeforeCompile = (sh) => {
        sh.uniforms.uLavaY = lavaGlowY;
        sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vBlk;\nvarying vec3 vBlkN;\nvarying float vBlkY;')
            .replace('#include <begin_vertex>', `#include <begin_vertex>
                vBlk = position; vBlkN = normal;
                vec4 blkW = vec4(transformed, 1.0);
                #ifdef USE_INSTANCING
                    blkW = instanceMatrix * blkW;
                #endif
                vBlkY = (modelMatrix * blkW).y;`);
        sh.fragmentShader = sh.fragmentShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vBlk;\nvarying vec3 vBlkN;\nvarying float vBlkY;\nuniform float uLavaY;')
            .replace('#include <color_fragment>', `#include <color_fragment>
            {
                vec3 a = abs(vBlk);
                bool topFace = abs(vBlkN.y) > 0.6;
                float e = topFace ? ${f(HW)} - max(a.x, a.z) : min(${f(H / 2)} - a.y, ${f(HW)} - (abs(vBlkN.x) > abs(vBlkN.z) ? a.z : a.x));
                float groove = smoothstep(0.015, 0.14, e);
                float bevel = (1.0 - smoothstep(0.14, 0.3, e)) * groove;
                float k = mix(0.6, 1.0, groove);
                if (topFace) k *= 1.0 - 0.09 * (1.0 - smoothstep(0.0, 0.06, abs(e - 0.62)));
                else k *= 0.86 + 0.14 * (vBlk.y / ${f(H)} + 0.5);
                diffuseColor.rgb = diffuseColor.rgb * k + bevel * (topFace || vBlk.y > 0.0 ? 0.11 : 0.04);
                float lg = exp(-max(vBlkY - uLavaY, 0.0) * 0.45);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.62, 0.22), lg * 0.55);
            }`);
    };
    m.customProgramCacheKey = () => 'mtr-block';
    return m;
}
function makeMaterial(s) {
    let m;
    if (s.neon) {
        m = new T.MeshBasicMaterial({ color: 0xffffff });
        m.color.multiplyScalar(NEON_BOOST * 0.55);
    } else {
        // matte skins use the cheap Lambert shading; glossy / metal ones need PBR
        const rough = s.rough ?? 0.7;
        m = rough >= 0.4 && !s.metal ? new T.MeshLambertMaterial({ color: 0xffffff }) : new T.MeshStandardMaterial({ color: 0xffffff, roughness: rough, metalness: s.metal || 0 });
        if (s.glow) { m.emissive = new T.Color(s.colors[0]); m.emissiveIntensity = s.glow; }
    }
    if (s.opacity) { m.transparent = true; m.opacity = s.opacity; }
    return blockify(m);
}
// One material per skin; instance colours carry the stripes / rainbow
const mats = new Map();
export function towerMaterial(id) {
    const s = towerById[id] || TOWERS[0];
    if (!mats.has(s.id)) mats.set(s.id, makeMaterial(s));
    return mats.get(s.id);
}
// A skin's material already tinted for block i (the shop displays and thumbnails, no instancing)
export function tintedTowerMaterial(id, i) {
    const s = towerById[id] || TOWERS[0], key = s.id + '|' + i;
    if (!mats.has(key)) {
        const m = makeMaterial(s);
        m.color.multiply(new T.Color(towerColor(s.id, i)));
        mats.set(key, m);
    }
    return mats.get(key);
}

const tmpM = new T.Matrix4(), tmpQ = new T.Quaternion(), tmpS = new T.Vector3(), tmpP = new T.Vector3(), tmpC = new T.Color(), white = new T.Color(1, 1, 1), char = new T.Color(0x2e2422);
const UP = new T.Vector3(0, 1, 0);
const ease = (k) => 1 - Math.pow(1 - k, 3);
const back = (k) => { const c = 1.7; return 1 + (c + 1) * Math.pow(k - 1, 3) + c * Math.pow(k - 1, 2); };
const bounce = (k) => {
    if (k < 1 / 2.75) return 7.5625 * k * k;
    if (k < 2 / 2.75) return 7.5625 * (k -= 1.5 / 2.75) * k + 0.75;
    if (k < 2.5 / 2.75) return 7.5625 * (k -= 2.25 / 2.75) * k + 0.9375;
    return 7.5625 * (k -= 2.625 / 2.75) * k + 0.984375;
};
const ANIM_TIME = { stack: 0.12, pop: 0.3, drop: 0.45, spin: 0.35, flash: 0.35, sparkle: 0.14, fire: 0.14 };

class Tower {
    constructor(id, slot, skin, isLocal) {
        this.id = id;
        this.slot = slot;
        this.skin = skin;
        this.isLocal = isLocal;
        const p = SLOTS[slot] || SLOTS[0];
        this.x = p.x; this.z = p.z;
        this.rendered = 0;
        this.target = 0;
        this.acc = 0;
        this.anims = [];
        this.state = 'live';     // live, burn, sink
        this.stateT = 0;
        this.cap = 0;
        this.mesh = null;
        this.alloc(128);
    }
    alloc(cap) {
        const old = this.mesh;
        const m = new T.InstancedMesh(BLOCK, towerMaterial(this.skin), cap);
        m.castShadow = true; m.receiveShadow = true;
        m.frustumCulled = false;
        m.count = this.rendered;
        if (old) {
            for (let i = 0; i < this.rendered; i++) { old.getMatrixAt(i, tmpM); m.setMatrixAt(i, tmpM); old.getColorAt(i, tmpC); m.setColorAt(i, tmpC); }
            m.position.copy(old.position); m.scale.copy(old.scale);
            scene.remove(old); old.dispose();
        } else m.setColorAt(0, white);
        this.mesh = m;
        this.cap = cap;
        scene.add(m);
    }
    color(i) { return tmpC.set(towerColor(this.skin, i + 1)); }
    place(i, dy, sc, rot) {
        tmpP.set(this.x, FLOOR_Y + (i + 0.5) * H + (dy || 0), this.z);
        tmpQ.setFromAxisAngle(UP, rot || 0);
        tmpS.setScalar(sc ?? 1);
        tmpM.compose(tmpP, tmpQ, tmpS);
        this.mesh.setMatrixAt(i, tmpM);
    }
    addBlock(anim, instant) {
        const i = this.rendered;
        if (i + 1 > this.cap) this.alloc(this.cap * 2);
        this.rendered++;
        this.mesh.count = this.rendered;
        this.mesh.setColorAt(i, this.color(i));
        if (instant) { this.place(i); }
        else {
            this.anims.push({ i, t: 0, kind: anim || 'stack' });
            this.place(i, anim === 'drop' ? 16 : -H * 0.8, anim === 'pop' ? 0.25 : anim === 'spin' ? 0.55 : 1, anim === 'spin' ? Math.PI : 0);
            if (anim === 'flash') this.mesh.setColorAt(i, white);
            if (anim === 'sparkle' || anim === 'fire') blockBurst(new T.Vector3(this.x, FLOOR_Y + (i + 0.5) * H, this.z), anim);
            if (this.isLocal) sfx('block', i % 40);
            const sk = towerById[this.skin];
            if (sk && sk.sparkle && Math.random() < 0.25) blockBurst(new T.Vector3(this.x, FLOOR_Y + (i + 1) * H, this.z), 'sparkle');
        }
        this.mesh.instanceMatrix.needsUpdate = true;
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    // The top of the tower as built so far (where the owner stands)
    top() { return towerTopY(this.rendered); }
    update(dt, t, anim) {
        if (this.state === 'live') {
            // stack the missing blocks, faster when far behind
            const behind = this.target - this.rendered;
            if (behind > 0) {
                const step = behind > 14 ? 0.03 : CFG.buildInterval;
                this.acc += dt;
                while (this.acc >= step && this.rendered < this.target) { this.acc -= step; this.addBlock(anim); }
            } else this.acc = 0;
        }
        if (this.anims.length) {
            for (let k = this.anims.length - 1; k >= 0; k--) {
                const a = this.anims[k];
                a.t += dt;
                const dur = ANIM_TIME[a.kind] || 0.12, p = Math.min(1, a.t / dur);
                if (a.kind === 'pop') this.place(a.i, 0, 0.25 + 0.75 * back(p));
                else if (a.kind === 'drop') this.place(a.i, 16 * (1 - bounce(p)));
                else if (a.kind === 'spin') this.place(a.i, 0, 0.55 + 0.45 * back(p), Math.PI * (1 - ease(p)));
                else if (a.kind === 'flash') { this.place(a.i); this.mesh.setColorAt(a.i, tmpC.copy(white).lerp(this.color(a.i), ease(p))); }
                else this.place(a.i, -H * 0.8 * (1 - ease(p)));
                if (p >= 1) this.anims.splice(k, 1);
            }
            this.mesh.instanceMatrix.needsUpdate = true;
            if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
        }
        if (this.state === 'burn') {
            this.stateT += dt;
            const k = Math.min(1, this.stateT);
            for (let i = 0; i < this.rendered; i++) this.mesh.setColorAt(i, tmpC.copy(this.color(i)).lerp(char, k));
            if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
            if (Math.random() < dt * 30) flame(new T.Vector3(this.x, this.top() + 0.5, this.z), 4, 2.4);
            if (Math.random() < dt * 6) smoke(new T.Vector3(this.x, this.top() + 2, this.z), 3);
            if (this.stateT > 2.2) { this.state = 'sink'; this.stateT = 0; }
        } else if (this.state === 'sink') {
            this.stateT += dt;
            this.mesh.position.y -= dt * (4 + this.stateT * 10);
            if (Math.random() < dt * 10) smoke(new T.Vector3(this.x, this.top() + this.mesh.position.y, this.z), 3);
            if (this.stateT > 2.5) return false;
        }
        return true;
    }
    burn() { if (this.state === 'live') { this.state = 'burn'; this.stateT = 0; this.anims.length = 0; } }
    sink() { if (this.state === 'live') { this.state = 'sink'; this.stateT = 0; } }
    dispose() { scene.remove(this.mesh); this.mesh.dispose(); }
}

export const towers = new Map();
// burning / sinking towers on their way out
const dying = [];

// Called every frame with the room state: creates towers for players in the match and keeps their
// target heights in sync. New towers (joining mid-game, the start of a game) are built instantly.
let lastMatch = null;
// players whose tower already burned this game (the 'elim' message can arrive a moment before the
// state says they're out; without this their tower would be rebuilt on top of the burning one)
const burned = new Set();
export function syncTowers(players, localId, matchId) {
    if (!players) return;
    // a new game: whatever is left of the last one goes (even if we never saw it end, e.g. the tab
    // was in the background)
    if (matchId !== lastMatch) { if (lastMatch !== null) clearTowers(); lastMatch = matchId; burned.clear(); }
    const seen = new Set();
    players.forEach((p, id) => {
        if (!p.inMatch || p.slot < 0 || burned.has(id)) return;
        seen.add(id);
        let tw = towers.get(id);
        if (tw && (tw.slot !== p.slot || tw.state !== 'live' || p.height < tw.rendered - 1) && p.alive) { tw.sink(); dying.push(tw); towers.delete(id); tw = null; }
        if (!tw) {
            if (!p.alive) return;
            tw = new Tower(id, p.slot, p.tower || 'stone', id === localId);
            towers.set(id, tw);
            for (let i = 0; i < p.height; i++) tw.addBlock('stack', true);
        }
        tw.target = p.height;
        tw.anim = p.banim || 'stack';
    });
    // players who left the game: their tower sinks (it already burned if they were eliminated)
    for (const [id, tw] of towers) {
        if (seen.has(id)) continue;
        tw.sink();
        dying.push(tw);
        towers.delete(id);
    }
}
export function burnTower(id) {
    burned.add(id);
    const tw = towers.get(id);
    if (tw) { tw.burn(); dying.push(tw); towers.delete(id); sparkleColumn(new T.Vector3(tw.x, tw.top(), tw.z), 0xff6a14); }
}
export function updateTowers(dt, t) {
    for (const tw of towers.values()) tw.update(dt, t, tw.anim);
    for (let i = dying.length - 1; i >= 0; i--) if (!dying[i].update(dt, t)) { dying[i].dispose(); dying.splice(i, 1); }
}
export function clearTowers() {
    for (const tw of towers.values()) { tw.sink(); dying.push(tw); }
    towers.clear();
}
export const towerOf = (id) => towers.get(id) || null;

// ----- thumbnails: a little 4-block stack of each skin for the Select menu -----
let thumbR = null, thumbScene = null, thumbCam = null;
const thumbs = new Map();
export function towerThumb(id) {
    if (thumbs.has(id)) return thumbs.get(id);
    try {
        if (!thumbR) {
            const c = document.createElement('canvas'); c.width = c.height = 160;
            thumbR = new T.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
            thumbR.setPixelRatio(1);
            thumbR.toneMapping = T.NeutralToneMapping;
            thumbScene = new T.Scene();
            thumbScene.add(new T.HemisphereLight(0xffffff, 0x7aa0d0, 1.7));
            const d = new T.DirectionalLight(0xffffff, 2); d.position.set(3, 6, 5); thumbScene.add(d);
            thumbCam = new T.PerspectiveCamera(32, 1, 0.1, 80);
            thumbCam.position.set(7, 7.2, 9.8); thumbCam.lookAt(0, 2.1, 0);
        }
        const g = new T.Group();
        for (let i = 1; i <= 4; i++) {
            const b = new T.Mesh(BLOCK, tintedTowerMaterial(id, i));
            b.scale.setScalar(0.68);
            b.position.y = (i - 0.5) * H * 0.68;
            g.add(b);
        }
        thumbScene.add(g);
        thumbR.setClearColor(0x000000, 0);
        thumbR.render(thumbScene, thumbCam);
        const url = thumbR.domElement.toDataURL('image/png');
        thumbScene.remove(g);
        thumbs.set(id, url);
        return url;
    } catch (e) {
        thumbs.set(id, '');
        return '';
    }
}
// QA: what towers exist right now
export const towerDebug = () => ({
    live: [...towers.values()].map((t) => [t.id, t.slot, t.state, t.rendered, +t.mesh.position.y.toFixed(1)]),
    dying: dying.map((t) => [t.id, t.slot, t.state, t.rendered, +t.mesh.position.y.toFixed(1), +t.stateT.toFixed(2)]),
    inScene: scene.children.filter((o) => o.isInstancedMesh && o.geometry === BLOCK).length,
});

// Prewarm: one instanced block of every skin (the shader variants towers use in a game), so the
// first tower of a new skin never stalls a frame while its shader compiles
export function towerPrewarmGroup() {
    const g = new T.Group();
    TOWERS.forEach((s, i) => {
        const m = new T.InstancedMesh(BLOCK, towerMaterial(s.id), 1);
        m.setColorAt(0, new T.Color(towerColor(s.id, 1)));
        m.position.set((i % 7) * 7 - 21, -200, Math.floor(i / 7) * 7);
        m.castShadow = true; m.receiveShadow = true;
        g.add(m);
    });
    return g;
}
