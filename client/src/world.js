// The world: a sunny grass island on a turquoise sea. In the middle the lava pit (the arena), ringed
// by a stone walkway, with the big question screen and the logo on its north side and the four vote
// pads behind them. Around it the lobby, every feature in its own spot and joined up by paths: the
// How to Play arch over the avenue, the Top Wins / Top Answers boards with podium statues, the spawn
// plaza, the cross path with the pet eggs, pass pads, Watch Game and the gem chest, the VIP lounge,
// the tower-skin row (east) and the victory-dance row (west), and gems on the lawns.
// Everything is built from code (textures are drawn on canvases).
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
    T, V3, scene, mat, texFrom, solids, prompts, tickers, solidBox, batchBox, batchGeo, flushBatches, billboard, buildRig, dancePoseRig, mergeChildren, glossyMat,
} from './engine.js';
import { S, actions } from './state.js';
import { BLOCK, tintedTowerMaterial } from './towers.js';
import {
    CFG, TOWERS, DANCES, EGGS, KITS, SKINS, PASSES, fmt, fmtComma, clock,
} from '../../shared/config.js';
import {
    ISLAND, BEACH, PIT, FLOOR_Y, SPAWN, SCREEN, VOTE, VOTE_PADS, BOARDS, PODIUMS, HOW_TO, PADS, CHEST, VIP_LOUNGE,
    EGG_STANDS, TOWER_SHOP, DANCE_SHOP, GEM_SPOTS, WALK, PATHS, PLAZA, TREES, BUSHES, FLOWER_BEDS,
} from '../../shared/arena.js';

export const SPAWN_POS = new V3(SPAWN.x, SPAWN.y, SPAWN.z);
export const SPAWN_YAW = SPAWN.yaw;
const ROOT = new T.Group();
scene.add(ROOT);
const INK = '#1a2a40';
const PILL = 'rgba(26,30,72,0.86)';     // background of the floating labels

// ----- canvas helpers -----
function canvasTex(w, h, draw, repeat) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return texFrom(c, repeat);
}
function mulberry(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const shade = (hex, k) => {
    const c = new T.Color(hex);
    if (k > 0) c.lerp(new T.Color(0xffffff), k); else c.multiplyScalar(1 + k);
    return '#' + c.getHexString();
};
// A raised, bevelled tile: light top-left edges, dark bottom-right edges, flat face
function bevelRect(x, X, Y, W, H, base, bev) {
    x.fillStyle = shade(base, -0.3); x.fillRect(X, Y, W, H);
    x.fillStyle = shade(base, 0.3);
    x.beginPath(); x.moveTo(X, Y); x.lineTo(X + W, Y); x.lineTo(X + W - bev, Y + bev); x.lineTo(X + bev, Y + H - bev); x.lineTo(X, Y + H); x.closePath(); x.fill();
    x.fillStyle = shade(base, -0.15);
    x.beginPath(); x.moveTo(X + W, Y); x.lineTo(X + W, Y + H); x.lineTo(X, Y + H); x.lineTo(X + bev, Y + H - bev); x.lineTo(X + W - bev, Y + bev); x.closePath(); x.fill();
    x.fillStyle = base; x.fillRect(X + bev, Y + bev, W - bev * 2, H - bev * 2);
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(X + bev + 4, Y + bev + 4, (W - bev * 2) * 0.45, 3);
}
function speckle(x, w, h, n, colors, size, rng) {
    for (let i = 0; i < n; i++) {
        x.fillStyle = colors[i % colors.length];
        const s = (size || 2) * (0.5 + rng());
        x.fillRect(rng() * w, rng() * h, s, s);
    }
}

// ----- surface textures -----
// The lobby grass: two-tone checker squares (12 studs) with short grass blades, like the reference
const grassTex = canvasTex(512, 512, (x) => {
    const rng = mulberry(5);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        const X = i * 256, Y = j * 256;
        x.fillStyle = (i + j) % 2 ? '#5cc244' : '#6ad04d'; x.fillRect(X, Y, 256, 256);
        const g = x.createRadialGradient(X + 128, Y + 128, 30, X + 128, Y + 128, 200);
        g.addColorStop(0, 'rgba(255,255,210,0.07)'); g.addColorStop(1, 'rgba(0,40,0,0.05)');
        x.fillStyle = g; x.fillRect(X, Y, 256, 256);
    }
    x.lineCap = 'round';
    for (let i = 0; i < 3200; i++) {
        const px = rng() * 512, py = rng() * 512, l = 4 + rng() * 7, a = -Math.PI / 2 + (rng() - 0.5) * 1.1;
        x.strokeStyle = rng() < 0.5 ? 'rgba(235,255,190,0.17)' : 'rgba(20,90,20,0.17)';
        x.lineWidth = 1.4 + rng() * 1.2;
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
    }
}, true);
const dirtTex = canvasTex(128, 128, (x) => {
    x.fillStyle = '#9a6a3e'; x.fillRect(0, 0, 128, 128);
    speckle(x, 128, 128, 500, ['#8a5c34', '#ab7a4a', '#7a5030'], 3, mulberry(2));
}, true);
const sandTex = canvasTex(256, 256, (x) => {
    x.fillStyle = '#f4dc9a'; x.fillRect(0, 0, 256, 256);
    speckle(x, 256, 256, 1600, ['#ecd08a', '#fae8b4', '#e2c27a'], 2, mulberry(3));
}, true);
// Pit walls: cool grey stone bricks (4 x 2 studs), so the warm lava stands out against them
const stoneTex = canvasTex(256, 256, (x) => {
    const rng = mulberry(11);
    x.fillStyle = '#7d8798'; x.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 4; row++) for (let col = -1; col < 2; col++) {
        bevelRect(x, col * 128 + (row % 2) * 64 + 3, row * 64 + 3, 122, 58, shade('#b8c2d0', (rng() - 0.5) * 0.14), 7);
    }
}, true);
// Paths, the walkway and the plaza: warm cream pavers (2 x 2 studs)
const paverTex = canvasTex(256, 256, (x) => {
    const rng = mulberry(13);
    x.fillStyle = '#bba78a'; x.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) bevelRect(x, i * 128 + 3, j * 128 + 3, 122, 122, shade('#f1e6d0', (rng() - 0.5) * 0.07), 9);
}, true);
// The pit's rim: big light stone slabs
const copeTex = canvasTex(128, 128, (x) => {
    x.fillStyle = '#9aa3b0'; x.fillRect(0, 0, 128, 128);
    bevelRect(x, 2, 2, 124, 124, '#e4e9f0', 10);
}, true);
const woodTex = canvasTex(128, 128, (x) => {
    const rng = mulberry(17);
    x.fillStyle = '#d98a46'; x.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 26; i++) { x.strokeStyle = i % 2 ? 'rgba(120,60,20,0.22)' : 'rgba(255,220,170,0.15)'; x.lineWidth = 1 + rng() * 2; x.beginPath(); const y = rng() * 128; x.moveTo(0, y); x.bezierCurveTo(40, y + 6, 80, y - 6, 128, y); x.stroke(); }
}, true);

// matte surfaces: Lambert shading (much cheaper than PBR, and these cover most of the screen)
const grassMat = new T.MeshLambertMaterial({ map: grassTex });
const dirtMat = new T.MeshLambertMaterial({ map: dirtTex });
const sandMat = new T.MeshLambertMaterial({ map: sandTex });
const stoneMat = new T.MeshLambertMaterial({ map: stoneTex });
const paverMat = new T.MeshLambertMaterial({ map: paverTex });
const copeMat = new T.MeshLambertMaterial({ map: copeTex });
const woodMat = new T.MeshLambertMaterial({ map: woodTex });
const woodDark = mat(0xa8622c, { rough: 0.8 });
const white = mat(0xf6f8fc, { rough: 0.45 });

