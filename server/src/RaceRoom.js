import { Room } from 'colyseus';
import { GameState, PlayerState } from './schema.js';
import {
    getProfile, hasProfile, markDirty, saveProfiles, adoptGuestProgress, loadProfile, releaseProfile,
    topProfiles, recordSession, USE_DB,
} from './profiles.js';
import { sealProfile, openSave } from './saves.js';
import { verifyBloxityToken } from './bloxity.js';
import {
    CFG, DIFFICULTIES, diffById, DEFAULT_DIFFICULTY, lavaRise, blockReward, COSMETICS, petById, eggById, rollEgg,
    PASSES, PRODUCTS, CODES, EMOJIS, KITS, SKINS, gemsMult, equippedIds, petSlots, joinNames, clamp,
} from '../../shared/config.js';
import { SPAWN, VOTE, padAt, SLOTS, MAX_IN_MATCH, GEM_SPOTS, CHEST, BEACH, towerTopY } from '../../shared/arena.js';
import { generateQuestion } from '../../shared/questions.js';

const GREEN = '#7dff6b', RED = '#ff5a5a', GOLD = '#ffd028', BLUE = '#6fe0ff', PINK = '#ff8ad8';

// Empty string when the player left the name box blank
function cleanName(name) {
    return String(name || '').replace(/[^\w .\-]/g, '').trim().slice(0, 20);
}
const randomName = () => 'Player' + Math.floor(1000 + Math.random() * 9000);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
// Guest ids come from the browser; they can never claim a Bloxity identity
const guestUid = (uid, fallback) => String(uid || fallback).replace(/^legion_/, 'guest_').slice(0, 64);
const cleanAvatar = (av) => (typeof av === 'string' && av.length <= 2000 ? av : '');
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export const liveRooms = new Set();

// One shared island per room. Lobby movement is client-side; the match is run here: the round
// loop, questions and answers, tower heights, the lava, elimination, placements and every reward.
// There are no real-money purchases: every price is in Gems, checked and taken by the server.
export class RaceRoom extends Room {
    maxClients = CFG.maxPlayers;

    onCreate() {
        liveRooms.add(this);
        this.setState(new GameState());
        this.setPatchRate(50);
        this.sessions = new Map();
        this.joinCount = 0;
        this.match = null;
        this.matchCounter = 0;
        this.disposed = false;
        this.gemsDown = new Map();   // gem spot index -> ms when it comes back
        this.state.need = CFG.minPlayers;

        const on = (type, fn) => this.onMessage(type, (client, m) => { try { fn.call(this, client, m || {}); } catch (e) { console.warn('[msg]', type, e.message); } });
        on('ready', this.onReady);
        on('move', this.onMove);
        on('answer', this.onAnswer);
        on('retry', this.onRetry);
        on('buy', this.onBuy);
        on('cosmetic', this.onCosmetic);
        on('hatch', this.onHatch);
        on('petEquip', this.onPetEquip);
        on('petBest', this.onPetBest);
        on('petDelete', this.onPetDelete);
        on('setting', this.onSetting);
        on('dance', this.onDance);
        on('gem', this.onGem);
        on('chest', this.onChest);
        on('code', this.onCode);
        on('react', this.onReact);
        on('auth', this.onBloxityLogin);
        on('avatar', this.onAvatar);
        on('emote', this.onEmote);
        on('chat', this.onChat);

        // ticks the room clock (every wait() in the match loop runs on it)
        this.setSimulationInterval(() => {}, 50);
        this.clock.setInterval(() => this.tickSecond(), 1000);
        this.clock.setInterval(() => this.broadcastBoards(), 10000);
        this.loop();
    }

    // A Bloxity token is verified with the Bloxity API; anyone else joins as a guest
    async onAuth(client, options) {
        const legion = options && options.token ? await verifyBloxityToken(options.token) : null;
        return legion ? { legion } : { guest: true };
    }

    async onJoin(client, options, auth) {
        options = options || {};
        const guest = guestUid(options.uid, client.sessionId);
        let uid = guest, name = cleanName(options.name);
        if (auth && auth.legion) {
            uid = 'legion_' + auth.legion.id;
            name = cleanName(auth.legion.name) || name;
            await adoptGuestProgress(uid, guest, name);
        }
        await loadProfile(uid);
        // A fresh server on a temporary disk restores the browser's signed backup.
        // With a database the profile is never lost, so backups are not accepted at all.
        const restore = !USE_DB && !hasProfile(uid) && openSave(options.save, [uid, guest]);
        const profile = getProfile(uid, name, randomName());
        if (restore) { Object.assign(profile, restore); markDirty(); }
        this.fixProfile(profile);
        const player = new PlayerState();
        player.name = profile.name;
        player.av = cleanAvatar(options.av);
        player.x = SPAWN.x; player.y = SPAWN.y; player.z = SPAWN.z; player.ry = SPAWN.yaw;
        player.kit = this.joinCount % KITS.length;
        player.skin = (this.joinCount * 3) % SKINS.length;
        this.joinCount++;
        this.state.players.set(client.sessionId, player);
        const s = {
            id: client.sessionId, client, profile, player,
            pos: { x: SPAWN.x, y: SPAWN.y, z: SPAWN.z },
            ready: false, joinedAt: Date.now(), guest, lastChat: 0, lastReact: 0, lastPassPrompt: 0, playSecs: 0,
            stats: { fresh: Date.now() - (profile.firstPlay || 0) < 60000, games: 0, wins: 0, answers: 0, wrong: 0, bestRound: 0, gems0: profile.totalGems || 0, buys: 0, modes: {} },
        };
        this.sessions.set(client.sessionId, s);
        this.syncPublic(s);
        client.send('hello', { now: Date.now(), bloxity: uid.startsWith('legion_') });
        this.sendProfile(s);
        this.broadcastBoards(client);
        client.send('gems', { down: this.gemsDownList() });
        // Joined in the middle of a question: show it (as a spectator)
        if (this.match && this.state.phase === 'question' && this.match.question) client.send('question', this.questionPayload());
    }

