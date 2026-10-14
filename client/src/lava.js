// The lava: a cartoon column filling the pit, rising after every round. Like the reference it is
// bright yellow with big orange spots (darker orange rims, a pale halo), drifting and wobbling
// slowly, with foam along the walls and bubbles that swell and pop. The level comes from the room
// state (lava / lavaFrom / lavaAt / lavaDur, in blocks) so every client sees the same rise.
//
// Speed: the spot pattern is baked once into a small tiling "distance field" texture. Each frame
// the lava only reads it (warped a little so the spots wobble) and turns the distances into crisp
// edges, instead of working out the cells for every pixel.
import { T, V3, scene, renderer, GRADE_GLSL, lavaGlowY } from './engine.js';
import { ember } from './fx.js';
import { PIT, lavaY } from '../../shared/arena.js';
import { clamp } from '../../shared/config.js';

const HEIGHT = 700;   // tall enough that the sides always reach below the floor
const W = PIT.x * 2 - 0.4, D = PIT.z * 2 - 0.4;
const CELLS = 6;      // spot cells across one tile of the baked texture

// ----- the baked field: R = big spots, G = little spots (signed distance to the spot's edge,
// 0.5 = the edge, brighter = inside), B = a soft noise for the base colour -----
const field = (() => {
    const rt = new T.WebGLRenderTarget(512, 512, { generateMipmaps: true, minFilter: T.LinearMipmapLinearFilter, magFilter: T.LinearFilter, wrapS: T.RepeatWrapping, wrapT: T.RepeatWrapping });
    rt.texture.wrapS = rt.texture.wrapT = T.RepeatWrapping;
    const mat = new T.ShaderMaterial({
        uniforms: { uP: { value: CELLS } },
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `uniform float uP; varying vec2 vUv;
            vec2 h22(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
            float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
            // nearest cell centre (tiling every P cells) and that cell's random size
            vec2 cells(vec2 p, float P, float seed) {
                vec2 i = floor(p), f = fract(p);
                float md = 9.0, rr = 0.0;
                for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
                    vec2 g = vec2(float(x), float(y));
                    vec2 id = mod(i + g, P) + seed;
                    vec2 c = g + 0.5 + 0.64 * (h22(id) - 0.5) - f;
                    float dd = dot(c, c);
                    if (dd < md) { md = dd; rr = h21(id + 3.7); }
                }
                return vec2(sqrt(md), rr);
            }
            float vnoise(vec2 p, float P) {
                vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
                float a = h21(mod(i, P)), b = h21(mod(i + vec2(1, 0), P)), c = h21(mod(i + vec2(0, 1), P)), d = h21(mod(i + vec2(1, 1), P));
                return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
            }
            void main() {
                vec2 p = vUv * uP;
                vec2 c = cells(p, uP, 0.0);
                float big = c.y < 0.18 ? -0.33 : (0.17 + 0.23 * c.y) - c.x;
                vec2 c2 = cells(p * 2.0 + 0.37, uP * 2.0, 17.0);
                float small = c2.y > 0.55 ? (0.14 + 0.08 * c2.y) - c2.x : -0.33;
                float n = vnoise(vUv * 3.0, 3.0) * 0.6 + vnoise(vUv * 6.0, 6.0) * 0.4;
                gl_FragColor = vec4(clamp(0.5 + big * 1.5, 0.0, 1.0), clamp(0.5 + small * 1.5, 0.0, 1.0), n, 1.0);
            }`,
    });
    const quad = new T.Mesh(new T.PlaneGeometry(2, 2), mat);
    const bakeScene = new T.Scene(); bakeScene.add(quad);
    const cam = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(bakeScene, cam);
    renderer.setRenderTarget(prev);
    mat.dispose(); quad.geometry.dispose();
    return rt.texture;
})();