const round = (sx, sy, sz, r) => new RoundedBoxGeometry(sx, sy, sz, 2, Math.min(r ?? 0.3, sx / 2, sy / 2, sz / 2));
function mesh(geo, material, x, y, z, parent, cast) {
    const m = new T.Mesh(geo, material);
    m.position.set(x, y, z);
    m.castShadow = cast !== false; m.receiveShadow = true;
    (parent || ROOT).add(m);
    return m;
}
// A flat sign with a canvas face, looking towards `look`
function signPlane(cv, w, h, pos, look, parent) {
    const tex = texFrom(cv);
    const m = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, toneMapped: false, transparent: true }));
    m.position.copy(pos);
    m.lookAt(look);
    (parent || ROOT).add(m);
    return { mesh: m, tex, cv };
}
function roundRect(x, X, Y, W, H, r) {
    x.beginPath();
    x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r);
    x.closePath();
}
// Outlined cartoon text
function ink(x, text, X, Y, px, fill, stroke, weight, align) {
    x.font = `${weight || 700} ${px}px Fredoka, "Arial Rounded MT Bold", sans-serif`;
    x.textAlign = align || 'center'; x.textBaseline = 'middle';
    x.lineJoin = 'round'; x.lineWidth = Math.max(4, px * 0.2); x.strokeStyle = stroke || INK;
    x.strokeText(text, X, Y);
    x.fillStyle = fill || '#fff';
    x.fillText(text, X, Y);
}
function fitText(x, text, maxW, px, weight) {
    for (; px > 10; px -= 2) {
        x.font = `${weight || 700} ${px}px Fredoka, sans-serif`;
        if (x.measureText(text).width <= maxW) break;
    }
    return px;
}
// A floating name label on a dark pill (readable from far away)
const tag = (lines, w, pos, parent) => billboard(lines, w, 512, pos, parent, PILL);
// A wooden signboard on two posts, facing `look`
function woodSign(text, w, h, pos, look) {
    const cv = document.createElement('canvas'); cv.width = 768; cv.height = Math.round(768 * h / w);
    const x = cv.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, cv.height); g.addColorStop(0, '#f0a050'); g.addColorStop(1, '#c86a2a');
    x.fillStyle = g; roundRect(x, 0, 0, cv.width, cv.height, 30); x.fill();
    x.lineWidth = 10; x.strokeStyle = '#8a4a1c'; roundRect(x, 5, 5, cv.width - 10, cv.height - 10, 26); x.stroke();
    ink(x, text, cv.width / 2, cv.height / 2 + 4, fitText(x, text, cv.width - 70, cv.height * 0.58, 700), '#fff', '#5a2a0c', 700);
    const grp = new T.Group(); grp.position.copy(pos); grp.lookAt(look.x, pos.y, look.z); ROOT.add(grp);
    const back = new T.Mesh(round(w + 0.6, h + 0.6, 0.6, 0.25), woodDark); back.position.z = -0.35; back.castShadow = true; grp.add(back);
    const face = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: texFrom(cv), toneMapped: false, transparent: true }));
    grp.add(face);
    for (const sx of [-1, 1]) {
        const post = new T.Mesh(new T.BoxGeometry(0.9, pos.y, 0.9), woodDark);
        post.position.set(sx * (w / 2 - 1.2), -pos.y / 2, -0.4); post.castShadow = true; grp.add(post);
    }
    return grp;
}

// =====================================================================================
// Ground, sea, beach, the pit, walkway and paths
// =====================================================================================
let water = null;
function flat(material, x0, x1, z0, z1, top, tile) {
    batchBox(material, (x0 + x1) / 2, top - 0.06, (z0 + z1) / 2, x1 - x0, 0.12, z1 - z0, { tile, skip: [3] });
}
function buildGround() {
    // the island: a grass layer on dirt, in four strips around the pit hole
    const strips = [
        [0, -(ISLAND + PIT.z) / 2, ISLAND * 2, ISLAND - PIT.z],
        [0, (ISLAND + PIT.z) / 2, ISLAND * 2, ISLAND - PIT.z],
        [-(ISLAND + PIT.x) / 2, 0, ISLAND - PIT.x, PIT.z * 2],
        [(ISLAND + PIT.x) / 2, 0, ISLAND - PIT.x, PIT.z * 2],
    ];
    for (const [x, z, w, d] of strips) {
        batchBox(grassMat, x, -0.4, z, w, 0.8, d, { tile: 24 });
        batchBox(dirtMat, x, -2.9, z, w, 4.2, d, { tile: 8, skip: [2] });
        solidBox(x, -2.5, z, w, 5, d, { mat: 'grass' });
    }
    // the pit: stone floor and stone-brick walls
    batchBox(stoneMat, 0, FLOOR_Y - 0.5, 0, PIT.x * 2, 1, PIT.z * 2, { tile: 8 });
    solidBox(0, FLOOR_Y - 0.5, 0, PIT.x * 2, 1, PIT.z * 2, { mat: 'grass' });
    const h = PIT.depth, y = FLOOR_Y + h / 2;
    // (the inner faces sit a hair inside the pit so they never fight with the grass strips' sides)
    batchBox(stoneMat, 0, y, -PIT.z - 0.97, PIT.x * 2 + 4, h, 2, { tile: 8 });
    batchBox(stoneMat, 0, y, PIT.z + 0.97, PIT.x * 2 + 4, h, 2, { tile: 8 });
    batchBox(stoneMat, -PIT.x - 0.97, y, 0, 2, h, PIT.z * 2 - 0.1, { tile: 8 });
    batchBox(stoneMat, PIT.x + 0.97, y, 0, 2, h, PIT.z * 2 - 0.1, { tile: 8 });
    // a raised stone rim around the pit, the fence stands on it
    const cx = PIT.x + 1.5, cz = PIT.z + 1.5, ch = 0.6;
    batchBox(copeMat, 0, ch / 2, -cz, cx * 2 + 3, ch, 3, { tile: 3, cast: true });
    batchBox(copeMat, 0, ch / 2, cz, cx * 2 + 3, ch, 3, { tile: 3, cast: true });
    batchBox(copeMat, -cx, ch / 2, 0, 3, ch, PIT.z * 2, { tile: 3, cast: true });
    batchBox(copeMat, cx, ch / 2, 0, 3, ch, PIT.z * 2, { tile: 3, cast: true });
    for (const s of [-1, 1]) { solidBox(0, ch / 2, s * cz, cx * 2 + 3, ch, 3, { mat: 'stone' }); solidBox(s * cx, ch / 2, 0, 3, ch, PIT.z * 2, { mat: 'stone' }); }
    // lobby players can't jump into the arena
    const fx = PIT.x + 2.4, fz = PIT.z + 2.4;
    solidBox(0, 20, -fz, fx * 2, 40, 0.6, { mat: 'barrier' });
    solidBox(0, 20, fz, fx * 2, 40, 0.6, { mat: 'barrier' });
    solidBox(-fx, 20, 0, 0.6, 40, fz * 2, { mat: 'barrier' });
    solidBox(fx, 20, 0, 0.6, 40, fz * 2, { mat: 'barrier' });
    fence(-fx, -fz, fx, -fz, ch); fence(fx, -fz, fx, fz, ch); fence(fx, fz, -fx, fz, ch); fence(-fx, fz, -fx, -fz, ch);

    // the walkway around the pit, the paths and the spawn plaza (pavers, just above the grass)
    const [wi, wo] = WALK.x, [zi, zo] = WALK.z;
    flat(paverMat, -wo, wo, -zo, -zi, 0.1, 4); flat(paverMat, -wo, wo, zi, zo, 0.1, 4);
    flat(paverMat, -wo, -wi, -zi, zi, 0.1, 4); flat(paverMat, wi, wo, -zi, zi, 0.1, 4);
    for (const p of PATHS) flat(paverMat, p.x0, p.x1, p.z0, p.z1, 0.1, 4);
    const plaza = new T.CircleGeometry(PLAZA.r, 56);
    plaza.rotateX(-Math.PI / 2); plaza.translate(PLAZA.x, 0.11, PLAZA.z);
    { const pa = plaza.attributes.position, uv = plaza.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, pa.getX(i) / 4, -pa.getZ(i) / 4); }
    batchGeo(paverMat, plaza);
    // a stone kerb around the plaza
    const kerb = new T.TorusGeometry(PLAZA.r, 0.35, 6, 64);
    kerb.rotateX(Math.PI / 2); kerb.scale(1, 0.5, 1); kerb.translate(PLAZA.x, 0.12, PLAZA.z);
    batchGeo(copeMat, kerb);

    // the beach ring, a little below the grass
    const bw = BEACH - ISLAND;
    for (const [x, z, w, d] of [[0, -(ISLAND + bw / 2), BEACH * 2, bw], [0, ISLAND + bw / 2, BEACH * 2, bw], [-(ISLAND + bw / 2), 0, bw, ISLAND * 2], [ISLAND + bw / 2, 0, bw, ISLAND * 2]]) {
        batchBox(sandMat, x, -5, z, w, 4, d, { tile: 16 });
        solidBox(x, -5, z, w, 4, d, { mat: 'sand' });
    }
    // a sandy shelf just under the water along the shore
    const sw = 16;
    for (const [x, z, w, d] of [[0, -(BEACH + sw / 2), (BEACH + sw) * 2, sw], [0, BEACH + sw / 2, (BEACH + sw) * 2, sw], [-(BEACH + sw / 2), 0, sw, BEACH * 2], [BEACH + sw / 2, 0, sw, BEACH * 2]]) {
        batchBox(sandMat, x, -8.6, z, w, 4, d, { tile: 16 });
    }
    // keep everybody on the island
    const e = BEACH + 1;
    solidBox(0, 20, -e, e * 2, 60, 1, { mat: 'barrier' }); solidBox(0, 20, e, e * 2, 60, 1, { mat: 'barrier' });
    solidBox(-e, 20, 0, 1, 60, e * 2, { mat: 'barrier' }); solidBox(e, 20, 0, 1, 60, e * 2, { mat: 'barrier' });
    // island fence
    const f = ISLAND - 1.5;
    fence(-f, -f, f, -f); fence(f, -f, f, f); fence(f, f, 10, f); fence(-10, f, -f, f); fence(-f, f, -f, -f);
    // gate posts at the south opening, to the beach
    for (const gx of [-10, 10]) { batchBox(woodDark, gx, 3, f, 1.8, 6, 1.8, { cast: true }); solidBox(gx, 3, f, 1.8, 6, 1.8); }

    // the sea: glossy turquoise with drifting ripples
    const rr = mulberry(19);
    const ripple = canvasTex(256, 256, (x) => {
        x.fillStyle = '#8080ff'; x.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 300; i++) {
            const r = 4 + rr() * 14, px = rr() * 256, py = rr() * 256;
            const g = x.createRadialGradient(px, py, 0, px, py, r);
            const k = rr() < 0.5 ? 'rgba(150,150,255,0.6)' : 'rgba(110,110,255,0.6)';
            g.addColorStop(0, k); g.addColorStop(1, 'rgba(128,128,255,0)');
            x.fillStyle = g; x.fillRect(px - r, py - r, r * 2, r * 2);
        }
    }, true);
    ripple.colorSpace = T.NoColorSpace;
    ripple.repeat.set(120, 120);
    // the sea is a big square with a hole where the island is (so it never shows inside the pit)
    const sea = new T.Shape([new T.Vector2(-2500, -2500), new T.Vector2(2500, -2500), new T.Vector2(2500, 2500), new T.Vector2(-2500, 2500)]);
    const h0 = BEACH - 2;
    sea.holes.push(new T.Path([new T.Vector2(-h0, -h0), new T.Vector2(-h0, h0), new T.Vector2(h0, h0), new T.Vector2(h0, -h0)]));
    const seaGeo = new T.ShapeGeometry(sea);
    { const uv = seaGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 5000, uv.getY(i) / 5000); }
    water = new T.Mesh(seaGeo, new T.MeshStandardMaterial({ color: 0x24c4e4, roughness: 0.12, metalness: 0.15, normalMap: ripple, normalScale: new T.Vector2(0.45, 0.45) }));
    water.rotation.x = -Math.PI / 2; water.position.y = -6.4;
    ROOT.add(water);
    // far sandbars with palm trees
    const rng = mulberry(7);
    for (let i = 0; i < 9; i++) {
        const a = rng() * Math.PI * 2, d = 330 + rng() * 360, r = 14 + rng() * 26;
        const bar = new T.Mesh(new T.SphereGeometry(r, 20, 10), sandMat);
        bar.scale.set(1, 0.18, 0.8); bar.position.set(Math.cos(a) * d, -6.6, Math.sin(a) * d);
        ROOT.add(bar);
        if (r > 22) palm(bar.position.x, -3, bar.position.z, 1.1, rng);
    }
}

