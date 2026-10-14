// HUD and panels: the status line and announcements, Gems, the side tiles (Select, +10 Blocks!,
// Nuke!, Watch, Pets, Settings, Review), Dance, the reaction bar, placements, the win / out
// banners, and every panel: Select (tower skins, block animations, victory dances), Pets (and
// eggs), Settings, Review and the Store. Everything costs Gems; the server checks every price.
import { $ } from './engine.js';
import { S, actions, net } from './state.js';
import { sfx, setMusicDuck, getVolumes, setVolume } from './audio.js';
import { petThumb, petThumbLater, thumbReady } from './pets.js';
import { towerThumb } from './towers.js';
import { getQuality, setQuality } from './fx.js';
import {
    CFG, COSMETICS, petById, RARITY, EGGS, eggById, PASSES, PRODUCTS, gemsMult, petSlots, fmt, fmtComma, ordinal,
} from '../../shared/config.js';

const G = (n) => '<span class="gem"></span>' + fmt(n);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function setHtml(node, html) { if (node && node.innerHTML !== html) node.innerHTML = html; }
function setText(node, t) { if (node && node.textContent !== t) node.textContent = t; }
export const promptEl = $('#promptBtn'), promptTxtEl = $('#promptTxt');

// Every button clicks
document.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('button'); if (b && !b.classList.contains('ans')) sfx(b.classList.contains('g-green') ? 'clickBuy' : 'click'); }, true);

// ----- Gems counter (counts up smoothly) -----
let shownGems = 0, gemText = -1;
export function animateCounters(dt) {
    if (Math.abs(shownGems - S.gems) < 0.5) shownGems = S.gems;
    else shownGems += (S.gems - shownGems) * Math.min(1, dt * 8);
    const n = Math.round(shownGems);
    if (n !== gemText) { gemText = n; setText($('#gemVal'), fmtComma(n)); }
}
export function gemGain(n) {
    const p = $('#gemPill'); p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump');
    const g = $('#gemGain'); g.textContent = '+' + fmt(n) + ' Gems!'; g.classList.remove('go'); void g.offsetWidth; g.classList.add('go');
}

// ----- the status line ("Game starts in 9") and announcements ("Lava is rising!") -----
let annUntil = 0;
export function announce(text, dur, style) {
    const a = $('#announce');
    a.textContent = text;
    a.className = 'o ' + (style || '');
    a.hidden = false;
    a.classList.remove('pop'); void a.offsetWidth; a.classList.add('pop');
    annUntil = performance.now() + (dur || 3) * 1000;
    $('#status').hidden = true;
}
// text: the status for this phase; hidden: the question panel owns the top of the screen
export function setStatus(text, small, hidden) {
    if (performance.now() < annUntil) return;
    $('#announce').hidden = true;
    const s = $('#status');
    s.hidden = !text || hidden;
    setText(s, text || '');
    s.classList.toggle('small', !!small);
}
export function toast(text, color) {
    const d = document.createElement('div');
    d.className = 'toast o';
    d.style.color = color || '#fff';
    d.textContent = text;
    const box = $('#toasts');
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.remove(), 3000);
}
export function flash(color, ms) {
    const f = $('#flash');
    f.style.transition = 'none'; f.style.background = color || '#fff'; f.style.opacity = 0.9;
    requestAnimationFrame(() => { f.style.transition = 'opacity ' + ((ms || 600) / 1000) + 's ease'; f.style.opacity = 0; });
}
export function teleportFx() { const t = $('#tpFx'); t.classList.remove('go'); void t.offsetWidth; t.classList.add('go'); }