    // Older saves / hand-edited data: keep every field the right shape
    fixProfile(p) {
        for (const k of ['gems', 'totalGems', 'wins', 'answers', 'games', 'bestRound', 'playtime', 'retries', 'pendingBlocks', 'chestAt']) if (!finite(p[k]) || p[k] < 0) p[k] = 0;
        for (const cat of Object.values(COSMETICS)) {
            const owned = cat.owned, eq = cat.equipped;
            if (!p[owned] || typeof p[owned] !== 'object') p[owned] = {};
            p[owned][cat.list[0].id] = true;
            if (!cat.byId[p[eq]] || !p[owned][p[eq]]) p[eq] = cat.list[0].id;
        }
        if (!Array.isArray(p.pets)) p.pets = [];
        p.pets = p.pets.filter((x) => x && petById[x.id]).slice(0, CFG.maxPets);
        if (!Array.isArray(p.equippedPets)) p.equippedPets = [];
        p.equippedPets = p.equippedPets.filter((u) => p.pets.some((x) => x.u === u)).slice(0, petSlots(p));
        if (!p.passes || typeof p.passes !== 'object') p.passes = {};
        if (!p.codes || typeof p.codes !== 'object') p.codes = {};
        if (typeof p.autoJoin !== 'boolean') p.autoJoin = true;
        if (typeof p.hints !== 'boolean') p.hints = true;
    }

    // A dropped connection keeps the player in the world for 30 s so the client can reconnect
    onDrop(client) {
        this.allowReconnection(client, 30);
    }
    onReconnect(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        s.client = client;
        client.send('hello', { now: Date.now(), bloxity: s.profile.uid.startsWith('legion_') });
        this.sendProfile(s);
        this.broadcastBoards(client);
        client.send('gems', { down: this.gemsDownList() });
    }

    onLeave(client) {
        const s = this.sessions.get(client.sessionId);
        if (this.match) {
            const st = this.match.players.get(client.sessionId);
            if (st && st.alive) this.eliminate([st], 'left');
        }
        this.state.players.delete(client.sessionId);
        this.sessions.delete(client.sessionId);
        markDirty();
        if (!s) return;
        const st = s.stats;
        recordSession({
            at: new Date(), secs: Math.round((Date.now() - s.joinedAt) / 1000), fresh: st.fresh, games: st.games, wins: st.wins,
            answers: st.answers, wrong: st.wrong, bestRound: st.bestRound, gems: (s.profile.totalGems || 0) - (st.gems0 || 0), buys: st.buys, modes: st.modes,
        }).catch((e) => console.warn('[stats]', e.message));
        if (!isOnline(s.profile.uid)) releaseProfile(s.profile.uid, isOnline);
    }

    // Colyseus awaits this on SIGTERM, which is how Legion stops a pod on every deploy
    onDispose() { this.disposed = true; liveRooms.delete(this); markDirty(); return saveProfiles(); }