function fence(x0, z0, x1, z1, base) {
    const b = base || 0;
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.round(len / 8));
    for (let i = 0; i <= n; i++) {
        const x = x0 + dx * (i / n), z = z0 + dz * (i / n);
        batchBox(woodDark, x, b + 2.2, z, 1.2, 4.4, 1.2, { cast: true });
        batchBox(woodDark, x, b + 4.5, z, 1.5, 0.3, 1.5);
    }
    const ang = Math.atan2(dx, dz);
    for (const h of [1.6, 3.4]) {
        const g = new T.BoxGeometry(0.5, 0.7, len);
        g.rotateY(ang); g.translate((x0 + x1) / 2, b + h, (z0 + z1) / 2);
        batchGeo(woodMat, g, true);
    }
    // collision: an axis-aligned thin wall (fences only run along x or z)
    if (Math.abs(dx) > Math.abs(dz)) solidBox((x0 + x1) / 2, b + 2.2, z0, Math.abs(dx), 4.4, 0.8, { mat: 'wood' });
    else solidBox(x0, b + 2.2, (z0 + z1) / 2, 0.8, 4.4, Math.abs(dz), { mat: 'wood' });
}

// ----- trees, bushes and flowers (merged into a few meshes) -----
const decor = new T.Group();
const leafA = mat(0x5ec448, { rough: 0.75 }), leafB = mat(0x46a83c, { rough: 0.75 }), trunk = mat(0x8a5a32, { rough: 0.9 });
function tree(x, y, z, s) {
    const g = new T.Group();
    const tr = new T.Mesh(new T.CylinderGeometry(0.7 * s, 0.95 * s, 8 * s, 8), trunk); tr.position.y = 4 * s; g.add(tr);
    for (const [px, py, pz, r, m] of [[0, 9.5, 0, 4.2, leafA], [2.4, 8.2, 1, 3.2, leafB], [-2.2, 8.6, -1.2, 3.3, leafB], [0.4, 12, -0.4, 2.8, leafA]]) {
        const l = new T.Mesh(new T.IcosahedronGeometry(r * s, 1), m); l.position.set(px * s, py * s, pz * s); l.castShadow = true; g.add(l);
    }
    tr.castShadow = true;
    g.position.set(x, y, z);
    decor.add(g);
    solidBox(x, y + 4 * s, z, 1.6 * s, 8 * s, 1.6 * s, { mat: 'wood' });
}
function palm(x, y, z, s) {
    const g = new T.Group();
    for (let i = 0; i < 6; i++) {
        const seg = new T.Mesh(new T.CylinderGeometry(0.55 * s, 0.7 * s, 1.9 * s, 7), trunk);
        seg.position.set(i * 0.25 * s, (0.95 + i * 1.8) * s, 0); seg.rotation.z = -0.05 * i; g.add(seg);
    }
    for (let i = 0; i < 6; i++) {
        const leaf = new T.Mesh(new T.BoxGeometry(6.5 * s, 0.25 * s, 1.6 * s), i % 2 ? leafA : leafB);
        leaf.geometry.translate(3.2 * s, 0, 0);
        leaf.position.set(1.5 * s, 11 * s, 0); leaf.rotation.set(0, (i / 6) * Math.PI * 2, -0.35);
        g.add(leaf);
    }
    g.position.set(x, y, z);
    decor.add(g);
}
function bush(x, z, r, m) {
    for (const [ox, oz, k] of [[0, 0, 1], [r * 0.7, r * 0.3, 0.72], [-r * 0.6, r * 0.35, 0.68]]) {
        const b = new T.Mesh(new T.IcosahedronGeometry(r * k, 1), m);
        b.position.set(x + ox, r * k * 0.6, z + oz); b.scale.y = 0.8; b.castShadow = true;
        decor.add(b);
    }
    solidBox(x, 1, z, r * 1.6, 2, r * 1.6, { mat: 'grass' });
}
const FLOWERS = [0xff6a8a, 0xffd23c, 0xffffff, 0xb07aff, 0xff9a3c];
function flowers(x, z, r0, r1, n, rng) {
    for (let i = 0; i < n; i++) {
        const a = rng() * Math.PI * 2, d = r0 + rng() * (r1 - r0);
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        const stem = new T.Mesh(new T.CylinderGeometry(0.08, 0.08, 0.8, 4), leafB); stem.position.set(px, 0.4, pz); decor.add(stem);
        const head = new T.Mesh(new T.IcosahedronGeometry(0.42, 0), mat(FLOWERS[i % FLOWERS.length], { rough: 0.6 }));
        head.position.set(px, 0.9, pz); head.scale.y = 0.6; decor.add(head);
    }
}
function buildDecor() {
    const rng = mulberry(42);
    // palms all around the beach
    for (let i = 0; i < 44; i++) {
        const side = i % 4, along = (rng() * 2 - 1) * (ISLAND - 6), out = ISLAND + 6 + rng() * (BEACH - ISLAND - 12);
        const [x, z] = side === 0 ? [along, out] : side === 1 ? [along, -out] : side === 2 ? [out, along] : [-out, along];
        if (side === 0 && Math.abs(along) < 18) continue;   // keep the south gate clear
        palm(x, -3, z, 0.9 + rng() * 0.4);
    }
    for (const t of TREES) { tree(t.x, 0, t.z, t.s); flowers(t.x, t.z, 3.2, 5.5, 7, rng); }
    BUSHES.forEach((b, i) => bush(b.x, b.z, 2 + (i % 3) * 0.35, i % 2 ? leafA : leafB));
    // flower beds: a little soil circle full of flowers
    const soil = mat(0x8a5a34, { rough: 1 });
    for (const b of FLOWER_BEDS) {
        const bed = new T.Mesh(new T.CylinderGeometry(3.4, 3.6, 0.5, 20), soil); bed.position.set(b.x, 0.2, b.z); decor.add(bed);
        const rim = new T.Mesh(new T.TorusGeometry(3.6, 0.35, 6, 24), white); rim.rotation.x = Math.PI / 2; rim.position.set(b.x, 0.4, b.z); decor.add(rim);
        flowers(b.x, b.z, 0, 2.8, 12, rng);
    }
    ROOT.add(decor);
    mergeChildren(decor);
}