// "X finished in 1st place!" (in the lobby after a game, like the reference)
let placeTimer;
export function showPlacements(list) {
    const box = $('#placements');
    box.innerHTML = '';
    for (const p of list) {
        const d = document.createElement('div');
        d.className = 'place o';
        d.style.animationDelay = (p.place * 0.12) + 's';
        d.innerHTML = `<span class="medal m${p.place}">${p.place}</span>${esc(p.name)} finished in ${ordinal(p.place)} place!`;
        box.appendChild(d);
    }
    box.hidden = !list.length;
    clearTimeout(placeTimer);
    placeTimer = setTimeout(() => { box.hidden = true; }, CFG.placementsShow * 1000);
}
let bannerTimer;
export function banner(title, sub, out) {
    const b = $('#bigBanner');
    setText($('#bigT'), title); setText($('#bigS'), sub || '');
    b.classList.toggle('out', !!out);
    b.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { b.hidden = true; }, 3800);
}

// ----- HUD refresh (10x a second) -----
export function updateHud(inGame, alive, matchOn, spectating) {
    $('#btnBlocks').hidden = !alive;
    $('#btnWatch').hidden = !(matchOn && !inGame && !spectating);
    $('#danceBtn').hidden = inGame;
    const me = net.me();
    const on = !!(me && me.dancing);
    setText($('#danceBtn'), on ? 'Dance: ON' : 'Dance: OFF');
    const cls = 'btn ' + (on ? 'g-green' : 'g-navy') + ' o1';
    if ($('#danceBtn').className !== cls) $('#danceBtn').className = cls;
    document.body.classList.toggle('inmatch', !!alive);
}

// =====================================================================================
// Purchases: everything costs Gems. A confirm shows the price; the server checks it and takes them
// =====================================================================================
let pendingBuy = null;
function itemFor(kind, key) {
    if (kind === 'pass') return PASSES[key];
    if (kind === 'product') return PRODUCTS[key];
    if (kind === 'egg') return eggById[key];
    const cat = COSMETICS[kind];
    return cat && cat.byId[key];
}
export function buy(kind, key) {
    const item = itemFor(kind, key);
    if (!item) return;
    if (kind === 'pass' && S.passes[key]) { toast(item.name + ' already owned!', '#6fe0ff'); return; }
    const cat = COSMETICS[kind];
    if (cat && S[cat.owned][key]) { net.send('cosmetic', { cat: kind, id: key }); return; }   // owned: just equip
    pendingBuy = { kind, key };
    const short = item.price - (S.gems || 0);
    setText($('#confirmIc'), item.ic || (kind === 'towers' ? '🧱' : '🛒'));
    setText($('#confirmTitle'), item.name);
    setText($('#confirmText'), item.desc || (kind === 'towers' ? 'Tower skin' : kind === 'anims' ? 'Block animation' : kind === 'dances' ? 'Victory dance' : ''));
    setHtml($('#confirmCost'), G(item.price) + ' Gems');
    const yes = $('#confirmYes');
    yes.disabled = short > 0;
    setText(yes, short > 0 ? 'Need ' + fmt(short) + ' more' : kind === 'egg' ? 'Hatch' : 'Buy');
    setText($('#confirmNote'), short > 0 ? 'Answer questions to earn Gems: +5 for every correct answer and +100 for a win!' : 'You have ' + fmtComma(S.gems) + ' Gems');
    $('#confirm').hidden = false;
    setMusicDuck(true);
}
export function notEnough(m) { toast('Not enough Gems! You need ' + fmt(m.need) + ' more for ' + m.name, '#ff5a5a'); }
function closeConfirm() { $('#confirm').hidden = true; pendingBuy = null; if (!modalOpen()) setMusicDuck(false); }
$('#confirmYes').addEventListener('click', () => {
    const p = pendingBuy;
    closeConfirm();
    if (!p) return;
    if (p.kind === 'pass' || p.kind === 'product') net.send('buy', p);
    else if (p.kind === 'egg') net.send('hatch', { egg: p.key });
    else net.send('cosmetic', { cat: p.kind, id: p.key });
});
$('#confirmNo').addEventListener('click', closeConfirm);
$('#confirmClose').addEventListener('click', closeConfirm);
actions.buy = buy;
actions.cosmetic = (cat, id) => buy(cat, id);
actions.hatch = (id) => buy('egg', id);

