import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const T = THREE;

// ----- the colour grade -----
// The bright cartoon look (a little more saturation and contrast, a soft S-curve), applied in the
// tone mapping step of every lit material instead of a separate full-screen pass. It works on
// display (sRGB) values; shaders that skip tone mapping (sky, lava) call mtrGrade() themselves.
export const GRADE_GLSL = `vec3 mtrGrade(vec3 s) {
    float l = dot(s, vec3(0.2126, 0.7152, 0.0722));
    s = mix(vec3(l), s, 1.14);
    s = (s - 0.5) * 1.08 + 0.5;
    s = mix(s, s * s * (3.0 - 2.0 * s), 0.15);
    return clamp(s, 0.0, 1.0);
}`;
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    GRADE_GLSL + '\nvec3 CustomToneMapping( vec3 color ) { vec3 s = pow( max( NeutralToneMapping( color ), 0.0 ), vec3( 1.0 / 2.2 ) ); return pow( mtrGrade( s ), vec3( 2.2 ) ); }',
);
// the lava surface height, for the warm glow it puts on the towers (towers.js)
export const lavaGlowY = { value: -1000 };
export const V3 = THREE.Vector3;
export const $ = (s) => document.querySelector(s);
export const hexCss = (h) => '#' + h.toString(16).padStart(6, '0');

// ----- renderer, scene, camera, lights -----
export const canvas = $('#view');
export const renderer = new T.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFShadowMap;

export const scene = new T.Scene();
// a light sky haze so the ocean and far islands fade into the horizon
scene.fog = new T.Fog(0xbfefff, 260, 1300);
scene.background = new T.Color(0x8fdcff);