// =====================================================================================
// The big question screen and the logo (north side of the pit)
// =====================================================================================
const screen = { cv: null, tex: null, key: '' };
function buildScreen() {
    const z = SCREEN.z, y = SCREEN.y, w = SCREEN.w, h = SCREEN.h;
    mesh(round(w + 3, h + 3, 1.6, 0.8), white, 0, y, z - 0.6);
    const legH = y - h / 2 + 0.5;
    for (const x of [-w / 2 + 6, w / 2 - 6]) {
        mesh(round(3, legH, 3, 0.4), white, x, legH / 2, z - 0.6);
        solidBox(x, legH / 2, z - 0.6, 3, legH, 3);
    }
    solidBox(0, y, z - 0.6, w + 3, h + 3, 1.6);
    screen.cv = document.createElement('canvas'); screen.cv.width = 1024; screen.cv.height = 512;
    screen.tex = texFrom(screen.cv);
    const face = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: screen.tex, toneMapped: false }));
    face.position.set(0, y, z + 0.22);
    ROOT.add(face);
    setScreen({ header: 'MATH TOWER RACE', big: 'Waiting for players...', status: '' });
    // the back faces the vote pads
    const back = document.createElement('canvas'); back.width = 1024; back.height = 512;
    const x = back.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, 512); g.addColorStop(0, '#ff7a28'); g.addColorStop(1, '#ff465a');
    x.fillStyle = g; x.fillRect(0, 0, 1024, 512);
    ink(x, 'VOTE FOR A', 512, 150, 96, '#fff', INK, 700);
    ink(x, 'DIFFICULTY!', 512, 260, 110, '#ffe36a', INK, 700);
    ink(x, 'Stand on a pad to vote ⬆', 512, 400, 54, '#fff', INK, 600);
    const bm = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: texFrom(back), toneMapped: false }));
    bm.position.set(0, y, z - 1.42); bm.rotation.y = Math.PI;
    ROOT.add(bm);
    // the floating logo above it, readable from both sides
    const lc = logoCanvas('MATH TOWER RACE');
    const logo = new T.Group();
    const logoMat = new T.MeshBasicMaterial({ map: texFrom(lc), transparent: true, toneMapped: false, depthWrite: false });
    for (const ry of [0, Math.PI]) { const p = new T.Mesh(new T.PlaneGeometry(74, 74 * lc.height / lc.width), logoMat); p.rotation.y = ry; logo.add(p); }
    // it sits on the screen's top edge like a title, bobbing a little
    const ly = y + h / 2 + 8;
    logo.position.set(0, ly, z - 0.6);
    ROOT.add(logo);
    tickers.push((dt, t) => { logo.position.y = ly + Math.sin(t * 1.2) * 0.35; logo.rotation.z = Math.sin(t * 0.7) * 0.01; });
}
// The game logo: chunky cartoon letters with a dark 3D extrusion, a thick outline, a yellow-to-
// orange fill and a glossy highlight kept inside the letters. Sized to always fit the canvas.
function logoCanvas(text) {
    const W = 2048, H = 480;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    let px = 240;
    const font = (p) => `700 ${p}px Fredoka, "Arial Rounded MT Bold", sans-serif`;
    x.font = font(px);
    while (x.measureText(text).width > W - 200 && px > 40) { px -= 4; x.font = font(px); }
    const cx = W / 2, cy = H / 2 - px * 0.06, ow = px * 0.19, depth = px * 0.09;
    for (const g of [x]) { g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineCap = 'round'; }
    // the extrusion: dark copies stepping down
    x.fillStyle = '#3a0c22'; x.strokeStyle = '#3a0c22'; x.lineWidth = ow;
    for (let d = depth; d > 0; d -= 3) { x.strokeText(text, cx, cy + d); x.fillText(text, cx, cy + d); }
    // the outline
    x.strokeStyle = '#4a1430'; x.lineWidth = ow; x.strokeText(text, cx, cy);
    // the fill and the gloss, painted on their own layer so the gloss only lands inside the letters
    const f = document.createElement('canvas'); f.width = W; f.height = H;
    const fx = f.getContext('2d');
    fx.font = font(px); fx.textAlign = 'center'; fx.textBaseline = 'middle';
    const top = cy - px * 0.42, bot = cy + px * 0.42;
    const g = fx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, '#fff7a8'); g.addColorStop(0.45, '#ffc93c'); g.addColorStop(1, '#ff7a1e');
    fx.fillStyle = g; fx.fillText(text, cx, cy);
    fx.globalCompositeOperation = 'source-atop';
    const gl = fx.createLinearGradient(0, top, 0, cy);
    gl.addColorStop(0, 'rgba(255,255,255,0.6)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    fx.fillStyle = gl; fx.fillRect(0, top - 10, W, cy - top + 10);
    x.drawImage(f, 0, 0);
    return c;
}
// { header, timer, big, status, small, visual } -> redraws the screen when anything changed
export function setScreen(o) {
    const key = JSON.stringify(o);
    if (key === screen.key || !screen.cv) return;
    screen.key = key;
    const x = screen.cv.getContext('2d'), W = 1024, H = 512;
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#4a3c9a'); g.addColorStop(1, '#241c5a');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#8a7aea'; x.lineWidth = 10; roundRect(x, 10, 10, W - 20, H - 20, 30); x.stroke();
    ink(x, o.header || '', W / 2, 62, 50, '#ffd84a', INK, 700);
    if (o.timer) ink(x, o.timer, W / 2, 138, 58, o.urgent ? '#ff6a6a' : '#fff', INK, 700);
    const big = o.big || '';
    const hasVisual = !!o.visual;
    const maxW = hasVisual ? 620 : W - 100;
    const lines = wrap(x, big, maxW, o.small ? 64 : 110);
    const px = o.small ? 64 : lines.length > 1 ? 80 : fitText(x, big, maxW, 120, 700);
    lines.forEach((l, i) => ink(x, l, hasVisual ? 360 : W / 2, 290 + (i - (lines.length - 1) / 2) * px * 1.1, px, '#fff', INK, 700));
    if (hasVisual) drawVisual(x, o.visual, 700, 190, 280, 210);
    if (o.status) ink(x, o.status, W / 2, H - 58, 44, '#9ae8ff', INK, 600);
    screen.tex.needsUpdate = true;
}
function wrap(x, text, maxW, px) {
    x.font = `700 ${px}px Fredoka, sans-serif`;
    const out = [];
    for (const para of String(text).split('\n')) {
        let line = '';
        for (const w of para.split(' ')) {
            const t = line ? line + ' ' + w : w;
            if (x.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
        }
        out.push(line);
    }
    return out.slice(0, 3);
}
// The shape/angle drawings of visual questions (also used by the HUD)
export function drawVisual(x, v, X, Y, W, H) {
    x.save();
    x.lineCap = 'round'; x.lineJoin = 'round';
    if (v.type === 'rect') {
        const maxW = W * 0.62, maxH = H * 0.6, ratio = v.w / v.h;
        let w = maxW, h = maxW / ratio;
        if (h > maxH) { h = maxH; w = maxH * ratio; }
        const x0 = X + (W - w) / 2 + W * 0.06, y0 = Y + H * 0.22 + (maxH - h) / 2;
        x.fillStyle = '#ffaa46'; x.strokeStyle = '#be6e1e'; x.lineWidth = 5;
        x.fillRect(x0, y0, w, h); x.strokeRect(x0, y0, w, h);
        x.strokeStyle = '#fff'; x.lineWidth = 4;
        const ty = y0 - H * 0.09;
        arrow(x, x0, ty, x0 + w, ty);
        label(x, String(v.w), x0 + w / 2, ty, H * 0.13);
        const ax = x0 + W * 0.06;
        arrow(x, ax, y0 + 6, ax, y0 + h - 6);
        label(x, String(v.h), ax, y0 + h / 2, H * 0.13, '#ffaa46');
    } else if (v.type === 'triangle') {
        const scale = Math.min((W * 0.6) / v.b, (H * 0.55) / v.h), w = v.b * scale, h = v.h * scale;
        const x0 = X + (W - w) / 2 + W * 0.08, y0 = Y + H * 0.15 + h;
        x.fillStyle = '#ffaa46'; x.strokeStyle = '#be6e1e'; x.lineWidth = 5;
        x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 + w, y0); x.lineTo(x0, y0 - h); x.closePath(); x.fill(); x.stroke();
        x.strokeStyle = '#fff'; x.lineWidth = 3; x.strokeRect(x0 + 2, y0 - 16, 14, 14);
        label(x, 'b = ' + v.b, x0 + w / 2, y0 + H * 0.12, H * 0.11);
        label(x, 'h = ' + v.h, x0 - W * 0.13, y0 - h / 2, H * 0.11);
    } else if (v.type === 'angle') {
        const vx = X + W * 0.25, vy = Y + H * 0.82, L = W * 0.6, a = (v.deg * Math.PI) / 180;
        x.strokeStyle = '#6ef08c'; x.lineWidth = 8;
        x.beginPath(); x.moveTo(vx, vy); x.lineTo(vx + L, vy); x.stroke();
        const k = v.deg > 120 ? 0.8 : 1;
        x.beginPath(); x.moveTo(vx, vy); x.lineTo(vx + Math.cos(a) * L * k, vy - Math.sin(a) * L * k); x.stroke();
        x.strokeStyle = '#fff'; x.lineWidth = 3;
        if (v.deg === 90) x.strokeRect(vx + 2, vy - 26, 24, 24);
        else { x.beginPath(); x.arc(vx, vy, 34, -a, 0); x.stroke(); }
        x.fillStyle = '#fff'; x.beginPath(); x.arc(vx, vy, 7, 0, Math.PI * 2); x.fill();
    } else if (v.type === 'polygon') {
        const cx = X + W / 2, cy = Y + H / 2 + 6, r = Math.min(W, H) * 0.36, n = v.sides;
        x.fillStyle = '#6ec8ff'; x.strokeStyle = '#fff'; x.lineWidth = 6;
        x.beginPath();
        for (let i = 0; i < n; i++) {
            const a = -Math.PI / 2 + (i / n) * Math.PI * 2 + (n % 2 === 0 ? Math.PI / n : 0);
            const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
            if (i) x.lineTo(px, py); else x.moveTo(px, py);
        }
        x.closePath(); x.fill(); x.stroke();
    }
    x.restore();
}
function arrow(x, x0, y0, x1, y1) {
    const a = Math.atan2(y1 - y0, x1 - x0), s = 9;
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
    for (const [px, py, d] of [[x0, y0, 1], [x1, y1, -1]]) {
        x.beginPath();
        x.moveTo(px + Math.cos(a + 0.5) * s * d, py + Math.sin(a + 0.5) * s * d); x.lineTo(px, py); x.lineTo(px + Math.cos(a - 0.5) * s * d, py + Math.sin(a - 0.5) * s * d);
        x.stroke();
    }
}
function label(x, t, X, Y, px, bg) {
    x.font = `700 ${px}px Fredoka, sans-serif`;
    const w = x.measureText(t).width + px * 0.5;
    x.fillStyle = bg || '#2a2264'; x.fillRect(X - w / 2, Y - px * 0.6, w, px * 1.2);
    ink(x, t, X, Y, px, '#fff', INK, 700);
}