// =====================================================================================
// Panels
// =====================================================================================
let modalKind = null, modalTab = null;
export function openModal(kind, tab) { modalKind = kind; modalTab = tab || null; renderModal(); $('#modal').hidden = false; setMusicDuck(true); }
export function closeModal() { $('#modal').hidden = true; modalKind = null; setMusicDuck(false); }
export function refreshModal() { if (!$('#modal').hidden) renderModal(); }
export const modalOpen = () => !$('#modal').hidden;
$('#modalClose').addEventListener('click', closeModal);
$('#modal').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal') closeModal(); });

function el(tag, cls, html) { const d = document.createElement(tag); if (cls) d.className = cls; if (html !== undefined) d.innerHTML = html; return d; }
function sec(body, text) { body.appendChild(el('div', 'sec o1', esc(text))); }
function note(body, text) { body.appendChild(el('p', 'note o1', text)); }
function card(o) {
    const d = el('div', 'card' + (o.cls ? ' ' + o.cls : ''));
    d.innerHTML = `<div class="ic">${o.ic}</div><div class="nm o1">${esc(o.name)}</div>${o.desc ? `<div class="ds o1">${esc(o.desc)}</div>` : ''}`;
    if (o.btn) {
        const b = el('button', 'btn ' + (o.btnCls || 'g-green') + ' o1', o.btn);
        b.disabled = !!o.disabled;
        b.addEventListener('click', o.onClick);
        d.appendChild(b);
    }
    return d;
}
function tabs(list) {
    const t = $('#modalTabs');
    t.innerHTML = '';
    if (!list) return;
    for (const [id, label] of list) {
        const b = el('button', 'btn g-purple o1' + (modalTab === id ? ' on' : ''), label);
        b.addEventListener('click', () => { modalTab = id; renderModal(); });
        t.appendChild(b);
    }
}
function renderModal() {
    const body = $('#modalBody');
    const scroll = body.scrollTop;
    body.innerHTML = '';
    const titles = { select: 'SELECT', pets: 'PETS', settings: 'SETTINGS', review: 'REVIEW', store: 'STORE' };
    const colors = { select: 'purple', pets: 'orange', review: 'green' };
    setText($('#modalTitle'), titles[modalKind] || '');
    $('#modalPanel').className = 'panel ' + (colors[modalKind] || '');
    tabs(null);
    ({ select: renderSelect, pets: renderPets, settings: renderSettings, review: renderReview, store: renderStore }[modalKind] || (() => {}))(body);
    body.scrollTop = scroll;
}

// ----- Select: tower skins, block animations, victory dances -----
const img = (url) => (url ? `<img src="${url}" alt="">` : '🧱');
function renderSelect(body) {
    tabs([['towers', '🧱 Towers'], ['anims', '✨ Block Animations'], ['dances', '💃 Victory Dances']]);
    const tab = modalTab || 'towers';
    const cat = COSMETICS[tab];
    const g = el('div', 'grid');
    for (const item of cat.list) {
        const own = !!S[cat.owned][item.id], on = S[cat.equipped] === item.id;
        g.appendChild(card({
            ic: tab === 'towers' ? img(towerThumb(item.id)) : item.ic, name: item.name, desc: item.desc || (item.price ? '' : 'Free'),
            cls: (on ? 'own on' : own ? 'own' : ''),
            btn: on ? 'Equipped' : own ? 'Equip' : G(item.price), btnCls: on ? 'g-grey' : own ? 'g-blue' : S.gems >= item.price ? 'g-green' : 'g-grey',
            disabled: on, onClick: () => buy(tab, item.id),
        }));
    }
    body.appendChild(g);
    note(body, tab === 'towers' ? 'Your tower is built from these blocks in every game.' : tab === 'anims' ? 'How each new block lands on your tower.' : 'Your dance when you win, and when Dance is ON in the lobby.');
}

