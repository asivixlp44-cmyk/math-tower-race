// Pets: cute squishies that float after you, each built from a few shapes with a face.
// Slimes (glossy blobs), mochi buns, gummy bears, peaches, clouds, stars, keycap cats and bunnies,
// a frog, a space-bar dog and an RGB dragon. Merged into a couple of meshes each.
import { glossyMat, T, mergeChildren } from './engine.js';

const S = (r, w, h) => new T.SphereGeometry(r, w || 24, h || 16);
const matCache = new Map();
function petMat(def, kind) {
    const key = def.id + '|' + kind;
    if (matCache.has(key)) return matCache.get(key);
    let m;
    if (kind === 'body') {
        if (def.shiny) m = glossyMat({ color: def.color, metalness: 0.75, roughness: 0.18, clearcoat: 1, emissive: 0x5a3a00, emissiveIntensity: 0.35 });
        else if (def.rainbow) m = glossyMat({ color: 0xffffff, vertexColors: true, roughness: 0.15, clearcoat: 1, emissive: 0x332233, emissiveIntensity: 0.4 });
        else if (def.galaxy) m = glossyMat({ color: def.color, roughness: 0.2, clearcoat: 1, map: galaxyTex(), emissive: 0x2a1060, emissiveIntensity: 0.6 });
        else if (def.kind === 'slime' || def.clear) m = glossyMat({ color: def.color, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.86, envMapIntensity: 1.6 });
        else m = glossyMat({ color: def.color, roughness: 0.5, sheen: 1, sheenColor: new T.Color(0xffffff), sheenRoughness: 0.5 });
    } else if (kind === 'eye') m = new T.MeshStandardMaterial({ color: 0x1a1420, roughness: 0.15 });
    else if (kind === 'shine') m = new T.MeshBasicMaterial({ color: 0xffffff });
    else if (kind === 'blush') m = new T.MeshBasicMaterial({ color: 0xff7aa8, transparent: true, opacity: 0.75 });
    else if (kind === 'leaf') m = new T.MeshStandardMaterial({ color: 0x46c83a, roughness: 0.5 });
    else if (kind === 'gold') m = glossyMat({ color: 0xffc828, metalness: 0.85, roughness: 0.2, emissive: 0x6a4000, emissiveIntensity: 0.3 });
    else m = new T.MeshStandardMaterial({ color: 0x1a1420 });
    matCache.set(key, m);
    return m;
}
let galaxy = null;
function galaxyTex() {
    if (galaxy) return galaxy;
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 128, 128); g.addColorStop(0, '#3a1aa8'); g.addColorStop(0.5, '#a83aff'); g.addColorStop(1, '#2a3aff');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 70; i++) { x.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.6})`; x.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5); }
    galaxy = new T.CanvasTexture(c); galaxy.colorSpace = T.SRGBColorSpace;
    return galaxy;
}
function rainbowColors(geo) {
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new T.Color();
    geo.computeBoundingBox();
    const y0 = geo.boundingBox.min.y, y1 = geo.boundingBox.max.y;
    for (let i = 0; i < p.count; i++) {
        c.setHSL(((p.getY(i) - y0) / (y1 - y0 || 1)) * 0.85, 0.85, 0.66);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    return geo;
}
// Two shiny eyes, rosy cheeks and a little smile, sitting on the front of an ellipsoid body with
// radii (rx, ry, rz) centred at height cy (each feature is placed on the surface, facing out)
function face(g, def, rx, cy, spread, ry, rz) {
    spread = spread || 0.38; ry = ry || rx; rz = rz || rx;
    const r = Math.min(rx, ry);
    const on = (x, y, sink) => {
        const k = 1 - (x / rx) ** 2 - ((y - cy) / ry) ** 2;
        const z = rz * Math.sqrt(Math.max(0.05, k));
        const n = new T.Vector3(x / (rx * rx), (y - cy) / (ry * ry), z / (rz * rz)).normalize();
        return { p: new T.Vector3(x, y, z).addScaledVector(n, -(sink || 0)), n };
    };
    const orient = (m, n) => { m.lookAt(m.position.clone().add(n)); };
    for (const sx of [-1, 1]) {
        const ep = on(sx * rx * spread, cy + ry * 0.14, r * 0.05);
        const e = new T.Mesh(S(r * 0.15, 12, 10), petMat(def, 'eye'));
        e.scale.set(1, 1.25, 0.55); e.position.copy(ep.p); orient(e, ep.n);
        g.add(e);
        const sp = on(sx * rx * spread - r * 0.05, cy + ry * 0.24, -r * 0.03);
        const s = new T.Mesh(S(r * 0.05, 8, 6), petMat(def, 'shine'));
        s.position.copy(sp.p);
        g.add(s);
        const bp = on(sx * rx * (spread + 0.24), cy - ry * 0.06, -0.012);
        const bl = new T.Mesh(new T.CircleGeometry(r * 0.13, 14), petMat(def, 'blush'));
        bl.position.copy(bp.p); orient(bl, bp.n);
        g.add(bl);
    }
    const mp = on(0, cy - ry * 0.1, r * 0.01);
    const mouth = new T.Mesh(new T.TorusGeometry(r * 0.1, r * 0.028, 6, 12, Math.PI), petMat(def, 'eye'));
    mouth.position.copy(mp.p); orient(mouth, mp.n); mouth.rotateZ(Math.PI);
    g.add(mouth);
}

function body(def, geo) {
    if (def.rainbow) rainbowColors(geo);
    const m = new T.Mesh(geo, petMat(def, 'body'));
    m.castShadow = true;
    // merging drops vertex colours, so rainbow bodies stay separate meshes
    if (def.rainbow) m.userData.keep = true;
    return m;
}

const KINDS = {
    slime(g, def) {
        const b = body(def, S(1, 28, 18)); b.scale.set(1.1, 0.78, 1.1); b.position.y = 0.78; g.add(b);
        face(g, def, 1.1, 0.8, 0.36, 0.78, 1.1);
        if (def.crown) {
            const crown = new T.Mesh(new T.CylinderGeometry(0.5, 0.42, 0.45, 5, 1, true), petMat(def, 'gold'));
            crown.position.y = 1.72; g.add(crown);
        }
    },
    bun(g, def) {
        const b = body(def, S(1, 28, 18)); b.scale.set(1.15, 0.82, 1.1); b.position.y = 0.82; g.add(b);
        face(g, def, 1.15, 0.82, 0.34, 0.82, 1.1);
    },
    bear(g, def) {
        const b = body(def, S(0.85, 20, 14)); b.scale.set(1, 1.05, 0.9); b.position.y = 0.8; g.add(b);
        const h = body(def, S(0.72, 20, 14)); h.position.y = 1.85; g.add(h);
        for (const sx of [-1, 1]) {
            const e = body(def, S(0.26, 12, 10)); e.position.set(sx * 0.52, 2.45, 0); g.add(e);
            const a = body(def, S(0.26, 12, 10)); a.position.set(sx * 0.8, 1.05, 0.15); a.scale.set(1, 1.3, 1); g.add(a);
        }
        face(g, def, 0.72, 1.85, 0.36);
    },
    peach(g, def) {
        const b = body(def, S(1, 28, 18)); b.scale.set(1.05, 0.98, 1); b.position.y = 1; g.add(b);
        face(g, def, 1.05, 1, 0.36, 0.98, 1);
        const leaf = new T.Mesh(S(0.35, 10, 8), petMat(def, 'leaf')); leaf.scale.set(1, 0.3, 0.55); leaf.position.set(0.25, 2, 0); leaf.rotation.z = -0.5; g.add(leaf);
    },
    cloud(g, def) {
        for (const [x, y, r] of [[0, 0.9, 0.9], [-0.85, 0.65, 0.62], [0.85, 0.65, 0.62], [-0.4, 1.4, 0.55], [0.45, 1.35, 0.6]]) {
            const b = body(def, S(r, 18, 12)); b.position.set(x, y, 0); g.add(b);
        }
        face(g, def, 0.9, 0.9, 0.36);
    },
    star(g, def) {
        const sh = new T.Shape();
        for (let k = 0; k <= 10; k++) { const a = k * Math.PI / 5 + Math.PI / 2, r = k % 2 ? 0.55 : 1.25; if (k === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r); else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
        const geo = new T.ExtrudeGeometry(sh, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.2, bevelSegments: 4 });
        geo.translate(0, 0, -0.25);
        const b = body(def, geo); b.position.y = 1.2; g.add(b);
        face(g, def, 0.6, 1.15, 0.45, 0.6, 0.05);
        for (const o of g.children) if (o !== b) o.position.z += 0.5;
    },
    keycat(g, def) { keycap(g, def); for (const sx of [-1, 1]) { const ear = body(def, new T.ConeGeometry(0.32, 0.6, 4)); ear.position.set(sx * 0.6, 2.05, 0); ear.rotation.y = Math.PI / 4; g.add(ear); } },
    keybunny(g, def) { keycap(g, def); for (const sx of [-1, 1]) { const ear = body(def, new T.CapsuleGeometry(0.2, 0.8, 6, 10)); ear.position.set(sx * 0.38, 2.35, 0); ear.rotation.z = sx * -0.15; g.add(ear); } },
    frog(g, def) {
        const b = body(def, S(1, 24, 16)); b.scale.set(1.15, 0.8, 1); b.position.y = 0.8; g.add(b);
        for (const sx of [-1, 1]) { const e = body(def, S(0.38, 14, 10)); e.position.set(sx * 0.5, 1.55, 0.3); g.add(e); }
        face(g, def, 1.15, 0.8, 0.3, 0.8, 1);
    },
    dog(g, def) {
        const b = body(def, roundBox(2.2, 1.3, 1.4, 0.4)); b.position.y = 0.85; g.add(b);
        for (const sx of [-1, 1]) { const ear = body(def, S(0.35, 12, 10)); ear.scale.set(0.6, 1.3, 0.4); ear.position.set(sx * 0.95, 1.05, 0.2); ear.rotation.z = sx * 0.4; g.add(ear); }
        face(g, def, 1.1, 0.85, 0.32, 0.65, 0.05);
        for (const o of g.children.slice(3)) o.position.z += 0.68;
    },
    dragon(g, def) {
        const b = body(def, S(0.95, 24, 16)); b.scale.set(1, 0.95, 1.05); b.position.y = 1; g.add(b);
        for (const sx of [-1, 1]) {
            const wing = body(def, new T.ConeGeometry(0.6, 1.4, 3)); wing.position.set(sx * 1.05, 1.35, -0.3); wing.rotation.set(0.3, 0, sx * -1.1); g.add(wing);
            const horn = new T.Mesh(new T.ConeGeometry(0.14, 0.5, 8), petMat(def, 'gold')); horn.position.set(sx * 0.4, 1.95, 0); g.add(horn);
        }
        face(g, def, 0.95, 1.0, 0.36, 0.9, 1.0);
    },
};
function roundBox(w, h, d, r) {
    const sh = new T.Shape(), x = -w / 2, y = -h / 2;
    sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r); sh.lineTo(x + w, y + h - r);
    sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h); sh.lineTo(x + r, y + h); sh.quadraticCurveTo(x, y + h, x, y + h - r); sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
    const g = new T.ExtrudeGeometry(sh, { depth: d - 2 * r * 0.6, bevelEnabled: true, bevelThickness: r * 0.6, bevelSize: r * 0.5, bevelSegments: 3 });
    g.translate(0, 0, -(d - 2 * r * 0.6) / 2);
    return g;
}
function keycap(g, def) {
    const b = body(def, roundBox(1.9, 1.6, 1.9, 0.35)); b.position.y = 0.95; g.add(b);
    face(g, def, 0.95, 0.95, 0.4, 0.8, 0.05);
    for (const o of g.children) if (o !== b) o.position.z += 0.95;
}

// A pet about 2 studs tall, standing on its own origin, facing +z
export function petModel(def) {
    const g = new T.Group();
    (KINDS[def.kind] || KINDS.slime)(g, def);
    mergeChildren(g);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
}

// ----- following: up to four pets float in a little arc behind their owner -----
const SLOTS = [[-2.6, -2.2], [2.6, -2.2], [0, -3.6], [-4.2, -0.4]];
export class PetTrain {
    constructor(scene) { this.scene = scene; this.ids = ''; this.list = []; }
    set(ids) {
        const key = (ids || []).join(',');
        if (key === this.ids) return;
        this.ids = key;
        for (const p of this.list) this.scene.remove(p.g);
        this.list = (ids || []).slice(0, 4).map((def, i) => {
            const g = petModel(def);
            g.scale.setScalar(0.85);
            this.scene.add(g);
            return { g, i, def, pos: null, phase: Math.random() * 6 };
        });
    }
    update(owner, yaw, dt, t, visible) {
        const k = 1 - Math.exp(-dt * 6);
        for (const p of this.list) {
            const [sx, sz] = SLOTS[p.i];
            const c = Math.cos(yaw), s = Math.sin(yaw);
            const tx = owner.x + sx * c + sz * s, tz = owner.z - sx * s + sz * c;
            const ty = owner.y + 1.2 + Math.sin(t * 3 + p.phase) * 0.35;
            if (!p.pos) p.pos = new T.Vector3(tx, ty, tz);
            const dx = tx - p.pos.x, dz = tz - p.pos.z;
            if (dx * dx + dz * dz > 900) p.pos.set(tx, ty, tz);
            p.pos.x += dx * k; p.pos.y += (ty - p.pos.y) * k; p.pos.z += dz * k;
            p.g.position.copy(p.pos);
            // face the way it's going, or the owner's way when settled
            const want = dx * dx + dz * dz > 0.3 ? Math.atan2(dx, dz) : yaw;
            let d = want - p.g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
            p.g.rotation.y += d * Math.min(1, dt * 6);
            // squish bounce
            const sq = 1 + Math.sin(t * 6 + p.phase) * 0.05;
            p.g.scale.set(0.85 / Math.sqrt(sq), 0.85 * sq, 0.85 / Math.sqrt(sq));
            p.g.visible = visible;
        }
    }
    dispose() { for (const p of this.list) this.scene.remove(p.g); this.list = []; }
}

// ----- thumbnails: each pet rendered once to a little picture for the menus -----
let thumbR = null, thumbScene = null, thumbCam = null;
const thumbs = new Map();
export function petThumb(def) {
    if (thumbs.has(def.id)) return thumbs.get(def.id);
    try {
        if (!thumbR) {
            const c = document.createElement('canvas'); c.width = c.height = 192;
            thumbR = new T.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
            thumbR.setPixelRatio(1);
            thumbR.toneMapping = T.NeutralToneMapping;
            thumbScene = new T.Scene();
            thumbScene.add(new T.HemisphereLight(0xffffff, 0xb08ae0, 1.6));
            const d = new T.DirectionalLight(0xffffff, 1.8); d.position.set(2, 4, 5); thumbScene.add(d);
            thumbCam = new T.PerspectiveCamera(30, 1, 0.1, 50);
            thumbCam.position.set(0, 2.0, 5.6); thumbCam.lookAt(0, 1.15, 0);
        }
        const g = petModel(def);
        g.rotation.y = -0.35;
        thumbScene.add(g);
        thumbR.setClearColor(0x000000, 0);
        thumbR.render(thumbScene, thumbCam);
        const url = thumbR.domElement.toDataURL('image/png');
        thumbScene.remove(g);
        thumbs.set(def.id, url);
        return url;
    } catch (e) {
        thumbs.set(def.id, '');
        return '';
    }
}

// Renders thumbnails one per frame so opening a menu never stalls the game; cb(url) when ready
const queue = [];
let pumping = false;
export function petThumbLater(def, cb) {
    if (thumbs.has(def.id)) { cb(thumbs.get(def.id)); return; }
    queue.push({ def, cb });
    if (pumping) return;
    pumping = true;
    const pump = () => {
        const job = queue.shift();
        if (!job) { pumping = false; return; }
        job.cb(petThumb(job.def));
        requestAnimationFrame(pump);
    };
    requestAnimationFrame(pump);
}
export const thumbReady = (id) => thumbs.has(id);