// =====================================================================================
// Vote pads
// =====================================================================================
const voteSigns = {};
function buildVoting() {
    // a wooden deck under the pads
    const deckMat = new T.MeshLambertMaterial({ map: woodTex, color: 0xffe8cc });
    batchBox(deckMat, 0, 0.1, VOTE.z, VOTE.spacing * VOTE_PADS.length + 8, 0.2, VOTE.half * 2 + 10, { tile: 6 });
    for (const p of VOTE_PADS) {
        const col = new T.Color(p.color);
        mesh(round(VOTE.half * 2 + 1.6, 0.6, VOTE.half * 2 + 1.6, 0.25), white, p.x, 0.3, p.z, ROOT, false);
        const pad = mesh(round(VOTE.half * 2, 0.7, VOTE.half * 2, 0.3), new T.MeshLambertMaterial({ color: col, emissive: col, emissiveIntensity: 0.15 }), p.x, 0.45, p.z, ROOT, false);
        solidBox(p.x, 0.4, p.z, VOTE.half * 2 + 1.6, 0.8, VOTE.half * 2 + 1.6, { mat: 'pad' });
        // the name board and the vote count above it
        const sz = p.z - VOTE.half - 5;
        mesh(round(VOTE.half * 2, 6, 1, 0.4), mat(col.getHex(), { rough: 0.5 }), p.x, 5, sz);
        const nc = document.createElement('canvas'); nc.width = 512; nc.height = 128;
        const nx = nc.getContext('2d');
        ink(nx, p.name, 256, 66, 92, '#ffffff', INK, 700);
        if (p.pass) ink(nx, '🔒', 470, 34, 40, '#fff', INK, 700);
        signPlane(nc, VOTE.half * 2 - 1, 5.5, new V3(p.x, 5, sz + 0.52), new V3(p.x, 5, sz + 5));
        mesh(round(10, 10, 1, 0.6), mat(col.getHex(), { rough: 0.5 }), p.x, 15.5, sz);
        const cc = document.createElement('canvas'); cc.width = 256; cc.height = 256;
        voteSigns[p.id] = { ...signPlane(cc, 9, 9, new V3(p.x, 15.5, sz + 0.52), new V3(p.x, 15.5, sz + 5)), n: -1 };
        for (const side of [-1, 1]) { mesh(new T.BoxGeometry(1, 20, 1), white, p.x + side * (VOTE.half - 2), 10, sz - 1); solidBox(p.x + side * (VOTE.half - 2), 10, sz - 1, 1, 20, 1); }
        solidBox(p.x, 5, sz, VOTE.half * 2, 6, 1);
        tickers.push((dt, t) => { pad.material.emissiveIntensity = 0.12 + Math.sin(t * 3 + p.x) * 0.06 + (voteSigns[p.id].n > 0 ? 0.15 : 0); });
    }
    setVotes({});
}
export function setVotes(counts) {
    for (const p of VOTE_PADS) {
        const s = voteSigns[p.id], n = counts[p.id] || 0;
        if (!s || s.n === n) continue;
        s.n = n;
        const x = s.cv.getContext('2d');
        x.clearRect(0, 0, 256, 256);
        ink(x, String(n), 128, 136, 170, '#1e1e32', 'rgba(255,255,255,0.0)', 700);
        s.tex.needsUpdate = true;
    }
}