    // =====================================================================================
    // Helpers
    // =====================================================================================
    syncPublic(s) {
        const p = s.profile, pl = s.player;
        pl.name = p.name;
        pl.wins = p.wins;
        pl.vip = !!p.passes.VIP;
        pl.pets = equippedIds(p).join(',');
        pl.tower = p.tower;
        pl.banim = p.anim;
        pl.dance = p.dance;
    }
    sendProfile(s) {
        const p = s.profile;
        s.client.send('profile', {
            gems: p.gems, totalGems: p.totalGems, wins: p.wins, answers: p.answers, games: p.games, bestRound: p.bestRound, playtime: p.playtime,
            retries: p.retries, towers: p.towers, tower: p.tower, anims: p.anims, anim: p.anim, dances: p.dances, dance: p.dance,
            pets: p.pets, equippedPets: p.equippedPets, passes: p.passes, chestAt: p.chestAt, codes: p.codes, autoJoin: p.autoJoin, hints: p.hints,
            pendingBlocks: p.pendingBlocks, firstPlay: p.firstPlay,
            save: sealProfile(p),
        });
    }
    changed(s) { if (!s) return; this.syncPublic(s); this.sendProfile(s); markDirty(); }
    toast(s, text, color) { if (s && s.client) s.client.send('toast', { text, color: color || '#ffffff' }); }
    announce(text, dur, style) { this.broadcast('announce', { text, dur: dur || 3, style: style || '' }); }
    wait(secs) { return new Promise((res) => this.clock.setTimeout(res, Math.max(0, secs) * 1000)); }
    setPhase(name, secs) { this.state.phase = name; this.state.phaseEnd = Date.now() + (secs || 0) * 1000; }
    // Teleports a player (movement is client-side, so the client does the move)
    // Moves a player (the room state too, so everyone else sees them there at once)
    place(s, x, y, z, yaw, fx) {
        s.pos = { x, y, z };
        const pl = s.player;
        if (pl) { pl.x = x; pl.y = y; pl.z = z; pl.ry = yaw ?? SPAWN.yaw; }
        s.client.send('place', { x, y, z, yaw: yaw ?? SPAWN.yaw, fx: fx || '' });
    }
    // Back to the spawn pad, spread around it so players coming back together don't land in a pile
    toLobby(s, fx) {
        const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 6;
        this.place(s, SPAWN.x + Math.cos(a) * r, SPAWN.y, SPAWN.z + Math.sin(a) * r, SPAWN.yaw, fx || 'lobby');
    }
    // Gems earned by playing are multiplied by pets, x2 Gems and VIP
    addGems(s, base, why) {
        const n = Math.max(1, Math.round(base * gemsMult(s.profile)));
        s.profile.gems += n;
        s.profile.totalGems += n;
        s.client.send('earn', { n, why });
        return n;
    }
    hasPass(s, key) { return !!(s.profile.passes && s.profile.passes[key]); }

    // Every second: playtime
    tickSecond() {
        for (const s of this.sessions.values()) { s.profile.playtime = (s.profile.playtime || 0) + 1; s.playSecs++; }
        markDirty();
    }