// ----- Pets -----
const thumbImg = (url) => (url ? `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:contain">` : '🟢');
function petIcon(def) {
    if (thumbReady(def.id)) return thumbImg(petThumb(def));
    petThumbLater(def, (url) => { document.querySelectorAll('[data-thumb="' + def.id + '"]').forEach((n) => { n.innerHTML = thumbImg(url); }); });
    return `<span data-thumb="${def.id}" style="display:contents">⏳</span>`;
}
function renderPets(body) {
    tabs([['mine', '🐾 My Pets'], ['eggs', '🥚 Eggs']]);
    const tab = modalTab || (S.pets.length ? 'mine' : 'eggs');
    if (tab === 'eggs') { renderEggs(body); return; }
    const eq = new Set(S.equippedPets || []);
    const mult = gemsMult({ ...S, passes: {} });
    const top = el('div', 'row');
    top.innerHTML = `<span class="ic">🐾</span><span class="tx"><b class="o1">Equipped ${eq.size}/${petSlots(S)} · Gems x${Math.round(mult * 100) / 100}</b><small class="o1">${S.pets.length}/${CFG.maxPets} pets · click a pet to equip or unequip it</small></span>`;
    const best = el('button', 'btn g-green o1', 'Equip Best');
    best.addEventListener('click', () => net.send('petBest'));
    top.appendChild(best);
    body.appendChild(top);
    if (!S.pets.length) {
        note(body, 'No pets yet! Hatch an egg to get your first pet. Pets multiply the Gems you earn.');
        const b = el('button', 'btn g-orange o', '🥚 Hatch an egg');
        b.addEventListener('click', () => { modalTab = 'eggs'; renderModal(); });
        body.appendChild(b);
        return;
    }
    const grid = el('div', 'petgrid');
    const list = [...S.pets].sort((a, b) => (eq.has(b.u) - eq.has(a.u)) || petById[b.id].mult - petById[a.id].mult);
    for (const p of list) {
        const d = petById[p.id], on = eq.has(p.u), r = RARITY[d.rarity];
        const c = el('div', 'pet' + (on ? ' on' : ''));
        c.innerHTML = `${on ? '<span class="chk">✅</span>' : ''}<div class="ic" style="background:radial-gradient(circle,${r.color}66,transparent 70%)">${petIcon(d)}</div><div class="nm o1">${esc(d.name)}</div><div class="rr o1" style="color:${r.color}">${r.name}</div><div class="m o1">x${d.mult}</div>`;
        c.addEventListener('click', () => net.send('petEquip', { u: p.u, on: !on }));
        c.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!on && confirm('Delete ' + d.name + '?')) net.send('petDelete', { u: p.u }); });
        grid.appendChild(c);
    }
    body.appendChild(grid);
    note(body, 'Right-click (long-press) an unequipped pet to delete it.');
}
function renderEggs(body) {
    note(body, 'Hatch pets with Gems! Equipped pets multiply every Gem you earn. You can also hatch at the egg stands in the lobby.');
    for (const egg of EGGS) {
        const total = egg.drops.reduce((a, d) => a + d[1], 0);
        const wrap = el('div', 'row');
        wrap.style.flexWrap = 'wrap';
        wrap.innerHTML = `<span class="ic">${egg.ic}</span><span class="tx"><b class="o1">${esc(egg.name)}</b><small class="o1">${G(egg.price)} each</small></span>`;
        const b1 = el('button', 'btn g-green o1', 'Hatch');
        b1.disabled = S.gems < egg.price;
        b1.addEventListener('click', () => net.send('hatch', { egg: egg.id }));
        wrap.appendChild(b1);
        const drops = el('div', 'petgrid');
        drops.style.width = '100%';
        for (const [id, w] of egg.drops) {
            const d = petById[id], r = RARITY[d.rarity];
            const c = el('div', 'pet');
            c.style.cursor = 'default';
            c.innerHTML = `<div class="ic" style="background:radial-gradient(circle,${r.color}66,transparent 70%)">${petIcon(d)}</div><div class="nm o1">${esc(d.name)}</div><div class="rr o1" style="color:${r.color}">${Math.round(w / total * 1000) / 10}%</div><div class="m o1">x${d.mult}</div>`;
            drops.appendChild(c);
        }
        wrap.appendChild(drops);
        body.appendChild(wrap);
    }
}