// =====================================================================================
// Lobby: spawn, How to Play, leaderboards, podium statues
// =====================================================================================
function buildSpawn() {
    mesh(new T.CylinderGeometry(10, 10.6, 0.6, 48), white, SPAWN.x, 0.3, SPAWN.z, ROOT, false);
    const pad = mesh(new T.CylinderGeometry(8.6, 8.6, 0.7, 48), new T.MeshLambertMaterial({ color: 0x46aef0, emissive: 0x2a8aff, emissiveIntensity: 0.06 }), SPAWN.x, 0.35, SPAWN.z, ROOT, false);
    const sc = document.createElement('canvas'); sc.width = 256; sc.height = 256;
    ink(sc.getContext('2d'), '⭐', 128, 132, 150, '#fff', 'rgba(0,0,0,0)', 700);
    const star = new T.Mesh(new T.PlaneGeometry(9, 9), new T.MeshBasicMaterial({ map: texFrom(sc), transparent: true, depthWrite: false }));
    star.rotation.x = -Math.PI / 2; star.position.set(SPAWN.x, 0.72, SPAWN.z);
    ROOT.add(star);
    tickers.push((dt, t) => { star.rotation.z = t * 0.3; pad.material.emissiveIntensity = 0.06 + Math.sin(t * 2) * 0.04; });
}
// A big board on legs facing south (towards the spawn); lift = height of its bottom edge
// The back of a board: a painted wooden panel with a title (it faces the pit)
function boardBack(g, w, h, lift, title, sub) {
    const cv = document.createElement('canvas'); cv.width = Math.round(w * 20); cv.height = Math.round(h * 20);
    const x = cv.getContext('2d'), W = cv.width, H = cv.height;
    const gr = x.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#e8954e'); gr.addColorStop(1, '#c4702e');
    x.fillStyle = gr; x.fillRect(0, 0, W, H);
    for (let i = 1; i < 6; i++) { x.fillStyle = 'rgba(120,60,20,0.18)'; x.fillRect(0, (H / 6) * i - 2, W, 4); }
    x.lineWidth = 14; x.strokeStyle = '#8a4a1c'; roundRect(x, 12, 12, W - 24, H - 24, 30); x.stroke();
    ink(x, title, W / 2, H * (sub ? 0.42 : 0.5), fitText(x, title, W - 90, H * 0.2, 700), '#fff', '#5a2a0c', 700);
    if (sub) ink(x, sub, W / 2, H * 0.62, fitText(x, sub, W - 120, H * 0.09, 600), '#ffe7a8', '#5a2a0c', 600);
    const back = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: texFrom(cv), toneMapped: false }));
    back.position.set(0, lift + h / 2, -0.75); back.rotation.y = Math.PI;
    g.add(back);
}
function board(x, z, w, h, lift, draw, backTitle, backSub) {
    const g = new T.Group();
    g.position.set(x, 0, z);
    ROOT.add(g);
    const frame = new T.Mesh(round(w + 2, h + 2, 1.4, 0.7), woodMat); frame.position.y = lift + h / 2; frame.castShadow = true; g.add(frame);
    const legX = w / 2 - 2;
    for (const side of [-1, 1]) {
        const leg = new T.Mesh(round(1.8, lift + 1.5, 1.8, 0.3), woodDark); leg.position.set(side * legX, (lift + 1.5) / 2, -0.3); leg.castShadow = true; g.add(leg);
        solidBox(x + side * legX, (lift + 1.5) / 2, z - 0.3, 1.8, lift + 1.5, 1.8, { mat: 'wood' });
    }
    const cv = document.createElement('canvas'); cv.width = Math.round(w * 26); cv.height = Math.round(h * 26);
    const tex = texFrom(cv);
    const face = new T.Mesh(new T.PlaneGeometry(w, h), new T.MeshBasicMaterial({ map: tex, toneMapped: false }));
    face.position.set(0, lift + h / 2, 0.75); g.add(face);
    if (backTitle) boardBack(g, w, h, lift, backTitle, backSub);
    const b = { cv, tex, draw };
    draw(cv.getContext('2d'), cv.width, cv.height, []);
    tex.needsUpdate = true;
    // the board itself only blocks you when it comes down low enough to walk into
    if (lift < 5) solidBox(x, lift + h / 2, z, w + 2, h + 2, 1.4);
    return b;
}
function buildHowTo() {
    board(HOW_TO.x, HOW_TO.z, 36, 16, HOW_TO.lift, (x, W, H) => {
        const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#465aff'); g.addColorStop(1, '#7828e6');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        ink(x, 'How to Play', W / 2, H * 0.14, H * 0.14, '#fff', INK, 700);
        const lines = [
            ['Answer quickly to avoid rising lava!', '#ffec5a'],
            ['The faster you answer, the more blocks you earn.', '#ffffff'],
            ['Get ready to play when the current game ends!', '#ffec5a'],
            ['Unlock cool towers, block animations, and victory dances', '#ffffff'],
            ['with gems! You earn +5 gems per correct answer!', '#ffffff'],
        ];
        lines.forEach(([t, c], i) => { const px = fitText(x, t, W - 60, H * 0.085, 600); ink(x, t, W / 2, H * (0.34 + i * 0.13), px, c, INK, 600); });
    }, 'GOOD LUCK!', 'Spawn, eggs, passes and the gem chest this way');
}
const boards = {};
const statues = { wins: [], answers: [] };
function drawBoard(title, icon, valueName) {
    return (x, W, H, rows) => {
        const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#3c6eff'); g.addColorStop(1, '#6e32dc');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        ink(x, icon + ' ' + title + ' ' + icon, W / 2, H * 0.07, H * 0.07, '#ffe150', INK, 700);
        x.font = `600 ${H * 0.04}px Fredoka, sans-serif`;
        ink(x, 'Rank', W * 0.1, H * 0.15, H * 0.038, '#dce6ff', INK, 600);
        ink(x, 'Name', W * 0.42, H * 0.15, H * 0.038, '#dce6ff', INK, 600);
        ink(x, valueName, W * 0.84, H * 0.15, H * 0.038, '#dce6ff', INK, 600);
        for (let i = 0; i < 10; i++) {
            const y = H * (0.22 + i * 0.077), r = rows[i];
            x.fillStyle = i % 2 ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.15)';
            roundRect(x, W * 0.03, y - H * 0.033, W * 0.94, H * 0.066, H * 0.02); x.fill();
            ink(x, String(i + 1), W * 0.1, y, H * 0.045, i === 0 ? '#ffd028' : i === 1 ? '#dce4ff' : i === 2 ? '#ffaa6a' : '#fff', INK, 700);
            if (!r) continue;
            let n = r.n; x.font = `600 ${H * 0.04}px Fredoka, sans-serif`;
            while (x.measureText(n).width > W * 0.48 && n.length > 3) n = n.slice(0, -1);
            ink(x, n, W * 0.42, y, H * 0.04, '#fff', INK, 600);
            ink(x, fmt(r.v), W * 0.84, y, H * 0.042, '#fff08a', INK, 700);
        }
    };
}
function buildBoards() {
    for (const [key, b] of Object.entries(BOARDS)) {
        boards[key] = board(b.x, b.z, 22, 28, 3, drawBoard(b.title, b.icon, key === 'wins' ? 'Wins' : 'Answers'), b.title.toUpperCase(), 'Leaderboard');
        const p = PODIUMS[key];
        const g = new T.Group();
        g.position.set(p.x, 0, p.z);
        ROOT.add(g);
        // a white plinth under the three steps
        const plinth = new T.Mesh(round(31, 0.8, 12, 0.3), white); plinth.position.y = 0.4; plinth.receiveShadow = true; g.add(plinth);
        const specs = [[0, 0, 6.5, 0xffc828, '#ffc828'], [1, key === 'wins' ? 9.8 : -9.8, 4.6, 0xd6deec, '#c8d2e6'], [2, key === 'wins' ? -9.8 : 9.8, 3.2, 0xec9452, '#ec9452']];
        for (const [rank, ox, h, color, css] of specs) {
            const block = new T.Mesh(round(9, h, 9, 0.4), mat(color, { rough: 0.35, metal: rank === 0 ? 0.5 : 0.3 }));
            block.position.set(ox, 0.8 + h / 2, 0); block.castShadow = true; block.receiveShadow = true; g.add(block);
            const mc = document.createElement('canvas'); mc.width = 256; mc.height = 256;
            const mx = mc.getContext('2d');
            mx.fillStyle = '#fff'; mx.beginPath(); mx.arc(128, 128, 96, 0, Math.PI * 2); mx.fill();
            mx.lineWidth = 14; mx.strokeStyle = css; mx.stroke();
            ink(mx, String(rank + 1), 128, 136, 120, css, INK, 700);
            const medal = new T.Mesh(new T.PlaneGeometry(Math.min(4.2, h * 0.75), Math.min(4.2, h * 0.75)), new T.MeshBasicMaterial({ map: texFrom(mc), transparent: true }));
            medal.position.set(ox, 0.8 + h / 2, 4.55); g.add(medal);
            // a statue of the champion, in the podium's metal
            const statueMat = mat(color, { rough: 0.25, metal: 0.7, emissive: color, ei: 0.12 });
            const rig = buildRig({ shirt: color, shorts: color, socks: color, skin: color, hair: color }, statueMat);
            rig.position.set(ox, 0.8 + h, 0);
            if (rank === 0) { rig.userData.arms[0].rotation.set(-2.8, 0, -0.2); rig.userData.arms[1].rotation.set(-2.8, 0, 0.2); } else rig.userData.arms[1].rotation.set(-2.6, 0, 0.2);
            g.add(rig);
            const lbl = tag([{ t: '#' + (rank + 1) + ' —', c: '#ffffff', px: 46 }], 7, new V3(ox, 0.8 + h + 8.2, 0), g);
            statues[key][rank] = { label: lbl, name: '', rig };
            farHide(lbl, p.x + ox, p.z, 130);
            solidBox(p.x + ox, (0.8 + h) / 2, p.z, 9, 0.8 + h, 9);
        }
        solidBox(p.x, 0.4, p.z, 31, 0.8, 12, { mat: 'stone' });
        // the statues never move: one mesh per metal
        mergeChildren(g);
    }
}
const boardKeys = {};
export function renderBoards(m) {
    for (const key of Object.keys(BOARDS)) {
        const rows = (m && m[key]) || [], k = JSON.stringify(rows);
        if (boardKeys[key] === k) continue;
        boardKeys[key] = k;
        const b = boards[key];
        b.draw(b.cv.getContext('2d'), b.cv.width, b.cv.height, rows);
        b.tex.needsUpdate = true;
        statues[key].forEach((st, i) => {
            const name = rows[i] ? rows[i].n : '—';
            if (st.name !== name) {
                st.name = name;
                st.label.userData.set([{ t: '#' + (i + 1) + ' ' + name, c: '#ffffff', px: 46 }, ...(rows[i] ? [{ t: fmt(rows[i].v) + (key === 'wins' ? ' Wins' : ' Answers'), c: '#ffe150', px: 36 }] : [])]);
            }
        });
    }
}

