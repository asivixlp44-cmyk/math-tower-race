import { T, V3, renderer, scene, camera, sun } from './engine.js';

// ----- quality presets -----
// There is no post-processing at all: the colour grade lives in the tone mapping (engine.js), the
// vignette is a CSS overlay and the canvas has the browser's own MSAA. That keeps every frame a
// single scene render. budget: the most pixels a frame may have, so big / dense screens don't
// render millions of pixels more than a laptop GPU can fill.
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
export const QUALITIES = {
    low: { label: 'Low', ratio: 1, budget: 1.3e6, shadows: false, shadowMap: 512 },
    medium: { label: 'Medium', ratio: 1, budget: 2.1e6, shadows: true, shadowMap: 1024 },
    high: { label: 'High', ratio: 1.5, budget: 3.6e6, shadows: true, shadowMap: 2048 },
};
// Weak GPUs (integrated / mobile / software) start on Medium
const weakGpu = (() => {
    try {
        const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
        const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        return /intel|uhd|iris|mali|adreno|powervr|swiftshader|llvmpipe|basic render|microsoft/i.test(name);
    } catch (e) { return false; }
})();
let quality = isTouch || weakGpu ? 'low' : 'medium', chosen = false;
// Only the player's own choice is stored (v2: older builds also stored automatic step-downs, which
// left some players stuck on Low for good)
try { const q = localStorage.getItem('mtr_quality_v2'); if (q) { quality = q; chosen = true; } } catch (e) { /* default */ }
if (!QUALITIES[quality]) quality = 'medium';

// No tone mapping or grade, like Bloxity's top games: colours go to the screen as lit
renderer.toneMapping = T.NoToneMapping;
renderer.toneMappingExposure = 1.0;

// A soft vignette, drawn by the browser over the canvas (costs the GPU nothing per frame)
{
    const v = document.createElement('div');
    v.id = 'vignette';
    v.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at 50% 48%, rgba(10,20,40,0) 60%, rgba(10,20,40,0.2) 100%);';
    const view = renderer.domElement;
    view.parentNode.insertBefore(v, view.nextSibling);
}