// ----- Settings -----
function slider(body, ic, label, kind) {
    const r = el('div', 'row');
    r.innerHTML = `<span class="ic">${ic}</span><span class="tx" style="flex:0 0 9rem"><b class="o1">${label}</b></span>`;
    const s = el('input');
    s.type = 'range'; s.min = 0; s.max = 100; s.value = Math.round((getVolumes()[kind] ?? 1) * 100);
    s.setAttribute('aria-label', label);
    s.addEventListener('input', () => setVolume(kind, s.value / 100));
    r.appendChild(s);
    body.appendChild(r);
}
function toggleRow(body, ic, label, sub, on, fn) {
    const r = el('div', 'row');
    r.innerHTML = `<span class="ic">${ic}</span><span class="tx"><b class="o1">${label}</b><small class="o1">${sub}</small></span>`;
    const b = el('button', 'switch' + (on ? ' on' : ''));
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => { fn(!on); });
    r.appendChild(b);
    body.appendChild(r);
}
function renderSettings(body) {
    sec(body, 'Game');
    toggleRow(body, '🎮', 'Auto join games', 'Off: stay in the lobby and watch', S.autoJoin !== false, (v) => net.send('setting', { key: 'autoJoin', value: v }));
    toggleRow(body, '💡', 'Show hints', 'A hint pops up after 5 seconds or a wrong answer', S.hints !== false, (v) => net.send('setting', { key: 'hints', value: v }));
    toggleRow(body, '🐾', 'Other players\' pets', 'Hide them for a calmer view', actions.showOtherPets(), () => { actions.toggleOtherPets(); renderModal(); });
    sec(body, 'Sound');
    slider(body, '🎵', 'Music', 'music');
    slider(body, '🔔', 'Effects', 'sfx');
    sec(body, 'Graphics');
    const q = el('div', 'row');
    q.innerHTML = '<span class="ic">✨</span><span class="tx"><b class="o1">Quality</b><small class="o1">Lower it if the game feels slow</small></span>';
    for (const [k, n] of [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]) {
        const b = el('button', 'btn ' + (getQuality() === k ? 'g-green' : 'g-grey') + ' o1', n);
        b.addEventListener('click', () => { setQuality(k); renderModal(); });
        q.appendChild(b);
    }
    body.appendChild(q);
    sec(body, 'Codes');
    const c = el('div', 'row');
    c.innerHTML = '<span class="ic">🎟️</span>';
    const inp = el('input', 'input'); inp.placeholder = 'Enter a code'; inp.maxLength = 24;
    const go = el('button', 'btn g-green o1', 'Redeem');
    go.addEventListener('click', () => { if (inp.value.trim()) net.send('code', { code: inp.value.trim() }); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go.click(); e.stopPropagation(); });
    c.appendChild(inp); c.appendChild(go);
    body.appendChild(c);
    sec(body, 'Your stats');
    const st = el('div', 'row');
    st.innerHTML = `<span class="ic">📊</span><span class="tx"><b class="o1">🏆 ${fmt(S.wins)} Wins · ✅ ${fmt(S.answers)} correct answers · ${fmt(S.games)} games</b><small class="o1">Best: ${S.bestRound || 0} rounds survived · ${fmt(S.totalGems)} Gems earned · ${S.retries || 0} spare retries</small></span>`;
    body.appendChild(st);
}
export function codeResult(m) { toast(m.ok ? '🎟️ ' + m.text : m.text, m.ok ? '#7dff6b' : '#ff5a5a'); }