// ----- sky: the reference's bright cartoon day -----
// Deep cyan overhead fading to a pale minty horizon, big soft white clouds and a warm sun. The
// clouds are painted once into a cube map at startup (3D noise, so there is no seam anywhere);
// every frame the dome only looks the cube map up, slowly turning it so the clouds drift.
const SKY_DIR = `vec3 d = normalize(vDir); float h = d.y;`;
const bakeMat = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
    vertexShader: `varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vDir;
        float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        float n3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
                       mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
        float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * n3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
        void main() {
            ${SKY_DIR}
            vec3 zen = vec3(0.18, 0.62, 1.0), mid = vec3(0.38, 0.82, 1.0), hor = vec3(0.78, 0.97, 1.0), low = vec3(0.55, 0.86, 0.98);
            vec3 col = h > 0.0 ? mix(mix(hor, mid, smoothstep(0.0, 0.22, h)), zen, smoothstep(0.18, 0.9, h)) : mix(hor, low, 1.0 - smoothstep(-0.25, 0.0, h));
            // fluffy clouds: a belt of big puffs low in the sky, thinner wisps higher up
            vec3 cp = vec3(d.x * 2.6, h * 9.6, d.z * 2.6);
            float c = fbm(cp);
            float band = smoothstep(0.02, 0.1, h) * (1.0 - smoothstep(0.32, 0.6, h));
            float cloud = smoothstep(0.5, 0.64, c) * band;
            float shade = smoothstep(0.5, 0.75, fbm(cp + vec3(0.0, 0.55, 0.0)));
            col = mix(col, mix(vec3(1.0), vec3(0.84, 0.91, 0.98), shade * 0.65), cloud * 0.96);
            float wisp = smoothstep(0.6, 0.8, fbm(vec3(d.x * 4.0, h * 2.0, d.z * 4.0) + 5.0)) * smoothstep(0.35, 0.7, h) * 0.45;
            col = mix(col, vec3(1.0), wisp);
            gl_FragColor = vec4(col, 1.0);
        }`,
});
const skyCube = new T.WebGLCubeRenderTarget(1024, { type: T.HalfFloatType, generateMipmaps: false, minFilter: T.LinearFilter });
{
    const bakeScene = new T.Scene();
    bakeScene.add(new T.Mesh(new T.BoxGeometry(10, 10, 10), bakeMat));
    new T.CubeCamera(0.1, 100, skyCube).update(renderer, bakeScene);
    bakeMat.dispose();
}
const skyMat = new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
    uniforms: { uSky: { value: skyCube.texture }, uTurn: { value: 0 } },
    vertexShader: `varying vec3 vDir;
        void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `uniform samplerCube uSky; uniform float uTurn; varying vec3 vDir;
        ${GRADE_GLSL}
        void main() {
            ${SKY_DIR}
            float cs = cos(uTurn), sn = sin(uTurn);
            vec3 col = textureCube(uSky, vec3(d.x * cs - d.z * sn, d.y, d.x * sn + d.z * cs)).rgb;
            // the sun (drawn here so its disc stays crisp)
            vec3 sd = normalize(vec3(0.45, 0.62, -0.64));
            float sc = max(dot(d, sd), 0.0);
            col += vec3(1.0, 0.95, 0.8) * (smoothstep(0.9993, 0.9996, sc) * 1.4 + pow(sc, 260.0) * 0.5 + pow(sc, 12.0) * 0.12);
            gl_FragColor = vec4(mtrGrade(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2))), 1.0);
        }`,
});
const skyDome = new T.Mesh(new T.SphereGeometry(3000, 40, 20), skyMat);
skyDome.renderOrder = -10;
skyDome.frustumCulled = false;
scene.add(skyDome);
export function updateSky(pos, t) {
    skyMat.uniforms.uTurn.value = t * 0.0016;
    skyDome.position.copy(pos);
}

export const camera = new T.PerspectiveCamera(70, 1, 0.3, 3000);
function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < h ? 85 : 70;
    camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Reflections come from a bright "outdoor" room: sky-blue walls, a white sky panel overhead and a
// green floor, so glossy blocks, gems and pets pick up a sunny, colourful sheen.
function skyRoom() {
    const room = new T.Scene();
    const box = new T.Mesh(new T.BoxGeometry(20, 12, 20), new T.MeshBasicMaterial({ color: 0x7ccfff, side: T.BackSide }));
    box.position.y = 4;
    room.add(box);
    const plane = (color, k, w, h, x, y, z, rx) => {
        const m = new T.MeshBasicMaterial({ color, side: T.DoubleSide });
        m.color.multiplyScalar(k);
        const p = new T.Mesh(new T.PlaneGeometry(w, h), m);
        p.position.set(x, y, z); p.rotation.x = rx || 0;
        room.add(p);
    };
    plane(0xffffff, 3.2, 12, 12, 0, 9.9, 0, Math.PI / 2);       // the sky light
    plane(0x6ad04a, 0.9, 20, 20, 0, -1.9, 0, -Math.PI / 2);      // grass bounce
    plane(0xfff0c8, 2.4, 4, 4, 6, 8, -6, Math.PI / 2);           // the sun
    return room;
}
// No environment map or reflections (like Bloxity's top games): matte materials lit by the sky
// light, a little ambient and the sun
// Lit like Bloxity's top games: sky / ground fill, a little ambient and the sun, no tone mapping
export const hemi = new T.HemisphereLight(0xe8f8ff, 0x5a9a3a, 1.1);
scene.add(hemi, new T.AmbientLight(0xffffff, 0.45));
// a soft fill from the camera's side, so characters and pets always read clearly
export const camFill = new T.DirectionalLight(0xffffff, 0.35);
// (not in the scene: the top games use no fill light; the game still moves it, harmlessly)
export const sun = new T.DirectionalLight(0xfff3e0, 1.5);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 400 });
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.05;
sun.shadow.radius = 3;
scene.add(sun, sun.target);

// ----- materials -----
export const UNIT = new T.BoxGeometry(1, 1, 1);
// Neon is pushed above 1.0 so only it crosses the bloom threshold (fx.js)
export const NEON_BOOST = 2.6;
// Matte materials only: PBR settings (roughness, metal, normal maps, environment) are dropped
const PBR_ONLY = ['roughness', 'metalness', 'roughnessMap', 'metalnessMap', 'normalMap', 'normalScale', 'normalMapType', 'envMap', 'envMapIntensity', 'clearcoat', 'clearcoatRoughness', 'sheen', 'sheenColor', 'sheenRoughness', 'ior', 'transmission', 'thickness', 'iridescence', 'specularIntensity', 'specularColor'];
export function toLambert(p) {
    const q = { ...(p || {}) };
    for (const k of PBR_ONLY) delete q[k];
    return new T.MeshLambertMaterial(q);
}
const matCache = new Map();
export function mat(color, o) {
    o = o || {};
    const key = color + '|' + (o.neon ? 1 : 0) + '|' + (o.opacity || 1) + '|' + (o.rough ?? '') + '|' + (o.side || 0) + '|' + (o.metal || 0) + '|' + (o.emissive || 0) + '|' + (o.ei ?? '') + '|' + (o.boost || 1);
    let m = matCache.get(key);
    if (!m) {
        // matte surfaces use the much cheaper Lambert shading; only shiny / metal ones need PBR
        const rough = o.rough ?? 0.6, metal = o.metal || 0;
        m = o.neon ? new T.MeshBasicMaterial({ color })
            : rough >= 0.4 && metal <= 0.15 ? new T.MeshLambertMaterial({ color })
                : toLambert({ color, roughness: rough, metalness: metal });
        if (o.neon) m.color.multiplyScalar(NEON_BOOST * (o.boost || 1));
        if (o.emissive) { m.emissive = new T.Color(o.emissive); m.emissiveIntensity = o.ei ?? 0.6; }
        if (o.opacity && o.opacity < 1) { m.transparent = true; m.opacity = o.opacity; m.depthWrite = false; }
        if (o.side) m.side = T.DoubleSide;
        matCache.set(key, m);
    }
    return m;
}
// The glossy look without MeshPhysicalMaterial (much bigger shaders, slow to compile on Windows)
const PHYSICAL_ONLY = ['clearcoat', 'clearcoatRoughness', 'sheen', 'sheenColor', 'sheenRoughness', 'iridescence', 'iridescenceIOR', 'iridescenceThicknessRange', 'transmission', 'thickness', 'ior', 'specularIntensity', 'specularColor'];
export function glossyMat(o) {
    o = { ...(o || {}) };
    const coat = o.clearcoat || 0;
    for (const k of PHYSICAL_ONLY) delete o[k];
    if (coat && o.roughness !== undefined) o.roughness = Math.max(0.04, o.roughness * (1 - 0.35 * coat));
    return toLambert(o);
}
export function texFrom(cv, repeat) {
    const t = new T.CanvasTexture(cv);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (repeat) t.wrapS = t.wrapT = T.RepeatWrapping;
    return t;
}

// ----- world collections -----
// solids: { min, max, mat } boxes the player collides with; triggers: { min, max, enter, inside };
// prompts: { pos, r, label(), act() }; tickers: per-frame callbacks (dt, t)
export const solids = [];
export const triggers = [];
export const prompts = [];
export const tickers = [];

export function aabb(x, y, z, sx, sy, sz) {
    return { min: new V3(x - sx / 2, y - sy / 2, z - sz / 2), max: new V3(x + sx / 2, y + sy / 2, z + sz / 2) };
}
export function solidBox(x, y, z, sx, sy, sz, o) {
    const c = aabb(x, y, z, sx, sy, sz);
    Object.assign(c, { mat: 'block' }, o || {});
    solids.push(c);
    return c;
}

// ----- static batching -----
// Boxes with world-space UVs (a texture tile every `tile` studs on every face), merged per
// material into a few big meshes. Any other static geometry can be added with batchGeo().
const batches = new Map();
function bucket(material, cast) {
    const k = material.uuid + '|' + (cast ? 1 : 0);
    let b = batches.get(k);
    if (!b) { b = { material, cast, pos: [], nrm: [], uv: [], idx: [], geos: [] }; batches.set(k, b); }
    return b;
}
const FACES = [
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
// o: { tile (studs per texture repeat, default 8), cast, skip (face indices to drop) }
export function batchBox(material, x, y, z, sx, sy, sz, o) {
    o = o || {};
    const b = bucket(material, o.cast);
    const tile = o.tile || 8, half = [sx / 2, sy / 2, sz / 2], c = [x, y, z];
    FACES.forEach((f, fi) => {
        if (o.skip && o.skip.includes(fi)) return;
        const base = b.pos.length / 3;
        for (const [a, bb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const p = [0, 0, 0];
            for (let k = 0; k < 3; k++) p[k] = c[k] + f.n[k] * half[k] + f.u[k] * a * half[k] + f.v[k] * bb * half[k];
            b.pos.push(p[0], p[1], p[2]);
            b.nrm.push(f.n[0], f.n[1], f.n[2]);
            const U = p[0] * f.u[0] + p[1] * f.u[1] + p[2] * f.u[2], Vv = p[0] * f.v[0] + p[1] * f.v[1] + p[2] * f.v[2];
            b.uv.push(U / tile, Vv / tile);
        }
        b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
}
// Any geometry already positioned in world space
export function batchGeo(material, geo, cast) {
    const b = bucket(material, cast);
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    if (!geo.attributes.uv) geo.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    b.geos.push(geo);
}
export function flushBatches(parent) {
    for (const b of batches.values()) {
        const parts = [];
        if (b.pos.length) {
            const g = new T.BufferGeometry();
            g.setAttribute('position', new T.Float32BufferAttribute(b.pos, 3));
            g.setAttribute('normal', new T.Float32BufferAttribute(b.nrm, 3));
            g.setAttribute('uv', new T.Float32BufferAttribute(b.uv, 2));
            g.setIndex(b.idx);
            parts.push(g);
        }
        parts.push(...b.geos);
        if (!parts.length) continue;
        const merged = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
        merged.computeBoundingSphere();
        const mesh = new T.Mesh(merged, b.material);
        mesh.receiveShadow = true;
        mesh.castShadow = !!b.cast;
        mesh.matrixAutoUpdate = false;
        (parent || scene).add(mesh);
    }
    batches.clear();
}

// ----- text -----
// bg: draws the lines on a rounded "pill" of that colour (readable from far away)
export function textCanvas(lines, W, bg) {
    const pad = bg ? 18 : 10;
    let H = pad * 2;
    for (const l of lines) H += l.px * 1.2;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = Math.ceil(H);
    const x = cv.getContext('2d');
    const font = (l, p) => `${l.w || 700} ${p}px ${l.f || 'Fredoka'}, "Arial Rounded MT Bold", sans-serif`;
    const fitted = lines.map((l) => {
        let px = l.px;
        x.font = font(l, px);
        while (x.measureText(l.t).width > W - (bg ? 64 : 24) && px > 8) { px -= 2; x.font = font(l, px); }
        return { px, w: x.measureText(l.t).width };
    });
    if (bg) {
        const bw = Math.min(W - 4, Math.max(...fitted.map((f) => f.w)) + 56), r = Math.min(34, (H - 4) / 2);
        const X = (W - bw) / 2, Y = 2, bh = H - 4;
        x.beginPath();
        x.moveTo(X + r, Y); x.arcTo(X + bw, Y, X + bw, Y + bh, r); x.arcTo(X + bw, Y + bh, X, Y + bh, r); x.arcTo(X, Y + bh, X, Y, r); x.arcTo(X, Y, X + bw, Y, r);
        x.closePath();
        x.fillStyle = bg; x.fill();
        x.lineWidth = 4; x.strokeStyle = 'rgba(255,255,255,0.35)'; x.stroke();
    }
    let y = pad;
    lines.forEach((l, li) => {
        const px = fitted[li].px;
        x.font = font(l, px);
        x.textAlign = 'center'; x.textBaseline = 'middle';
        const cy = y + l.px * 0.62;
        if (l.s) { x.lineJoin = 'round'; x.lineWidth = Math.max(4, px * 0.22); x.strokeStyle = l.s; x.strokeText(l.t, W / 2, cy); }
        if (l.g) {
            const g = x.createLinearGradient(0, cy - px / 2, 0, cy + px / 2);
            g.addColorStop(0, l.g[0]); g.addColorStop(1, l.g[1]);
            x.fillStyle = g;
        } else x.fillStyle = l.c || '#fff';
        x.fillText(l.t, W / 2, cy);
        y += l.px * 1.2;
    });
    return cv;
}
export function billboard(lines, worldW, W, pos, parent, bg) {
    W = W || 512;
    const cv = textCanvas(lines, W, bg);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: texFrom(cv), transparent: true, depthWrite: false, toneMapped: false }));
    sp.scale.set(worldW, worldW * cv.height / cv.width, 1);
    if (pos) sp.position.copy(pos);
    sp.userData.set = (nl) => {
        const c2 = textCanvas(nl, W, bg);
        sp.material.map.dispose();
        sp.material.map = texFrom(c2);
        sp.material.needsUpdate = true;
        sp.scale.set(worldW, worldW * c2.height / c2.width, 1);
    };
    (parent || scene).add(sp);
    return sp;
}

// ----- blocky fallback body (used until / unless the Bloxity avatar loads) -----
function buildHair(part, c) {
    part(1.3, 0.35, 1.3, 0, 5.33, -0.02, c);
    part(1.3, 0.75, 0.3, 0, 4.95, -0.5, c);
    part(1.3, 0.16, 0.2, 0, 5.16, 0.56, c);
}
export function buildRig(d, material) {
    const g = new T.Group();
    const part = (sx, sy, sz, x, y, z, c, parent) => {
        const m = new T.Mesh(UNIT, material || mat(c)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true; (parent || g).add(m); return m;
    };
    part(2, 2, 1, 0, 3, 0, d.shirt);
    part(2.02, 0.12, 1.02, 0, 2.06, 0, d.shorts);
    const head = new T.Group(); g.add(head);
    part(1.2, 1.2, 1.2, 0, 4.6, 0, d.skin, head);
    if (!material) {
        for (const sx of [-0.26, 0.26]) {
            part(0.26, 0.24, 0.04, sx, 4.72, 0.605, 0xffffff, head);
            part(0.13, 0.18, 0.04, sx + (sx > 0 ? -0.04 : 0.04), 4.71, 0.625, 0x1a1420, head);
        }
        part(0.36, 0.07, 0.04, 0, 4.34, 0.64, 0x6b2a2a, head);
    }
    buildHair((sx, sy, sz, x, y, z, c) => part(sx, sy, sz, x, y, z, c, head), d.hair);
    const legs = [], arms = [];
    for (const side of [-0.5, 0.5]) {
        const p = new T.Group(); p.position.set(side, 2, 0); g.add(p);
        part(1, 0.9, 1, 0, -0.45, 0, d.shorts, p);
        part(0.98, 1.1, 0.98, 0, -1.45, 0, d.socks, p);
        part(1.05, 0.42, 1.34, 0, -1.84, 0.12, 0x141418, p);
        legs.push(p);
    }
    for (const side of [-1.5, 1.5]) {
        const p = new T.Group(); p.position.set(side, 3.9, 0); g.add(p);
        part(1, 0.8, 1, 0, -0.4, 0, d.shirt, p);
        part(0.98, 1.2, 0.98, 0, -1.4, 0, d.skin, p);
        arms.push(p);
    }
    g.userData.legs = legs; g.userData.arms = arms; g.userData.head = head;
    return g;
}
export function animRig(g, phase, amt) {
    const s = Math.sin(phase) * amt;
    const u = g.userData;
    u.legs[0].rotation.set(s, 0, 0); u.legs[1].rotation.set(-s, 0, 0);
    u.arms[0].rotation.set(-s * 0.9, 0, 0); u.arms[1].rotation.set(s * 0.9, 0, 0);
    u.head.rotation.set(0, 0, 0);
}
export function airPose(g) {
    const u = g.userData;
    u.legs[0].rotation.set(0.5, 0, 0); u.legs[1].rotation.set(-0.3, 0, 0);
    u.arms[0].rotation.set(-2.6, 0, 0); u.arms[1].rotation.set(-2.6, 0, 0);
}
// Victory dances as joint angles: [armL x, armL z, armR x, armR z, legL x, legR x, head z, bounce]
export function dancePose(id, t) {
    const s = Math.sin(t * 6), c = Math.cos(t * 6), s2 = Math.sin(t * 12), slow = Math.sin(t * 3);
    switch (id) {
        case 'wave': return [0, 0, -2.6, -0.4 + s * 0.5, 0, 0, slow * 0.1, 0];
        case 'cheer': return [-2.8 + s2 * 0.25, 0.3, -2.8 - s2 * 0.25, -0.3, 0, 0, 0, Math.abs(s2) * 0.6];
        case 'laugh': return [-0.4, 0.6 + s2 * 0.2, -0.4, -0.6 - s2 * 0.2, 0, 0, s2 * 0.15, Math.abs(s2) * 0.15];
        case 'groove': return [-1.2 + s * 0.6, 0.2, -1.2 - s * 0.6, -0.2, s * 0.4, -s * 0.4, s * 0.2, Math.abs(s) * 0.3];
        case 'shuffle': return [-0.6 - c * 0.5, 0.4, -0.6 + c * 0.5, -0.4, Math.max(0, s) * 0.9, Math.max(0, -s) * 0.9, 0, Math.abs(s2) * 0.35];
        case 'tornado': return [-1.6, 1.2, -1.6, -1.2, 0.2, -0.2, 0, Math.abs(s) * 0.3];
        default: return [-2.2 + s * 0.7, 0.3, -0.4 - s * 0.7, -0.3, Math.max(0, s) * 0.5, Math.max(0, -s) * 0.5, s * 0.12, Math.abs(s) * 0.4];
    }
}
export function dancePoseRig(g, id, t) {
    const p = dancePose(id, t), u = g.userData;
    u.arms[0].rotation.set(p[0], 0, p[1]); u.arms[1].rotation.set(p[2], 0, p[3]);
    u.legs[0].rotation.set(-p[4], 0, 0); u.legs[1].rotation.set(-p[5], 0, 0);
    u.head.rotation.set(0, 0, p[6]);
    return p[7];
}

// ----- floating text -----
const floaters = [];
export function floatText(text, color, pos, size) {
    const sp = billboard([{ t: text, c: color, s: '#1a2a40', px: 70 }], size || 5, 512, pos);
    sp.material.depthTest = false; sp.renderOrder = 12;
    floaters.push({ sp, t: 1.2 });
}
export function updateEffects(dt) {
    for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.t -= dt; f.sp.position.y += dt * 4; f.sp.material.opacity = Math.min(1, f.t * 2);
        if (f.t <= 0) { scene.remove(f.sp); f.sp.material.map.dispose(); f.sp.material.dispose(); floaters.splice(i, 1); }
    }
}

export function lerpAngle(a, b, k) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * k;
}

// Merges every mesh under root into one mesh per material (static props): many draw calls become few
export function mergeChildren(root) {
    root.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(root.matrixWorld).invert(), m4 = new T.Matrix4();
    const buckets = new Map(), done = [];
    root.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || Array.isArray(o.material) || o.userData.keep) return;
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.uv) g.setAttribute('uv', new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
        if (!buckets.has(o.material)) buckets.set(o.material, { list: [], shadow: false });
        const b = buckets.get(o.material);
        b.list.push(g); b.shadow = b.shadow || o.castShadow;
        done.push(o);
    });
    for (const o of done) o.parent.remove(o);
    for (const [material, b] of buckets) {
        const hasColor = b.list.some((g) => g.attributes.color);
        if (hasColor) for (const g of b.list) if (!g.attributes.color) g.setAttribute('color', new T.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
        const mesh = new T.Mesh(mergeGeometries(b.list), material);
        mesh.castShadow = b.shadow;
        mesh.receiveShadow = true;
        root.add(mesh);
        for (const g of b.list) g.dispose();
    }
}