// =====================================================================================
// Pass pads, Watch Game, the gem chest, the VIP lounge
// =====================================================================================
function emojiSprite(e, size, pos, parent) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'); x.font = '100px "Segoe UI Emoji", "Apple Color Emoji", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(e, 64, 72);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: texFrom(c), transparent: true, depthWrite: false }));
    sp.scale.setScalar(size); sp.position.copy(pos);
    (parent || ROOT).add(sp);
    return sp;
}
function buildPads() {
    for (const [key, p] of Object.entries(PADS)) {
        mesh(new T.CylinderGeometry(7.6, 7.6, 0.5, 48), white, p.x, 0.25, p.z, ROOT, false);
        mesh(new T.CylinderGeometry(6.6, 6.6, 0.6, 48), mat(p.color, { neon: true, boost: 0.55 }), p.x, 0.32, p.z, ROOT, false);
        const ringM = new T.Mesh(new T.TorusGeometry(6.8, 0.25, 8, 48), mat(p.color, { neon: true, boost: 0.8 }));
        ringM.rotation.x = Math.PI / 2; ringM.position.set(p.x, 1.4, p.z); ROOT.add(ringM);
        const icon = emojiSprite(p.ic, 4.5, new V3(p.x, 6.5, p.z));
        tag([{ t: p.label, c: '#fff', px: 52 }], 10, new V3(p.x, 10.2, p.z));
        tickers.push((dt, t) => { ringM.position.y = 1.4 + Math.sin(t * 2 + p.x) * 0.9; ringM.scale.setScalar(1 + Math.sin(t * 2 + p.x) * 0.04); icon.position.y = 6.5 + Math.sin(t * 2.4 + p.z) * 0.4; });
        prompts.push({
            pos: new V3(p.x, 0, p.z), r: 8,
            label: () => (key === 'WatchGame' ? 'Watch the game' : S.passes[key] ? 'Owned ✓' : 'Get ' + PASSES[key].name),
            act: () => (key === 'WatchGame' ? actions.spectate() : actions.buy('pass', key)),
        });
    }
}
const chestUi = { label: null, key: '' };
function buildChest() {
    const g = new T.Group(); g.position.set(CHEST.x, 0, CHEST.z); g.rotation.y = Math.PI; ROOT.add(g);
    const glow = new T.Mesh(new T.CylinderGeometry(7, 7, 0.2, 48), mat(0xffd028, { neon: true, boost: 0.5, opacity: 0.7 }));
    glow.position.y = 0.16; g.add(glow);
    const body = new T.Mesh(round(7, 4, 5, 0.4), mat(0xa0622e, { rough: 0.7 })); body.position.y = 2.2; body.castShadow = true; g.add(body);
    const lid = new T.Mesh(round(7.2, 1.8, 5.2, 0.5), mat(0xb8743a, { rough: 0.65 })); lid.position.y = 5.1; lid.castShadow = true; g.add(lid);
    const gold = mat(0xffc828, { rough: 0.25, metal: 0.8 });
    for (const x of [-2.6, 2.6]) { const band = new T.Mesh(new T.BoxGeometry(0.6, 6.2, 5.4), gold); band.position.set(x, 3.2, 0); g.add(band); }
    const lock = new T.Mesh(new T.BoxGeometry(1.4, 1.6, 0.6), gold); lock.position.set(0, 4.2, 2.7); g.add(lock);
    solidBox(CHEST.x, 3, CHEST.z, 7.4, 6, 5.4);
    chestUi.label = tag([{ t: 'Gem Chest', c: '#fff', px: 52 }, { t: 'Ready', c: '#7dff6b', px: 42 }], 9, new V3(CHEST.x, 10.5, CHEST.z));
    tickers.push((dt, t) => { lid.rotation.x = Math.sin(t * 3) > 0.96 ? -0.1 : 0; glow.scale.setScalar(1 + Math.sin(t * 2) * 0.05); });
    prompts.push({ pos: new V3(CHEST.x, 0, CHEST.z), r: 9, label: () => 'Claim ' + CFG.chestGems + ' Gems', act: () => actions.chest() });
}
function updateChest() {
    if (!chestUi.label) return;
    const left = CFG.chestHours * 3600 - (Date.now() - (S.chestAt || 0)) / 1000;
    const text = left > 0 ? clock(left) : 'Ready';
    if (text === chestUi.key) return;
    chestUi.key = text;
    chestUi.label.userData.set([{ t: 'Gem Chest', c: '#fff', px: 52 }, { t: text, c: left > 0 ? '#ffffff' : '#7dff6b', px: 42 }]);
}
const vipDoor = { solid: null, mesh: null };
function buildVip() {
    const L = VIP_LOUNGE, cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2, w = L.x1 - L.x0, d = L.z1 - L.z0;
    // a checkered gold-and-cream floor
    const vipTex = canvasTex(256, 256, (x) => {
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) bevelRect(x, i * 128 + 2, j * 128 + 2, 124, 124, (i + j) % 2 ? '#ffd65a' : '#fff2c8', 8);
    }, true);
    batchBox(new T.MeshStandardMaterial({ map: vipTex, roughness: 0.35, metalness: 0.15 }), cx, 0.15, cz, w, 0.3, d, { tile: 8 });
    const wallM = mat(0xffcf3a, { rough: 0.45, metal: 0.12 }), trimM = mat(0xfff4d0, { rough: 0.4 });
    const H = 10;
    const wall = (x, z, sx, sz) => {
        batchBox(wallM, x, H / 2, z, sx, H, sz, { cast: true });
        batchBox(trimM, x, H + 0.3, z, sx + 0.6, 0.6, sz + 0.6, { cast: true });
        solidBox(x, H / 2, z, sx, H, sz, { mat: 'wall' });
    };
    wall(cx, L.z0, w, 1.2); wall(cx, L.z1, w, 1.2); wall(L.x1, cz, 1.2, d);
    const dz = L.door.z;
    wall(L.x0, (L.z0 + dz - 6) / 2, 1.2, dz - 6 - L.z0); wall(L.x0, (dz + 6 + L.z1) / 2, 1.2, L.z1 - dz - 6);
    vipDoor.mesh = mesh(new T.BoxGeometry(0.6, H, 12), new T.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.45, depthWrite: false }), L.x0, H / 2, dz, ROOT, false);
    vipDoor.solid = solidBox(L.x0, H / 2, dz, 1, H, 12, { mat: 'door' });
    const sc = document.createElement('canvas'); sc.width = 512; sc.height = 160;
    const sx = sc.getContext('2d'); sx.fillStyle = '#2a1e10'; roundRect(sx, 0, 0, 512, 160, 30); sx.fill();
    sx.lineWidth = 8; sx.strokeStyle = '#ffd23c'; roundRect(sx, 4, 4, 504, 152, 26); sx.stroke();
    ink(sx, '👑 VIP LOUNGE 👑', 256, 84, 66, '#ffd23c', INK, 700);
    signPlane(sc, 14, 4.4, new V3(L.x0 - 0.8, H + 2.9, dz), new V3(L.x0 - 10, H + 2.9, dz));
    // a fountain of golden sparkles
    mesh(new T.CylinderGeometry(5, 5.6, 1.6, 40), white, cx, 0.8, cz);
    const water2 = mesh(new T.CylinderGeometry(4.3, 4.3, 0.2, 40), mat(0x6adcff, { rough: 0.1 }), cx, 1.62, cz, ROOT, false);
    mesh(new T.CylinderGeometry(0.8, 1, 4, 16), white, cx, 3, cz);
    solidBox(cx, 1, cz, 10, 2, 10);
    tickers.push((dt, t) => { water2.position.y = 1.62 + Math.sin(t * 3) * 0.05; vipDoor.mesh.material.opacity = (S.passes.VIP ? 0.18 : 0.42) + Math.sin(t * 3) * 0.08; });
    prompts.push({ pos: new V3(L.x0 - 3, 0, dz), r: 7, label: () => (S.passes.VIP ? 'Welcome, VIP!' : 'VIP only'), act: () => { if (!S.passes.VIP) actions.buy('pass', 'VIP'); } });
}
export function setVipDoor(vip) { if (vipDoor.solid) vipDoor.solid.off = !!vip; }