function pixelRatio() {
    const q = QUALITIES[quality];
    return Math.max(0.5, Math.min(devicePixelRatio || 1, q.ratio, Math.sqrt(q.budget / Math.max(1, innerWidth * innerHeight))));
}
let appliedQuality = null;
function applyQuality() {
    const q = QUALITIES[quality];
    if (appliedQuality === quality) return;
    appliedQuality = quality;
    renderer.setPixelRatio(pixelRatio());
    // Shadows stay on as far as the shaders know (turning them off would recompile every shader);
    // Low fades them to nothing and skips the shadow pass instead
    renderer.shadowMap.enabled = true;
    sun.castShadow = true;
    sun.shadow.intensity = q.shadows ? 1 : 0;
    renderer.shadowMap.autoUpdate = q.shadows;
    if (sun.shadow.mapSize.x !== q.shadowMap) {
        sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
        if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    if (!q.shadows) renderer.shadowMap.needsUpdate = true;
}
addEventListener('resize', () => renderer.setPixelRatio(pixelRatio()));
export function getQuality() { return quality; }
// auto: a step down made by the frame-rate watcher (main.js); anything else is the player's choice
let autoAllowed = !chosen;
export const autoQualityAllowed = () => autoAllowed;
export function setQuality(q, auto) {
    if (!QUALITIES[q]) return;
    if (!auto) {
        autoAllowed = false;
        try { localStorage.setItem('mtr_quality_v2', q); } catch (e) { /* ignore */ }
    }
    quality = q;
    applyQuality();
}
export const lowQuality = () => quality === 'low';

export function render() {
    renderer.render(scene, camera);
}

// ----- particles (dust, sparkles, fireworks, confetti, flames, smoke, embers) -----
// All of them live in two point clouds (one additive, one normal blend): two draw calls in total,
// no materials or objects created per particle.
const atlasTex = (() => {
    const c = document.createElement('canvas'); c.width = 192; c.height = 64;
    const x = c.getContext('2d');
    // 0: a soft round puff
    let g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.4, 'rgba(255,255,255,0.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    // 1: a four-point star
    g = x.createRadialGradient(96, 32, 0, 96, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath();
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, r = k % 2 ? 7 : 31; x.lineTo(96 + Math.cos(a) * r, 32 + Math.sin(a) * r); }
    x.closePath(); x.fill();
    // 2: a confetti rectangle
    x.fillStyle = '#fff'; x.fillRect(128 + 12, 22, 40, 20);
    const t = new T.CanvasTexture(c);
    t.minFilter = T.LinearFilter; t.generateMipmaps = false;
    return t;
})();
const PT_VERT = `attribute vec4 aCol; attribute vec3 aMisc; uniform float uScale;
    varying vec4 vCol; varying float vTex; varying float vRot;
    void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min(aMisc.x * uScale / max(0.2, -mv.z), 512.0);
        vCol = aCol; vTex = aMisc.y; vRot = aMisc.z;
    }`;
const PT_FRAG = `uniform sampler2D uMap; varying vec4 vCol; varying float vTex; varying float vRot;
    void main() {
        vec2 p = gl_PointCoord - 0.5;
        float c = cos(vRot), s = sin(vRot);
        p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
        if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
        vec4 t = texture2D(uMap, vec2((vTex + p.x) / 3.0, 1.0 - p.y));
        float a = t.a * vCol.a;
        if (a < 0.004) discard;
        gl_FragColor = vec4(vCol.rgb * t.rgb, a);
    }`;
const ptUniforms = { uMap: { value: atlasTex }, uScale: { value: 1 } };
class Cloud {
    constructor(additive, cap) {
        this.cap = cap; this.list = [];
        this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 4); this.misc = new Float32Array(cap * 3);
        const g = new T.BufferGeometry();
        this.aPos = new T.BufferAttribute(this.pos, 3).setUsage(T.DynamicDrawUsage);
        this.aCol = new T.BufferAttribute(this.col, 4).setUsage(T.DynamicDrawUsage);
        this.aMisc = new T.BufferAttribute(this.misc, 3).setUsage(T.DynamicDrawUsage);
        g.setAttribute('position', this.aPos); g.setAttribute('aCol', this.aCol); g.setAttribute('aMisc', this.aMisc);
        g.setDrawRange(0, 0);
        this.points = new T.Points(g, new T.ShaderMaterial({
            uniforms: ptUniforms, vertexShader: PT_VERT, fragmentShader: PT_FRAG,
            transparent: true, depthWrite: false, blending: additive ? T.AdditiveBlending : T.NormalBlending,
        }));
        this.points.frustumCulled = false;
        this.points.renderOrder = additive ? 6 : 5;
        scene.add(this.points);
    }
}
const clouds = { add: new Cloud(true, 1400), normal: new Cloud(false, 900) };
// colours are written as display (sRGB) values: the point shader does no colour conversion
const rgbOf = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
function spawn(pos, vel, color, size, life, opts) {
    opts = opts || {};
    const cl = opts.add ? clouds.add : clouds.normal;
    if (cl.list.length >= cl.cap) return;
    const k = opts.hdr || 1, [r, g, b] = rgbOf(color);
    cl.list.push({
        x: pos.x, y: pos.y, z: pos.z, vx: vel.x, vy: vel.y, vz: vel.z, r: r * k, g: g * k, b: b * k,
        life, max: life, grow: opts.grow || 0, grav: opts.grav || 0, drag: opts.drag || 0, size, fade0: opts.opacity || 1,
        tex: opts.conf ? 2 : opts.star ? 1 : 0, rot: opts.conf ? Math.random() * Math.PI : 0, spin: opts.conf ? 6 : 0,
    });
}
function updateCloud(cl, dt) {
    const L = cl.list;
    let n = 0;
    for (let i = 0; i < L.length; i++) {
        const p = L[i];
        p.life -= dt;
        if (p.life <= 0) continue;
        p.vy -= p.grav * dt;
        if (p.drag) { const f = Math.exp(-p.drag * dt); p.vx *= f; p.vy *= f; p.vz *= f; }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rot += p.spin * dt;
        const k = p.life / p.max;
        L[n] = p;
        cl.pos[n * 3] = p.x; cl.pos[n * 3 + 1] = p.y; cl.pos[n * 3 + 2] = p.z;
        cl.col[n * 4] = p.r; cl.col[n * 4 + 1] = p.g; cl.col[n * 4 + 2] = p.b; cl.col[n * 4 + 3] = p.fade0 * Math.min(1, k * 2);
        cl.misc[n * 3] = p.grow ? Math.max(0.05, p.size * (1 + p.grow * (1 - k))) : p.size;
        cl.misc[n * 3 + 1] = p.tex; cl.misc[n * 3 + 2] = p.rot;
        n++;
    }
    L.length = n;
    cl.points.geometry.setDrawRange(0, n);
    if (n) {
        cl.aPos.clearUpdateRanges(); cl.aPos.addUpdateRange(0, n * 3); cl.aPos.needsUpdate = true;
        cl.aCol.clearUpdateRanges(); cl.aCol.addUpdateRange(0, n * 4); cl.aCol.needsUpdate = true;
        cl.aMisc.clearUpdateRanges(); cl.aMisc.addUpdateRange(0, n * 3); cl.aMisc.needsUpdate = true;
    }
    cl.points.visible = n > 0;
}
export function dust(pos, n, strength, color) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = (2 + Math.random() * 4) * strength;
        spawn(new V3(pos.x + Math.cos(a) * 0.6, pos.y + 0.3, pos.z + Math.sin(a) * 0.6), new V3(Math.cos(a) * sp, 1.5 + Math.random() * 2, Math.sin(a) * sp),
            color || 0xffffff, 0.55 + Math.random() * 0.4, 0.35 + Math.random() * 0.2, { grow: 1.6, drag: 3.5, opacity: 0.45 });
    }
}
export function sparkleColumn(pos, color) {
    for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, r = 1.8 + Math.random() * 1.2;
        spawn(new V3(pos.x + Math.cos(a) * r, pos.y + Math.random() * 2, pos.z + Math.sin(a) * r), new V3(0, 7 + Math.random() * 8, 0),
            color, 0.4 + Math.random() * 0.35, 0.7 + Math.random() * 0.4, { add: true, hdr: 1.6, drag: 0.6, star: true });
    }
}
// A burst on a new block (Sparkle / Inferno block animations)
export function blockBurst(pos, kind) {
    for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 6;
        if (kind === 'fire') spawn(pos, new V3(Math.cos(a) * sp * 0.6, 3 + Math.random() * 6, Math.sin(a) * sp * 0.6), Math.random() < 0.5 ? 0xff6a14 : 0xffc81c, 1.1, 0.5, { add: true, hdr: 1.5, grow: -0.5, drag: 2 });
        else spawn(pos, new V3(Math.cos(a) * sp, (Math.random() - 0.3) * 6, Math.sin(a) * sp), i % 2 ? 0xfff6c8 : 0xa8e0ff, 0.5, 0.6, { add: true, hdr: 1.8, drag: 2.5, star: true });
    }
}