// ----- Review: every question you answered -----
function renderReview(body) {
    const list = S.review || [];
    const ok = list.filter((r) => r.correct).length;
    note(body, list.length ? `${ok} / ${list.length} correct this session. Keep practising! 🧠` : 'Answer some questions in a game and they show up here with the right answers.');
    for (const r of list) {
        const d = el('div', 'row ' + (r.correct ? 'ok' : 'bad'));
        d.innerHTML = `<span class="ic">${r.correct ? '✅' : '❌'}</span><span class="tx"><b class="o1">${esc(r.text)}</b>`
            + `<small class="o1">${r.mine ? 'Your answer: ' + esc(r.mine) + (r.correct ? ' · ' + (r.time || 0).toFixed(1) + 's' : '') : 'No answer'} · Correct: <b>${esc(r.answer)}</b>${r.mode ? ' · ' + esc(r.mode) + ' round ' + (r.round || 0) : ''}</small></span>`;
        body.appendChild(d);
    }
}

// ----- Store -----
function passCard(key, cls) {
    const p = PASSES[key], own = !!S.passes[key];
    return card({ ic: p.ic, name: p.name, desc: p.desc, cls: (cls || '') + (own ? ' own' : ''), btn: own ? 'Owned' : G(p.price), btnCls: own ? 'g-blue' : S.gems >= p.price ? 'g-green' : 'g-grey', disabled: own, onClick: () => buy('pass', key) });
}
function prodCard(key) {
    const p = PRODUCTS[key];
    return card({ ic: p.ic, name: p.name, desc: p.desc, btn: G(p.price), btnCls: S.gems >= p.price ? 'g-green' : 'g-grey', onClick: () => buy('product', key) });
}
function renderStore(body) {
    tabs([['passes', '⭐ Passes'], ['boosts', '⚡ Boosts'], ['earn', '💎 Earn Gems']]);
    const tab = modalTab || 'passes';
    const g = el('div', 'grid');
    if (tab === 'passes') { g.appendChild(passCard('VIP', 'vip')); g.appendChild(passCard('DoubleGems')); g.appendChild(passCard('UnlimitedAnswers')); g.appendChild(passCard('AlgebraMode')); }
    else if (tab === 'boosts') { g.appendChild(prodCard('PlusBlocks')); g.appendChild(prodCard('Retries')); g.appendChild(prodCard('Nuke')); }
    if (tab !== 'earn') { body.appendChild(g); note(body, 'Everything is bought with Gems. +10 Blocks bought in the lobby is saved for your next game.'); return; }
    for (const [ic, t, s] of [
        ['✅', '+5 Gems for every correct answer', 'Answer fast for more blocks too'],
        ['🏆', '+100 Gems for winning a game', '+40 for 2nd place, +20 for 3rd'],
        ['💎', 'Gems all over the lobby', 'Pick them up: they come back after a while (faster in the VIP lounge)'],
        ['🎁', '+' + CFG.chestGems + ' Gems from the Gem Chest', 'Behind the spawn, every ' + CFG.chestHours + ' hours'],
        ['🐾', 'Pets multiply your Gems', 'Equip your best pets in Pets'],
        ['🎟️', 'Codes', 'Try MATH in Settings → Codes'],
    ]) {
        const r = el('div', 'row');
        r.innerHTML = `<span class="ic">${ic}</span><span class="tx"><b class="o1">${t}</b><small class="o1">${s}</small></span>`;
        body.appendChild(r);
    }
}