const lavaMat = new T.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uHalf: { value: new T.Vector2(W / 2, D / 2) }, uField: { value: field } },
    vertexShader: `varying vec3 vPos; varying vec3 vNrm;
        void main() { vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz; vNrm = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec2 uHalf; uniform sampler2D uField; varying vec3 vPos; varying vec3 vNrm;
        ${GRADE_GLSL}
        void main() {
            bool top = vNrm.y > 0.5;
            float t = uTime;
            // in tiles of the baked field: drifting, with a gentle wobble
            vec2 p = (top ? vPos.xz : (abs(vNrm.x) > 0.5 ? vPos.zy : vPos.xy)) * ${(0.055 / CELLS).toFixed(5)};
            p += vec2(t * 0.003, t * 0.0018);
            p += 0.012 * vec2(sin(p.y * 31.4 + t * 0.7), cos(p.x * 27.0 - t * 0.6));
            vec4 fs = texture2D(uField, p);
            float f = (fs.r - 0.5) / 1.5, f2 = (fs.g - 0.5) / 1.5;
            float aa = max(fwidth(f) * 0.9, 0.003);
            float spot = smoothstep(-aa, aa, f);
            float rim = spot * (1.0 - smoothstep(0.075 - aa, 0.075 + aa, f));
            float halo = (1.0 - spot) * smoothstep(-0.05 - aa, -0.05 + aa, f);
            float aa2 = max(fwidth(f2) * 0.9, 0.003);
            float spot2 = smoothstep(-aa2, aa2, f2) * (1.0 - halo) * (1.0 - spot);

            vec3 base = mix(vec3(1.0, 0.80, 0.20), vec3(1.0, 0.89, 0.36), fs.b);
            vec3 col = mix(base, vec3(1.0, 0.95, 0.62), halo * 0.75);
            vec3 fill = mix(vec3(1.0, 0.60, 0.11), vec3(1.0, 0.68, 0.16), smoothstep(0.0, 0.2, f));
            col = mix(col, fill, spot);
            col = mix(col, vec3(0.93, 0.42, 0.06), rim);
            col = mix(col, vec3(1.0, 0.62, 0.12), spot2);
            // foam where the lava meets the walls
            if (top) {
                float edge = min(uHalf.x - abs(vPos.x), uHalf.y - abs(vPos.z));
                float foam = 1.0 - smoothstep(0.0, 1.6 + 0.6 * sin(t * 2.0 + (vPos.x + vPos.z) * 0.4), edge);
                col = mix(col, vec3(1.0, 0.97, 0.7), foam * 0.85);
            } else col *= 0.86;
            col *= 1.0 + 0.05 * sin(t * 1.7 + f * 40.0);
            gl_FragColor = vec4(mtrGrade(pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2))), 1.0);
        }`,
    toneMapped: false,
});
const column = new T.Mesh(new T.BoxGeometry(W, HEIGHT, D), lavaMat);
column.frustumCulled = false;
scene.add(column);

// bubbles: orange domes that swell up and pop
const bubbleGeo = new T.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const bubbleMat = new T.MeshBasicMaterial({ color: 0xffa623, toneMapped: false });
const bubbles = [];
for (let i = 0; i < 10; i++) {
    const m = new T.Mesh(bubbleGeo, bubbleMat);
    m.visible = false;
    scene.add(m);
    bubbles.push({ m, t: 0, life: 0, size: 1, x: 0, z: 0, wait: Math.random() * 3 });
}

let level = 0;
export const lavaLevel = () => level;
export const lavaSurfaceY = () => lavaY(level);
const tmp = new V3();

// st: the room state; now: server ms
export function updateLava(st, now, dt, t) {
    lavaMat.uniforms.uTime.value = t;
    if (st) {
        const k = st.lavaDur > 0 ? clamp((now - st.lavaAt) / (st.lavaDur * 1000), 0, 1) : 1;
        const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        // never below the pit floor: between games the lava rests at the bottom instead of draining away
        level = Math.max(0, st.lavaFrom + (st.lava - st.lavaFrom) * e);
    }
    // drawn a little above its level so a flooded floor never z-fights with the pit floor
    const top = lavaY(level) + 0.25;
    column.position.y = top - HEIGHT / 2;
    lavaGlowY.value = top;
    for (const b of bubbles) {
        if (b.life <= 0) {
            b.wait -= dt;
            if (b.wait > 0) { b.m.visible = false; continue; }
            b.x = (Math.random() - 0.5) * (W - 6); b.z = (Math.random() - 0.5) * (D - 6);
            b.size = 0.7 + Math.random() * 1.3; b.life = 1.2 + Math.random(); b.t = 0; b.wait = 0.3 + Math.random() * 2.5;
        }
        b.t += dt;
        const k = b.t / b.life;
        if (k >= 1) {
            b.life = 0; b.m.visible = false;
            for (let i = 0; i < 3; i++) ember(tmp.set(b.x + (Math.random() - 0.5) * b.size, top + 0.4, b.z + (Math.random() - 0.5) * b.size));
            continue;
        }
        const s = b.size * (0.3 + 0.7 * Math.sin(Math.min(1, k * 1.15) * Math.PI / 2));
        b.m.visible = true;
        b.m.position.set(b.x, top - 0.05, b.z);
        b.m.scale.set(s, s * (0.55 + 0.15 * Math.sin(b.t * 9)), s);
    }
    // embers
    if (Math.random() < dt * 24) ember(tmp.set((Math.random() - 0.5) * W, top + 0.3, (Math.random() - 0.5) * D));
}
// Is a lava rise happening right now (for the rumble sound)?
export const lavaRising = (st, now) => !!st && st.lavaDur > 0.5 && now - st.lavaAt < st.lavaDur * 1000 && st.lava > st.lavaFrom + 0.01;