// Expanding ring on the ground (unlocks, landing on your tower)
const rings = [];
const ringGeo = new T.RingGeometry(0.8, 1, 48);
export function ring(pos, color, maxR, life) {
    const m = new T.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: T.DoubleSide });
    m.color.multiplyScalar(2.2);
    const mesh = new T.Mesh(ringGeo, m);
    mesh.rotation.x = -Math.PI / 2; mesh.position.copy(pos).setY(pos.y + 0.2);
    scene.add(mesh);
    rings.push({ mesh, t: 0, life: life || 0.7, maxR: maxR || 9 });
}

// Fireworks: a glowing rocket that bursts into coloured sparks
const rockets = [];
const FW_COLORS = [0xffd028, 0x46ec50, 0x28c8ff, 0xff3fa0, 0xc428ff, 0xff6e14];
export function fireworks(center, count, onBurst) {
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 10;
        rockets.push({
            p: new V3(center.x + Math.cos(a) * r, center.y + 1, center.z + Math.sin(a) * r),
            v: new V3((Math.random() * 2 - 1) * 3, 34 + Math.random() * 10, (Math.random() * 2 - 1) * 3),
            t: 0.7 + Math.random() * 0.3 + i * 0.18, trail: 0, color: FW_COLORS[(Math.random() * FW_COLORS.length) | 0], onBurst,
        });
    }
}
function burstFw(p, color) {
    for (let i = 0; i < 46; i++) {
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
        const sp = 16 + Math.random() * 8;
        spawn(p, new V3(s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp), i % 5 ? color : 0xffffff, 0.9 + Math.random() * 0.5, 1.1 + Math.random() * 0.5, { add: true, hdr: 2.5, grav: 14, drag: 1.4, star: i % 4 === 0 });
    }
}
// Confetti raining from above a point (winning, unlocking, the chest)
export function confetti(pos, n) {
    for (let i = 0; i < (n || 60); i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 5;
        spawn(new V3(pos.x + Math.cos(a) * r, pos.y + 7 + Math.random() * 3, pos.z + Math.sin(a) * r),
            new V3(Math.cos(a) * (3 + Math.random() * 8), 6 + Math.random() * 10, Math.sin(a) * (3 + Math.random() * 8)),
            FW_COLORS[i % FW_COLORS.length], 0.7 + Math.random() * 0.4, 2.2 + Math.random(), { conf: true, grav: 16, drag: 1.6 });
    }
}