    // =====================================================================================
    // Lobby
    // =====================================================================================
    // The client finished loading and is in the world: it can be pulled into games now
    onReady(client) {
        const s = this.sessions.get(client.sessionId);
        if (s) s.ready = true;
    }
    onMove(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !finite(m.x) || !finite(m.y) || !finite(m.z)) return;
        const pl = s.player;
        pl.x = clamp(m.x, -BEACH - 40, BEACH + 40); pl.y = clamp(m.y, -60, 900); pl.z = clamp(m.z, -BEACH - 40, BEACH + 40);
        pl.ry = finite(m.ry) ? m.ry : 0;
        pl.anim = clamp(m.a | 0, 0, 2);
        s.pos = { x: pl.x, y: pl.y, z: pl.z };
    }
    onSetting(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || typeof m.value !== 'boolean') return;
        if (m.key === 'autoJoin' || m.key === 'hints') { s.profile[m.key] = m.value; this.changed(s); }
    }
    onDance(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (s) s.player.dancing = !!m.on && !s.player.inMatch;
    }
    onReact(client, m) {
        const s = this.sessions.get(client.sessionId);
        const i = m.i | 0, now = Date.now();
        if (!s || i < 0 || i >= EMOJIS.length || now - s.lastReact < 900) return;
        s.lastReact = now;
        this.broadcast('react', { s: client.sessionId, i });
    }
    gemsDownList() {
        const now = Date.now(), out = [];
        for (const [i, until] of this.gemsDown) { if (until > now) out.push([i, until]); else this.gemsDown.delete(i); }
        return out;
    }
    // Gem pickups: the player must really be next to it
    onGem(client, m) {
        const s = this.sessions.get(client.sessionId);
        const g = GEM_SPOTS[m.i | 0];
        if (!s || !g || s.player.inMatch) return;
        const now = Date.now();
        if ((this.gemsDown.get(g.i) || 0) > now) return;
        if (Math.hypot(s.pos.x - g.x, s.pos.z - g.z) > 7 || Math.abs(s.pos.y - g.y) > 8) return;
        if (g.vip && !this.hasPass(s, 'VIP')) return;
        const until = now + (g.vip ? CFG.vipPickupRespawn : CFG.pickupRespawn) * 1000;
        this.gemsDown.set(g.i, until);
        this.broadcast('gemTaken', { i: g.i, until, s: client.sessionId });
        this.addGems(s, CFG.pickupGems, 'pickup');
        this.changed(s);
    }
    onChest(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        if (Math.hypot(s.pos.x - CHEST.x, s.pos.z - CHEST.z) > 14) return;
        const wait = CFG.chestHours * 3600000 - (Date.now() - (s.profile.chestAt || 0));
        if (wait > 0) return this.toast(s, 'The chest refills in ' + Math.floor(wait / 3600000) + 'h ' + Math.ceil((wait % 3600000) / 60000) + 'm', BLUE);
        s.profile.chestAt = Date.now();
        s.profile.gems += CFG.chestGems; s.profile.totalGems += CFG.chestGems;
        s.client.send('earn', { n: CFG.chestGems, why: 'chest' });
        this.toast(s, '🎁 +' + CFG.chestGems + ' Gems from the chest!', GOLD);
        s.client.send('fx', { kind: 'confetti' });
        this.changed(s);
    }
    onCode(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const code = String(m.code || '').trim().toUpperCase().slice(0, 24);
        const r = CODES[code];
        if (!r) return client.send('codeResult', { ok: false, text: 'Invalid code' });
        if (s.profile.codes[code]) return client.send('codeResult', { ok: false, text: 'Code already used' });
        s.profile.codes[code] = true;
        s.profile.gems += r.gems; s.profile.totalGems += r.gems;
        client.send('codeResult', { ok: true, text: '+' + r.gems + ' Gems!' });
        this.changed(s);
    }

    // =====================================================================================
    // The Gem shop: the server checks the price, takes the Gems, then grants
    // =====================================================================================
    onBuy(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || (m.kind !== 'pass' && m.kind !== 'product')) return;
        const p = s.profile, key = String(m.key || '');
        const item = (m.kind === 'pass' ? PASSES : PRODUCTS)[key];
        if (!item) return;
        if (m.kind === 'pass' && p.passes[key]) return this.toast(s, item.name + ' already owned!', BLUE);
        if (p.gems < item.price) return client.send('broke', { need: item.price - p.gems, name: item.name });
        p.gems -= item.price;
        s.stats.buys++;
        if (m.kind === 'pass') {
            p.passes[key] = true;
            this.toast(s, item.ic + ' ' + item.name + ' unlocked!', GREEN);
            client.send('fx', { kind: 'unlock', key });
        } else if (key === 'PlusBlocks') {
            if (!this.grantBlocks(s, CFG.plusBlocks)) {
                p.pendingBlocks = (p.pendingBlocks || 0) + CFG.plusBlocks;
                this.toast(s, '🧱 +' + CFG.plusBlocks + ' blocks saved for your next game!', GOLD);
            } else this.toast(s, '🧱 +' + CFG.plusBlocks + ' Blocks!', GOLD);
            client.send('fx', { kind: 'buy', key });
        } else if (key === 'Nuke') {
            this.nuke(s);
        } else if (key === 'Retries') {
            p.retries += CFG.retriesPack;
            this.toast(s, '❤️ +' + CFG.retriesPack + ' answer retries!', PINK);
            client.send('fx', { kind: 'buy', key });
            this.retryUnlock(s);
        }
        this.changed(s);
    }
    // Tower skins, block animations and victory dances: buy with Gems, then equip
    onCosmetic(client, m) {
        const s = this.sessions.get(client.sessionId);
        const cat = COSMETICS[m.cat];
        const item = cat && cat.byId[m.id];
        if (!s || !item) return;
        const p = s.profile;
        if (!p[cat.owned][item.id]) {
            if (p.gems < item.price) return client.send('broke', { need: item.price - p.gems, name: item.name });
            p.gems -= item.price;
            p[cat.owned][item.id] = true;
            s.stats.buys++;
            this.toast(s, item.name + ' unlocked!', GREEN);
            client.send('fx', { kind: 'unlock', key: item.id });
        } else this.toast(s, 'Equipped ' + item.name + '!', GREEN);
        p[cat.equipped] = item.id;
        this.changed(s);
    }

    // ----- pets -----
    givePet(s, id, equip) {
        const p = s.profile;
        if (p.pets.length >= CFG.maxPets) return null;
        p.petSeq = (p.petSeq || 0) + 1;
        const pet = { u: p.petSeq, id };
        p.pets.push(pet);
        if (equip && p.equippedPets.length < petSlots(p)) p.equippedPets.push(pet.u);
        return pet;
    }
    onHatch(client, m) {
        const s = this.sessions.get(client.sessionId);
        const egg = eggById[m.egg];
        if (!s || !egg) return;
        const p = s.profile;
        if (p.pets.length >= CFG.maxPets) return this.toast(s, 'Your pet inventory is full! Delete some pets first.', RED);
        if (p.gems < egg.price) return client.send('broke', { need: egg.price - p.gems, name: egg.name });
        p.gems -= egg.price;
        s.stats.buys++;
        const pet = this.givePet(s, rollEgg(egg, Math.random), true);
        client.send('hatched', { egg: egg.id, pet });
        const d = petById[pet.id];
        if (d.rarity === 'legendary' || d.rarity === 'mythic') this.broadcast('toast', { text: '✨ ' + p.name + ' hatched a ' + d.name + '!', color: GOLD });
        this.changed(s);
    }
    onPetEquip(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, u = m.u | 0;
        if (!p.pets.some((x) => x.u === u)) return;
        if (m.on) {
            if (p.equippedPets.includes(u)) return;
            if (p.equippedPets.length >= petSlots(p)) return this.toast(s, 'You can equip ' + petSlots(p) + ' pets at a time' + (p.passes.VIP ? '' : ' (VIP: 4)'), BLUE);
            p.equippedPets.push(u);
        } else p.equippedPets = p.equippedPets.filter((x) => x !== u);
        this.changed(s);
    }
    onPetBest(client) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile;
        p.equippedPets = [...p.pets].sort((a, b) => petById[b.id].mult - petById[a.id].mult).slice(0, petSlots(p)).map((x) => x.u);
        this.toast(s, 'Equipped your best pets!', GREEN);
        this.changed(s);
    }
    onPetDelete(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s) return;
        const p = s.profile, list = Array.isArray(m.u) ? m.u.map((x) => x | 0) : [m.u | 0];
        p.pets = p.pets.filter((x) => !list.includes(x.u));
        p.equippedPets = p.equippedPets.filter((u) => !list.includes(u));
        this.changed(s);
    }

    broadcastBoards(client) {
        const row = (key) => topProfiles(key).filter((p) => (p[key] || 0) > 0).map((p) => ({ n: p.name, v: Math.floor(p[key] || 0) }));
        const m = { wins: row('wins'), answers: row('answers') };
        if (client) client.send('boards', m); else this.broadcast('boards', m);
    }

    // =====================================================================================
    // The match
    // =====================================================================================
    eligible() { return [...this.sessions.values()].filter((s) => s.ready && s.profile.autoJoin !== false); }
    aliveList() { return this.match ? [...this.match.players.values()].filter((st) => st.alive) : []; }
    shouldEnd() {
        const m = this.match;
        if (!m) return true;
        const alive = this.aliveList().length;
        if (alive === 0) return true;
        if (m.startCount >= 2 && alive <= 1) return true;
        return m.round >= CFG.maxRounds;
    }
    setLava(level, secs) {
        const st = this.state;
        st.lavaFrom = this.lavaNow();
        st.lava = level;
        st.lavaAt = Date.now();
        st.lavaDur = secs || 0;
        if (this.match) this.match.lava = level;
    }
    lavaNow() {
        const st = this.state;
        if (!st.lavaDur) return st.lava;
        const k = clamp((Date.now() - st.lavaAt) / (st.lavaDur * 1000), 0, 1);
        return st.lavaFrom + (st.lava - st.lavaFrom) * k;
    }

    async loop() {
        while (!this.disposed) {
            try { await this.runMatch(); } catch (e) {
                console.warn('[match] crashed, resetting:', e);
                this.resetMatch();
                await this.wait(3);
            }
        }
    }
    resetMatch() {
        if (this.match) {
            for (const st of this.match.players.values()) {
                const s = this.sessions.get(st.id);
                if (!s) continue;
                this.clearPlayer(s.player);
                this.toLobby(s);
            }
        }
        this.match = null;
        this.state.matchId = 0; this.state.round = 0; this.state.alive = 0; this.state.mode = '';
        this.setLava(-2, 1);
        this.setPhase('waiting', 0);
    }
    clearPlayer(pl) {
        pl.inMatch = false; pl.alive = false; pl.slot = -1; pl.height = 0; pl.celebrate = false;
    }

    async runMatch() {
        if (!(await this.runIntermission())) return;
        let parts = this.eligible();
        if (parts.length < CFG.minPlayers) return;
        const mode = await this.runVoting(parts);
        if (this.disposed) return;
        // anyone who finished loading during voting plays too
        parts = this.eligible();
        if (!this.startMatch(parts, mode)) return;
        this.setPhase('starting', CFG.getReady);
        this.announce('Get ready!', CFG.getReady);
        this.setLava(0, CFG.getReady * 0.8);
        await this.wait(CFG.getReady);

        while (this.match && !this.shouldEnd() && !this.disposed) {
            const m = this.match;
            m.round++;
            this.state.round = m.round;
            const rise = lavaRise(m.round);
            this.setPhase('roundIntro', CFG.roundIntro);
            this.announce(`The lava will rise by ${rise} block${rise === 1 ? '' : 's'} after this round!`, CFG.roundIntro);
            await this.wait(CFG.roundIntro);
            if (this.shouldEnd()) break;
            await this.runQuestion();
            if (!this.match || this.shouldEnd()) break;
            await this.runResults();
            await this.runRising(rise);
        }
        if (this.match) await this.finishMatch();
    }

    async runIntermission() {
        for (;;) {
            if (this.disposed) return false;
            const n = this.eligible().length;
            if (n < CFG.minPlayers) {
                this.state.need = CFG.minPlayers;
                this.setPhase('waiting', 0);
                await this.wait(1);
                continue;
            }
            this.setPhase('intermission', CFG.intermission);
            const end = Date.now() + CFG.intermission * 1000;
            let cancelled = false;
            while (Date.now() < end) {
                await this.wait(0.25);
                if (this.disposed) return false;
                if (this.eligible().length < CFG.minPlayers) { cancelled = true; break; }
            }
            if (!cancelled) return true;
        }
    }

    async runVoting(parts) {
        const a = VOTE.area;
        for (const s of parts) this.place(s, a.x0 + Math.random() * (a.x1 - a.x0), 0, a.z0 + Math.random() * (a.z1 - a.z0), Math.PI, 'vote');
        this.setPhase('voting', CFG.voting);
        let counts = {};
        const end = Date.now() + CFG.voting * 1000;
        while (Date.now() < end) {
            counts = {};
            for (const s of parts) {
                if (!this.sessions.has(s.id) || s.pos.y > 8) continue;
                const pad = padAt(s.pos.x, s.pos.z);
                if (!pad) continue;
                if (pad.pass && !this.hasPass(s, pad.pass)) {
                    if (Date.now() - s.lastPassPrompt > 6000) { s.lastPassPrompt = Date.now(); s.client.send('needPass', { key: pad.pass }); }
                    continue;
                }
                counts[pad.id] = (counts[pad.id] || 0) + 1;
            }
            this.state.vEasy = counts.Easy || 0; this.state.vMedium = counts.Medium || 0;
            this.state.vHard = counts.Hard || 0; this.state.vAlgebra = counts.Algebra || 0;
            await this.wait(0.2);
            if (this.disposed) return DEFAULT_DIFFICULTY;
        }
        let best = 0, tied = [];
        for (const d of DIFFICULTIES) {
            const c = counts[d.id] || 0;
            if (c > best) { best = c; tied = [d.id]; } else if (c === best && c > 0) tied.push(d.id);
        }
        const mode = tied.length ? tied[Math.floor(Math.random() * tied.length)] : DEFAULT_DIFFICULTY;
        this.setPhase('voteResult', CFG.voteResult);
        this.announce(`"${diffById[mode].name}" was selected!`, CFG.voteResult);
        await this.wait(CFG.voteResult);
        this.state.vEasy = 0; this.state.vMedium = 0; this.state.vHard = 0; this.state.vAlgebra = 0;
        return mode;
    }

    startMatch(parts, mode) {
        const m = {
            id: ++this.matchCounter % 65000 || 1, mode, round: 0, lava: -1, players: new Map(), order: [], history: {},
            qid: 0, question: null, qStart: 0, qEnds: 0, startCount: 0,
        };
        shuffle(parts);
        let slot = 0;
        for (const s of parts) {
            if (!this.sessions.has(s.id) || slot >= MAX_IN_MATCH) continue;
            const p = s.profile, pending = p.pendingBlocks || 0;
            p.pendingBlocks = 0;
            const st = {
                id: s.id, name: p.name, slot, height: CFG.startBlocks + pending, alive: true, freeRetries: CFG.freeRetries,
                wrong: new Set(), wrongAttempts: 0, answered: false, locked: false, correctCount: 0, roundsSurvived: 0, inQuestion: false,
            };
            m.players.set(s.id, st);
            m.startCount++;
            const pl = s.player;
            pl.inMatch = true; pl.alive = true; pl.slot = slot; pl.height = st.height; pl.dancing = false; pl.celebrate = false;
            const spot = SLOTS[slot];
            this.place(s, spot.x, towerTopY(st.height), spot.z, Math.PI, 'tower');
            s.stats.games++;
            s.stats.modes[mode] = (s.stats.modes[mode] || 0) + 1;
            if (pending) this.toast(s, '🧱 Your saved +' + pending + ' blocks are on your tower!', GOLD);
            slot++;
        }
        if (!m.startCount) return false;
        this.match = m;
        this.state.matchId = m.id;
        this.state.mode = mode;
        this.state.round = 0;
        this.state.started = m.startCount;
        this.state.alive = m.startCount;
        this.setLava(-1, 0);
        return true;
    }

    questionPayload() {
        const m = this.match, q = m.question;
        return {
            id: m.qid, text: q.text, options: q.options, prompt: q.prompt, hint: q.hint || '', visual: q.visual || null, small: !!q.small,
            kind: q.kind, round: m.round, mode: m.mode, dur: CFG.question, hintDelay: CFG.hintDelay, endsAt: m.qEnds,
        };
    }

    async runQuestion() {
        const m = this.match;
        m.question = generateQuestion(m.mode, m.round, m.history);
        m.qid++;
        m.qStart = Date.now();
        m.qEnds = m.qStart + CFG.question * 1000;
        for (const st of m.players.values()) {
            Object.assign(st, { answered: false, locked: false, wrongAttempts: 0, answerTime: 0, answerText: '', lastWrongText: '', inQuestion: st.alive });
            st.wrong = new Set();
        }
        this.setPhase('question', CFG.question);
        this.broadcast('question', this.questionPayload());
        while (Date.now() < m.qEnds) {
            await this.wait(0.1);
            if (this.match !== m || this.shouldEnd()) return;
        }
    }

    onAnswer(client, msg) {
        const m = this.match;
        if (!m || this.state.phase !== 'question' || msg.id !== m.qid) return;
        const st = m.players.get(client.sessionId), s = this.sessions.get(client.sessionId), q = m.question;
        if (!st || !s || !st.alive || st.answered || st.locked || !q) return;
        const i = msg.i;
        if (!Number.isInteger(i) || i < 0 || i >= q.options.length || st.wrong.has(i)) return;
        const elapsed = (Date.now() - m.qStart) / 1000;
        const choice = q.options[i];
        if (choice === q.answer) {
            st.answered = true; st.answerTime = elapsed; st.answerText = choice; st.correctCount++;
            const blocks = blockReward(elapsed, st.wrongAttempts);
            this.addBlocks(st, blocks);
            const gems = this.addGems(s, CFG.gemsPerCorrect, 'answer');
            s.profile.answers++;
            s.stats.answers++;
            client.send('answerResult', { id: m.qid, i, correct: true, blocks, gems, time: Math.round(elapsed * 10) / 10 });
            this.changed(s);
            return;
        }
        st.wrong.add(i);
        st.wrongAttempts++;
        st.lastWrongText = choice;
        s.stats.wrong++;
        const unlimited = this.hasPass(s, 'UnlimitedAnswers');
        st.locked = !unlimited;
        client.send('answerResult', { id: m.qid, i, correct: false, locked: st.locked, unlimited, retries: this.retriesLeft(st, s) });
    }
    retriesLeft(st, s) { return st.freeRetries + (s.profile.retries || 0); }
    consumeRetry(st, s) {
        if (st.freeRetries > 0) { st.freeRetries--; return true; }
        if (s.profile.retries > 0) { s.profile.retries--; this.changed(s); return true; }
        return false;
    }
    // "Use Second Chance": spend a retry to answer again
    onRetry(client) {
        const m = this.match;
        if (!m || this.state.phase !== 'question') return;
        const st = m.players.get(client.sessionId), s = this.sessions.get(client.sessionId);
        if (!st || !s || !st.alive || !st.locked || st.answered) return;
        if (this.hasPass(s, 'UnlimitedAnswers') || this.consumeRetry(st, s)) {
            st.locked = false;
            client.send('answerResult', { id: m.qid, unlocked: true, retries: this.retriesLeft(st, s) });
        } else client.send('noRetries', {});
    }
    // Bought retries in the middle of a question: unlock straight away
    retryUnlock(s) {
        const m = this.match;
        if (!m || this.state.phase !== 'question') return;
        const st = m.players.get(s.id);
        if (st && st.alive && st.locked && !st.answered && this.consumeRetry(st, s)) {
            st.locked = false;
            s.client.send('answerResult', { id: m.qid, unlocked: true, retries: this.retriesLeft(st, s) });
        }
    }

    addBlocks(st, n) {
        st.height = Math.min(st.height + n, 5000);
        const s = this.sessions.get(st.id);
        if (s) s.player.height = st.height;
    }
    grantBlocks(s, n) {
        const st = this.match && this.match.players.get(s.id);
        if (!st || !st.alive) return false;
        this.addBlocks(st, n);
        return true;
    }

    async runResults() {
        const m = this.match, q = m.question;
        const entries = [];
        for (const st of m.players.values()) {
            if (!st.inQuestion) continue;
            if (st.answered) entries.push({ s: st.id, n: st.name, t: st.answerText, c: true, tm: Math.round(st.answerTime * 10) / 10 });
            else if (st.lastWrongText) entries.push({ s: st.id, n: st.name, t: st.lastWrongText, c: false });
            else entries.push({ s: st.id, n: st.name, t: '-', c: false, na: true });
        }
        entries.sort((a, b) => (a.c !== b.c ? (a.c ? -1 : 1) : a.c ? a.tm - b.tm : (!!a.na - !!b.na) || a.n.localeCompare(b.n)));
        this.setPhase('results', CFG.results);
        this.broadcast('results', { id: m.qid, reveal: q.reveal, answer: q.answer, text: q.text, visual: q.visual || null, entries });
        await this.wait(CFG.results);
    }

    async runRising(rise) {
        const m = this.match;
        this.setPhase('rising', CFG.lavaRise);
        this.announce('Lava is rising!', CFG.lavaRise, 'lava');
        this.setLava(m.lava + rise, CFG.lavaRise);
        await this.wait(CFG.lavaRise + 0.15);
        if (this.match !== m) return;
        const n = this.eliminateBelowLava('lava');
        for (const st of m.players.values()) {
            if (!st.alive) continue;
            st.roundsSurvived++;
            const s = this.sessions.get(st.id);
            if (s) s.stats.bestRound = Math.max(s.stats.bestRound, st.roundsSurvived);
        }
        if (n > 0) { this.setPhase('elimination', CFG.elimination); await this.wait(CFG.elimination); } else await this.wait(0.8);
    }

    eliminateBelowLava(reason) {
        const m = this.match;
        if (!m) return 0;
        const victims = [...m.players.values()].filter((st) => st.alive && st.height <= m.lava).sort((a, b) => b.height - a.height);
        if (victims.length) this.eliminate(victims, reason);
        return victims.length;
    }

    eliminate(list, reason) {
        const m = this.match;
        if (!m || !list.length) return;
        for (const st of list) { st.alive = false; st.elimRound = m.round; }
        m.order.push(list);
        const names = list.map((st) => st.name);
        const text = reason === 'left' ? `${joinNames(names)} left the game!` : names.length === 1 ? `${names[0]} was eliminated!` : `${joinNames(names)} were eliminated!`;
        this.broadcast('elim', { ids: list.map((st) => st.id), text });
        this.announce(text, CFG.elimination, 'danger');
        this.state.alive = this.aliveList().length;
        for (const st of list) {
            const s = this.sessions.get(st.id);
            if (!s) continue;
            s.player.alive = false;
            // Burn on the tower for a moment, then back to the lobby (to watch or wait)
            this.clock.setTimeout(() => {
                // (the game may have ended and sent everyone back already)
                if (!this.sessions.has(st.id) || !s.player.inMatch) return;
                this.clearPlayer(s.player);
                if (reason !== 'left') this.toLobby(s, 'eliminated');
            }, 1400);
        }
    }

    placements() {
        const m = this.match;
        const out = this.aliveList().sort((a, b) => b.height - a.height);
        for (let i = m.order.length - 1; i >= 0; i--) out.push(...m.order[i]);
        return out;
    }

    async finishMatch() {
        const m = this.match;
        const list = this.placements();
        const counted = m.startCount >= CFG.minPlayersForWin;
        const rewards = [CFG.gemsWin, CFG.gems2nd, CFG.gems3rd];
        list.forEach((st, i) => {
            const s = this.sessions.get(st.id);
            if (!s) return;
            const p = s.profile, place = i + 1;
            p.games++;
            p.bestRound = Math.max(p.bestRound || 0, st.roundsSurvived);
            let gems = 0;
            if (counted && rewards[i]) gems = this.addGems(s, rewards[i], 'place');
            if (counted && place === 1) { p.wins++; s.stats.wins++; }
            s.client.send('placed', { place, total: m.startCount, counted, gems, rounds: st.roundsSurvived, correct: st.correctCount });
            this.changed(s);
        });
        const winner = list[0];
        if (winner) {
            this.announce(counted ? `${winner.name} wins! 🏆` : `Game over! You survived ${winner.roundsSurvived} rounds!`, CFG.victory, 'victory');
            const ws = this.sessions.get(winner.id);
            if (winner.alive && ws) ws.player.celebrate = true;
        }
        this.setPhase('victory', CFG.victory);
        await this.wait(CFG.victory);

        const top = list.slice(0, 3).map((st, i) => ({ place: i + 1, name: st.name, s: st.id }));
        for (const st of m.players.values()) {
            const s = this.sessions.get(st.id);
            if (!s) continue;
            const wasAlive = s.player.inMatch;
            this.clearPlayer(s.player);
            if (wasAlive) this.toLobby(s, 'lobby');
        }
        this.broadcast('ended', { placements: top, counted, rounds: m.round, mode: m.mode });
        this.match = null;
        this.state.matchId = 0; this.state.round = 0; this.state.alive = 0; this.state.started = 0; this.state.mode = '';
        this.setLava(-2, 3);
        markDirty();
        await this.wait(1);
    }

    // Nuke: in a game the lava surges for everyone (the buyer's tower grows the same); in the
    // lobby everyone else is blown off their feet
    nuke(s) {
        const m = this.match;
        const inGame = !!(m && m.players.get(s.id) && m.players.get(s.id).alive);
        this.broadcast('nuke', { by: s.profile.name, s: s.id, where: m ? 'arena' : 'lobby' });
        this.announce('☢️ ' + s.profile.name + ' launched a NUKE! ☢️', 3.5, 'danger');
        if (!m) return;
        const id = m.id;
        this.clock.setTimeout(async () => {
            if (!this.match || this.match.id !== id) return;
            const st = this.match.players.get(s.id);
            if (inGame && st && st.alive) this.addBlocks(st, CFG.nukeRise);
            this.setLava(Math.max(this.match.lava, 0) + CFG.nukeRise, 1.2);
            await this.wait(1.3);
            if (this.match && this.match.id === id) this.eliminateBelowLava('nuke');
        }, 1800);
    }

    // =====================================================================================
    // Bloxity
    // =====================================================================================
    // Logged in to Bloxity after joining: move this session onto the Bloxity profile
    async onBloxityLogin(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || s.authing) return;
        s.authing = true;
        const legion = await verifyBloxityToken(m.token);
        s.authing = false;
        if (!legion || !this.sessions.has(client.sessionId)) return;
        const uid = 'legion_' + legion.id;
        if (s.profile.uid === uid) return;
        const name = cleanName(legion.name) || s.profile.name;
        const guestProfile = s.profile;
        await adoptGuestProgress(uid, guestProfile.uid, name);
        await loadProfile(uid);
        if (!this.sessions.has(client.sessionId)) return;
        s.profile = getProfile(uid, name, randomName());
        this.fixProfile(s.profile);
        if (!isOnline(guestProfile.uid)) releaseProfile(guestProfile.uid, isOnline);
        this.changed(s);
        client.send('authed', { name: s.profile.name });
        this.toast(s, 'Logged in as ' + s.profile.name, GREEN);
        this.broadcastBoards();
    }
    onAvatar(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (s && m) s.player.av = cleanAvatar(m.av);
    }
    // Emote ids are opaque catalogue ids; other players play the same clip
    onEmote(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.id !== 'string' || m.id.length > 40) return;
        this.broadcast('emote', { s: client.sessionId, id: m.id }, { except: client });
    }
    onChat(client, m) {
        const s = this.sessions.get(client.sessionId);
        if (!s || !m || typeof m.text !== 'string') return;
        const now = Date.now();
        if (now - s.lastChat < 800) return;
        s.lastChat = now;
        const text = m.text.replace(/\s+/g, ' ').trim().slice(0, 120);
        if (text) this.broadcast('chat', { s: client.sessionId, name: s.profile.name, vip: !!s.profile.passes.VIP, text });
    }
}

function isOnline(uid) {
    for (const room of liveRooms) for (const s of room.sessions.values()) if (s.profile.uid === uid) return true;
    return false;
}