// =====================================================================================
// Hatching
// =====================================================================================
function drawEgg(egg, wob) {
    const cv = $('#hatchEgg'), x = cv.getContext('2d');
    x.clearRect(0, 0, 320, 320);
    x.save(); x.translate(160, 175); x.rotate(wob || 0);
    const col = '#' + egg.color.toString(16).padStart(6, '0'), sp = '#' + egg.spots.toString(16).padStart(6, '0');
    const g = x.createRadialGradient(-30, -50, 10, 0, 0, 130); g.addColorStop(0, '#ffffff'); g.addColorStop(0.3, col); g.addColorStop(1, col);
    x.fillStyle = g; x.strokeStyle = '#14182c'; x.lineWidth = 8;
    x.beginPath(); x.ellipse(0, 0, 92, 120, 0, 0, Math.PI * 2); x.fill(); x.stroke();
    x.fillStyle = sp;
    for (const [ex, ey, r] of [[-40, -40, 16], [30, -60, 12], [45, 10, 18], [-20, 30, 14], [10, 80, 12], [-55, 60, 10]]) { x.beginPath(); x.ellipse(ex, ey, r, r * 0.8, 0.4, 0, Math.PI * 2); x.fill(); }
    x.restore();
}
export function showHatch(m) {
    const egg = eggById[m.egg];
    if (!egg || !m.pet) return;
    closeModal();
    $('#hatch').hidden = false;
    setMusicDuck(true);
    const cv = $('#hatchEgg');
    cv.hidden = false; cv.classList.add('shake');
    $('#hatchOut').innerHTML = '';
    $('#hatchOk').hidden = true;
    let n = 0;
    const tick = setInterval(() => { sfx('hatchShake'); drawEgg(egg, Math.sin(n * 1.7) * 0.2); if (++n > 9) clearInterval(tick); }, 170);
    drawEgg(egg, 0);
    setTimeout(() => {
        cv.classList.remove('shake'); cv.hidden = true;
        const d = petById[m.pet.id], r = RARITY[d.rarity];
        const res = el('div', 'hres');
        const url = petThumb(d);
        res.innerHTML = `${url ? `<img src="${url}" alt="" style="filter:drop-shadow(0 0 1.2rem ${r.color})">` : ''}<div class="nm o">${esc(d.name)}</div><div class="rr o1" style="color:${r.color}">${r.name} · x${d.mult} Gems</div>`;
        $('#hatchOut').appendChild(res);
        sfx(d.rarity);
        $('#hatchOk').hidden = false;
    }, 1700);
}
$('#hatchOk').addEventListener('click', () => { $('#hatch').hidden = true; if (!modalOpen()) setMusicDuck(false); refreshModal(); });

// =====================================================================================
// HUD buttons
// =====================================================================================
$('#btnSelect').addEventListener('click', () => openModal('select'));
$('#btnPets').addEventListener('click', () => openModal('pets'));
$('#btnSettings').addEventListener('click', () => openModal('settings'));
$('#btnReview').addEventListener('click', () => openModal('review'));
$('#gemPlus').addEventListener('click', () => openModal('store'));
$('#btnBlocks').addEventListener('click', () => buy('product', 'PlusBlocks'));
$('#btnNuke').addEventListener('click', () => buy('product', 'Nuke'));
$('#btnWatch').addEventListener('click', () => actions.spectate());
$('#danceBtn').addEventListener('click', () => { const me = net.me(); net.send('dance', { on: !(me && me.dancing) }); });
for (const b of document.querySelectorAll('.react')) b.addEventListener('click', () => { net.send('react', { i: +b.dataset.i }); sfx('react'); });

// Closes the topmost popup (Escape / controller B); false when nothing was open
export function closeTop() {
    if (!$('#hatch').hidden) { $('#hatchOk').click(); return true; }
    if (!$('#confirm').hidden) { closeConfirm(); return true; }
    if (!$('#chance').hidden) { $('#chance').hidden = true; return true; }
    if (modalOpen()) { closeModal(); return true; }
    return false;
}
export const anyPopup = () => ['#hatch', '#confirm', '#modal'].some((id) => !$(id).hidden);