const trailVel = new V3(0, -2, 0);
export function updateFx(dt) {
    ptUniforms.uScale.value = renderer.domElement.height * camera.projectionMatrix.elements[5] * 0.5;
    updateCloud(clouds.add, dt);
    updateCloud(clouds.normal, dt);
    for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.t += dt;
        const k = r.t / r.life;
        if (k >= 1) { scene.remove(r.mesh); r.mesh.material.dispose(); rings.splice(i, 1); continue; }
        const e = 1 - Math.pow(1 - k, 3);
        r.mesh.scale.setScalar(1 + e * r.maxR);
        r.mesh.material.opacity = 1 - k;
    }
    for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i];
        r.v.y -= 20 * dt;
        r.p.addScaledVector(r.v, dt);
        r.trail -= dt;
        if (r.trail <= 0) { r.trail = 0.03; spawn(r.p, trailVel, 0xffe7a8, 0.7, 0.35, { add: true, hdr: 2 }); }
        r.t -= dt;
        if (r.t <= 0) { burstFw(r.p, r.color); if (r.onBurst) r.onBurst(); rockets.splice(i, 1); }
    }
}

// Coin / gem pickup: a burst of purple stars
export function gemBurst(pos) {
    for (let i = 0; i < 14; i++) {
        const a = Math.random() * Math.PI * 2, u = Math.random();
        spawn(pos, new V3(Math.cos(a) * 7 * u, 4 + Math.random() * 6, Math.sin(a) * 7 * u), i % 3 ? 0xc46cff : 0xffffff, 0.45, 0.6, { add: true, hdr: 1.8, grav: 14, drag: 1.2, star: i % 2 === 0 });
    }
}
// Burning: flames and smoke on an eliminated player / tower
const tmpP = new V3(), tmpV = new V3();
export function flame(at, spread, size, vel) {
    tmpP.set(at.x + (Math.random() - 0.5) * spread, at.y + (Math.random() - 0.5) * spread * 0.5, at.z + (Math.random() - 0.5) * spread);
    if (vel) tmpV.copy(vel).multiplyScalar(0.7 + Math.random() * 0.6); else tmpV.set(0, 0, 0);
    tmpV.x += (Math.random() - 0.5) * 3; tmpV.y += 3 + Math.random() * 5; tmpV.z += (Math.random() - 0.5) * 3;
    spawn(tmpP, tmpV, Math.random() < 0.45 ? 0xff5a14 : Math.random() < 0.6 ? 0xffb51c : 0xfff0a0,
        (size || 1.4) * (0.7 + Math.random() * 0.6), 0.45 + Math.random() * 0.35, { add: true, hdr: 1.3, grow: -0.5, drag: 1.5, opacity: 0.95 });
}
export function smoke(at, size) {
    tmpP.set(at.x + (Math.random() - 0.5) * 2, at.y, at.z + (Math.random() - 0.5) * 2);
    tmpV.set((Math.random() - 0.5) * 2, 4 + Math.random() * 3, (Math.random() - 0.5) * 2);
    spawn(tmpP, tmpV, 0x3a3236, (size || 2) * (0.7 + Math.random() * 0.5), 1.4, { grow: 1.8, drag: 0.8, opacity: 0.5 });
}
// Lava embers drifting up from the surface
export function ember(at) {
    tmpV.set((Math.random() - 0.5) * 2, 3 + Math.random() * 5, (Math.random() - 0.5) * 2);
    spawn(at, tmpV, Math.random() < 0.5 ? 0xff7a1c : 0xffd23c, 0.35 + Math.random() * 0.35, 1.2 + Math.random() * 1.2, { add: true, hdr: 1.6, drag: 0.4 });
}
// Nuke: a blinding flash and a mushroom of sparks
export function nukeFx(pos) {
    for (let i = 0; i < 90; i++) {
        const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u), sp = 14 + Math.random() * 26;
        spawn(tmpP.set(pos.x, pos.y + 3, pos.z), new V3(s * Math.cos(th) * sp, Math.abs(u) * sp + 8, s * Math.sin(th) * sp), Math.random() < 0.5 ? 0xffe03a : Math.random() < 0.5 ? 0xff6a14 : 0xc8ff2a,
            2 + Math.random() * 1.5, 1.2 + Math.random() * 0.6, { add: true, hdr: 2.2, grav: 6, drag: 1.2, grow: 1.5 });
    }
    for (let i = 0; i < 30; i++) smoke(new V3(pos.x + (Math.random() - 0.5) * 20, pos.y + Math.random() * 10, pos.z + (Math.random() - 0.5) * 20), 6);
}

applyQuality();