// =====================================================================================
// Shops: tower skins (east row), victory dances (west row), eggs (south-west)
// =====================================================================================
const shopLabels = [];
function priceLine(price) { return price > 0 ? '💎 ' + fmtComma(price) : 'FREE'; }
// A round white pedestal with a coloured band
function pedestal(x, z, r, h, color) {
    mesh(new T.CylinderGeometry(r, r + 0.4, h, 36), white, x, h / 2, z);
    const band = new T.Mesh(new T.CylinderGeometry(r + 0.05, r + 0.05, 0.35, 36), mat(color, { rough: 0.4 }));
    band.position.set(x, h - 0.35, z); ROOT.add(band);
    solidBox(x, h / 2, z, r * 1.6, h, r * 1.6);
}
function buildTowerShop() {
    TOWERS.forEach((sk, i) => {
        const x = TOWER_SHOP.x, z = TOWER_SHOP.z0 + i * TOWER_SHOP.step;
        pedestal(x, z, 3.8, 1, 0xd98a46);
        const stack = new T.Group(); stack.position.set(x, 1, z); ROOT.add(stack);
        for (let b = 1; b <= 4; b++) {
            const block = new T.Mesh(BLOCK, tintedTowerMaterial(sk.id, b));
            block.scale.setScalar(0.7);
            block.position.y = (b - 0.5) * CFG.blockH * 0.7;
            block.castShadow = true;
            stack.add(block);
        }
        solidBox(x, 3, z, 5, 5, 5);
        const lbl = tag([{ t: sk.name, c: '#fff', px: 50 }, { t: priceLine(sk.price), c: '#e8b4ff', px: 40 }], 7, new V3(x, 9.4, z));
        shopLabels.push({ cat: 'towers', item: sk, lbl, key: '' });
        farHide(stack, x, z, 110); farHide(lbl, x, z, 120);
        tickers.push((dt, t) => { stack.rotation.y = t * 0.5 + i; });
        prompts.push({ pos: new V3(x - 4, 0, z), r: 6, label: () => shopPrompt('towers', sk), act: () => actions.cosmetic('towers', sk.id) });
    });
    woodSign('🧱 TOWER SKINS', 20, 5, new V3(TOWER_SHOP.x - 2, 11, TOWER_SHOP.z0 - 12), new V3(TOWER_SHOP.x - 30, 11, TOWER_SHOP.z0 - 4));
}
const dancers = [];
function buildDanceShop() {
    DANCES.forEach((dn, i) => {
        const x = DANCE_SHOP.x, z = DANCE_SHOP.z0 + i * DANCE_SHOP.step;
        pedestal(x, z, 4.4, 1, 0xb06cff);
        const kit = KITS[(i + 1) % KITS.length];
        const rig = buildRig({ ...kit, skin: SKINS[i % SKINS.length], hair: [0x8a3a1a, 0x1a1a1a, 0xffd23c, 0xff7ad0][i % 4] });
        const holder = new T.Group(); holder.position.set(x, 1, z); holder.rotation.y = Math.PI / 2; holder.add(rig); ROOT.add(holder);
        dancers.push({ rig, holder, id: dn.id, phase: i * 0.7 });
        const lbl = tag([{ t: dn.ic + ' ' + dn.name, c: '#fff', px: 48 }, { t: priceLine(dn.price), c: '#e8b4ff', px: 40 }], 7.5, new V3(x, 10.4, z));
        shopLabels.push({ cat: 'dances', item: dn, lbl, key: '' });
        farHide(holder, x, z, 110); farHide(lbl, x, z, 120);
        prompts.push({ pos: new V3(x + 4, 0, z), r: 6, label: () => shopPrompt('dances', dn), act: () => actions.cosmetic('dances', dn.id) });
    });
    woodSign('💃 VICTORY DANCES', 22, 5, new V3(DANCE_SHOP.x + 2, 11, DANCE_SHOP.z0 - 12), new V3(DANCE_SHOP.x + 30, 11, DANCE_SHOP.z0 - 4));
}
function shopPrompt(cat, item) {
    const owned = cat === 'towers' ? S.towers[item.id] : S.dances[item.id];
    const eq = cat === 'towers' ? S.tower === item.id : S.dance === item.id;
    return eq ? 'Equipped ✓' : owned ? 'Equip ' + item.name : 'Buy ' + item.name + ' (💎' + fmt(item.price) + ')';
}
export function refreshShopLabels() {
    for (const s of shopLabels) {
        const owned = s.cat === 'towers' ? S.towers[s.item.id] : S.dances[s.item.id];
        const eq = s.cat === 'towers' ? S.tower === s.item.id : S.dance === s.item.id;
        const line = eq ? 'Equipped ✓' : owned ? 'Owned' : priceLine(s.item.price);
        if (line === s.key) continue;
        s.key = line;
        s.lbl.userData.set([{ t: (s.item.ic ? s.item.ic + ' ' : '') + s.item.name, c: '#fff', px: 48 }, { t: line, c: eq ? '#7dff6b' : owned ? '#9ae8ff' : '#e8b4ff', px: 40 }]);
    }
}
function eggTexture(egg) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = '#' + egg.color.toString(16).padStart(6, '0'); x.fillRect(0, 0, 256, 128);
    const rng = mulberry(egg.price);
    for (let i = 0; i < 16; i++) {
        x.fillStyle = '#' + egg.spots.toString(16).padStart(6, '0');
        x.beginPath(); x.ellipse(rng() * 256, 20 + rng() * 88, 8 + rng() * 10, 6 + rng() * 8, rng() * 3, 0, Math.PI * 2); x.fill();
    }
    return texFrom(c);
}
export function eggModel(egg) {
    const m = new T.Mesh(new T.SphereGeometry(2.6, 32, 20), glossyMat({ map: eggTexture(egg), roughness: 0.3, metalness: egg.id === 'golden' ? 0.4 : 0.05, emissive: egg.id === 'genius' ? 0x3a1a8a : 0x000000, emissiveIntensity: 0.4 }));
    m.scale.set(1, 1.3, 1);
    m.castShadow = true;
    return m;
}
function buildEggs() {
    EGGS.forEach((egg, i) => {
        const p = EGG_STANDS[i];
        pedestal(p.x, p.z, 4.2, 2, egg.color);
        const e = eggModel(egg);
        e.position.set(p.x, 5.6, p.z); ROOT.add(e);
        farHide(tag([{ t: egg.name, c: '#fff', px: 50 }, { t: '💎 ' + fmtComma(egg.price), c: '#e8b4ff', px: 40 }], 7.5, new V3(p.x, 12, p.z)), p.x, p.z, 120);
        tickers.push((dt, t) => { e.rotation.y = t * 0.8 + i; e.position.y = 5.6 + Math.sin(t * 2 + i) * 0.35; });
        prompts.push({ pos: new V3(p.x, 0, p.z - 3), r: 7, label: () => 'Hatch ' + egg.name + ' (💎' + fmt(egg.price) + ')', act: () => actions.hatch(egg.id) });
    });
    const mid = EGG_STANDS[1];
    woodSign('🥚 PET EGGS', 18, 4.6, new V3(mid.x, 14, mid.z + 8), new V3(mid.x, 14, mid.z - 20));
}

// =====================================================================================
// Gems to pick up
// =====================================================================================
const gemGeo = new T.OctahedronGeometry(1.1, 0);
gemGeo.scale(1, 1.35, 1);
const gemMat = glossyMat({ color: 0xb45aff, roughness: 0.15, metalness: 0.2, emissive: 0x7a2ad8, emissiveIntensity: 0.55 });
const vipGemMat = glossyMat({ color: 0xffd23c, roughness: 0.15, metalness: 0.4, emissive: 0xb07a00, emissiveIntensity: 0.5 });
export const gems = [];
const gemMeshes = [];
// Two instanced meshes (lobby gems and VIP gems): two draw calls for all of them
function buildGems() {
    for (const vip of [false, true]) {
        const list = GEM_SPOTS.filter((g) => g.vip === vip);
        const im = new T.InstancedMesh(gemGeo, vip ? vipGemMat : gemMat, list.length);
        im.castShadow = true;
        im.frustumCulled = false;
        ROOT.add(im);
        gemMeshes.push(im);
        list.forEach((g, k) => gems[g.i] = { ...g, im, k, until: 0, pending: 0 });
    }
}
export function setGemDown(i, until) { const g = gems[i]; if (g) { g.until = until; g.pending = 0; } }
const gemM = new T.Matrix4(), gemQ = new T.Quaternion(), gemP = new V3(), gemS = new V3(), UP = new V3(0, 1, 0);
function updateGems(t, serverNow) {
    for (const g of gems) {
        const down = g.until > serverNow || g.pending > performance.now();
        gemQ.setFromAxisAngle(UP, t * 1.8 + g.i);
        gemP.set(g.x, g.y + Math.sin(t * 2 + g.i) * 0.45, g.z);
        gemS.setScalar(down ? 0 : 1);
        g.im.setMatrixAt(g.k, gemM.compose(gemP, gemQ, gemS));
    }
    for (const im of gemMeshes) im.instanceMatrix.needsUpdate = true;
}

// ----- level of detail: small props and labels far from the camera are hidden -----
const lod = [];
function farHide(obj, x, z, r) { lod.push({ obj, x, z, r2: r * r }); }
let lodT = 0;
function updateLod(dt, cam) {
    lodT -= dt;
    if (lodT > 0 || !cam) return;
    lodT = 0.2;
    for (const l of lod) { const dx = l.x - cam.x, dz = l.z - cam.z; l.obj.visible = dx * dx + dz * dz < l.r2; }
}

// =====================================================================================
export const torches = [];
export function buildWorld() {
    buildGround();
    buildScreen();
    buildVoting();
    buildSpawn();
    buildHowTo();
    buildBoards();
    buildPads();
    buildChest();
    buildVip();
    buildTowerShop();
    buildDanceShop();
    buildEggs();
    buildGems();
    buildDecor();
    flushBatches(ROOT);
    // torches just outside the walkway's corners
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const x = sx * (WALK.x[1] + 3), z = sz * (WALK.z[1] + 3);
        mesh(new T.CylinderGeometry(0.6, 0.8, 9, 10), woodDark, x, 4.5, z);
        mesh(new T.CylinderGeometry(1.8, 1.2, 1.2, 12), mat(0x4a4448, { rough: 0.6 }), x, 9.4, z);
        solidBox(x, 4.5, z, 2, 9, 2);
        torches.push(new V3(x, 10.2, z));
    }
}

export function updateWorld(dt, t, serverNow, cam) {
    for (const fn of tickers) fn(dt, t);
    if (water) water.material.normalMap.offset.set(t * 0.004, t * 0.006);
    updateGems(t, serverNow);
    updateLod(dt, cam);
    for (const d of dancers) {
        if (!d.holder.visible) continue;
        const bounce = dancePoseRig(d.rig, d.id, t + d.phase);
        d.rig.position.y = bounce;
        if (d.id === 'tornado') d.holder.rotation.y = Math.PI / 2 + t * 6;
    }
    updateChest();
}
export { solids };
