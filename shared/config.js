// Game data shared by the client and the Colyseus server.
// Math Tower Race: answer math questions fast to stack blocks under your feet before the lava
// rising after every round reaches you. The last player standing wins.
// There are no in-app purchases: +10 Blocks, Nuke, retries, VIP, Unlimited Answers, Algebra Mode,
// tower skins, block animations, victory dances and pet eggs all cost Gems (earned by playing).

export const CFG = {
    // Roblox defaults: jump power 50, gravity 196.2 (a jump rises about 6.4 studs)
    grav: 196.2,
    jumpV: 50,
    walk: 18,
    maxPlayers: 24,

    // ----- the match (seconds) -----
    minPlayers: 1,            // a game starts with this many players (alone it's practice: no Win)
    minPlayersForWin: 2,      // a Win only counts when at least this many started
    intermission: 15,         // "Game starts in N"
    voting: 15,               // "Voting ends in N"
    voteResult: 3,            // "'Medium' was selected!"
    getReady: 3,              // the lava floods the pit
    roundIntro: 2.5,          // "The lava will rise by N blocks after this round!"
    question: 15,             // time to answer
    results: 4,               // the answer list
    lavaRise: 2.5,            // the lava rising
    elimination: 2.5,         // "X was eliminated!"
    victory: 6,               // the winner dances on their tower
    placementsShow: 9,        // "X finished in 1st place!" in the lobby
    maxRounds: 60,
    hintDelay: 5,             // a hint pops up after this long (or right after a wrong answer)
    freeRetries: 2,           // free second chances every game

    // ----- towers -----
    blockH: 1.5,
    towerW: 6,
    startBlocks: 1,           // the slab you start on counts as the first block
    maxBlocks: 12,            // answering instantly
    minBlocks: 3,             // answering on the buzzer
    blocksLostPerSec: 0.6,
    retryPenalty: 2,          // fewer blocks per wrong attempt
    buildInterval: 0.065,     // seconds between stacked blocks (client animation)
    plusBlocks: 10,           // "+10 Blocks!"
    nukeRise: 10,             // "Nuke!": the lava surges this many blocks (your tower grows the same)
    retriesPack: 3,

    // ----- gems -----
    gemsPerCorrect: 5,
    gemsWin: 100,
    gems2nd: 40,
    gems3rd: 20,
    pickupGems: 1,
    pickupRespawn: 40,
    vipPickupRespawn: 15,
    chestGems: 100,
    chestHours: 20,
    vipGemsMult: 1.5,

    // ----- pets -----
    maxPets: 60,
    petSlots: 3,
    vipPetSlots: 4,
};

// How many blocks the lava rises after round N. Past the end of the list it grows by 1 every
// round, so even perfect players are caught eventually (answering in ~3s survives ~23 rounds).
export const LAVA_RISE = [1, 4, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 12, 12, 13];
export const lavaRise = (round) => (round <= LAVA_RISE.length ? LAVA_RISE[round - 1] : LAVA_RISE[LAVA_RISE.length - 1] + (round - LAVA_RISE.length));

// The faster you answer, the more blocks you earn
export function blockReward(elapsed, wrongAttempts) {
    const b = clamp(Math.round(CFG.maxBlocks - elapsed * CFG.blocksLostPerSec), CFG.minBlocks, CFG.maxBlocks) - (wrongAttempts || 0) * CFG.retryPenalty;
    return Math.max(1, b);
}

// ----- difficulties (the vote pads) -----
export const DIFFICULTIES = [
    { id: 'Easy', name: 'Easy', color: '#3ec4ff', dark: '#1478c8' },
    { id: 'Medium', name: 'Medium', color: '#ffd64f', dark: '#d69614' },
    { id: 'Hard', name: 'Hard', color: '#ff525c', dark: '#be1e32' },
    { id: 'Algebra', name: 'Algebra', color: '#b06cff', dark: '#6e32c8', pass: 'AlgebraMode' },
];
export const diffById = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d]));
export const DEFAULT_DIFFICULTY = 'Medium';

// ----- tower skins (the blocks your tower is made of) -----
// colors repeat per block (stripes); rainbow skins compute their colour from the block index.
export const TOWERS = [
    { id: 'stone', name: 'Stone', price: 0, colors: [0xb4b3b8, 0xa2a1a8], rough: 0.8 },
    { id: 'brick', name: 'Brick', price: 100, colors: [0xc85440, 0xb04838], rough: 0.85 },
    { id: 'wood', name: 'Wood', price: 150, colors: [0xc88c54, 0xb07a46], rough: 0.75 },
    { id: 'grass', name: 'Grassy', price: 250, colors: [0x60c848, 0x7a5434, 0x7a5434], rough: 0.8 },
    { id: 'candy', name: 'Candy', price: 400, colors: [0xff78b4, 0xfff5fa], rough: 0.35 },
    { id: 'ice', name: 'Ice', price: 500, colors: [0x96dcff, 0xbef0ff], rough: 0.08, opacity: 0.82 },
    { id: 'gold', name: 'Gold', price: 750, colors: [0xffc828, 0xf0b014], rough: 0.25, metal: 0.85, sparkle: true },
    { id: 'rainbow', name: 'Rainbow', price: 1000, rainbow: true, rough: 0.4 },
    { id: 'ghost', name: 'Ghost', price: 1200, colors: [0xdcf0ff], rough: 0.2, opacity: 0.5, glow: 0.4 },
    { id: 'neon', name: 'Neon', price: 1500, colors: [0x00ffe6, 0xff3cdc], neon: true },
    { id: 'electric', name: 'Electric', price: 2000, colors: [0xfff03c, 0xffc800], neon: true, sparkle: true },
    { id: 'magma', name: 'Magma', price: 2500, colors: [0xff6e1e, 0x5a2a1a], rough: 0.6, glow: 0.5 },
    { id: 'diamond', name: 'Diamond', price: 4000, colors: [0x78ffff, 0x50d2ff], rough: 0.05, metal: 0.3, opacity: 0.88, sparkle: true },
    { id: 'galaxy', name: 'Galaxy', price: 7500, colors: [0x5a1eaa, 0x280a5a, 0xaa3cff], neon: true, sparkle: true },
];
export const towerById = Object.fromEntries(TOWERS.map((d) => [d.id, d]));
export function towerColor(id, i) {
    const s = towerById[id] || TOWERS[0];
    if (s.rainbow) { const h = (i * 0.07) % 1; return hsl(h, 0.75, 0.6); }
    return s.colors[(i - 1) % s.colors.length];
}

// ----- block animations: how every new block pops onto the tower -----
export const ANIMS = [
    { id: 'stack', name: 'Classic Stack', price: 0, ic: '⬆️', desc: 'Blocks slide up under you' },
    { id: 'pop', name: 'Pop', price: 200, ic: '💥', desc: 'Blocks pop in with a bounce' },
    { id: 'drop', name: 'Sky Drop', price: 400, ic: '☁️', desc: 'Blocks fall from the sky' },
    { id: 'spin', name: 'Spinner', price: 650, ic: '🌀', desc: 'Blocks spin into place' },
    { id: 'flash', name: 'Flashbang', price: 900, ic: '⚡', desc: 'Blocks flash white as they land' },
    { id: 'sparkle', name: 'Sparkle', price: 1300, ic: '✨', desc: 'A burst of sparkles for every block' },
    { id: 'fire', name: 'Inferno', price: 2200, ic: '🔥', desc: 'Blocks arrive in a puff of fire' },
];
export const animById = Object.fromEntries(ANIMS.map((d) => [d.id, d]));

// ----- victory dances (Dance: ON in the lobby, and when you win) -----
export const DANCES = [
    { id: 'classic', name: 'Classic Dance', price: 0, ic: '🕺' },
    { id: 'wave', name: 'Big Wave', price: 150, ic: '👋' },
    { id: 'cheer', name: 'Cheer', price: 300, ic: '🙌' },
    { id: 'laugh', name: 'Laugh It Up', price: 450, ic: '😆' },
    { id: 'groove', name: 'Groove', price: 800, ic: '💃' },
    { id: 'shuffle', name: 'Shuffle', price: 1200, ic: '🦶' },
    { id: 'tornado', name: 'Tornado Spin', price: 2000, ic: '🌪️' },
];
export const danceById = Object.fromEntries(DANCES.map((d) => [d.id, d]));

// Shop categories: profile keys for what you own / have equipped
export const COSMETICS = {
    towers: { list: TOWERS, byId: towerById, owned: 'towers', equipped: 'tower' },
    anims: { list: ANIMS, byId: animById, owned: 'anims', equipped: 'anim' },
    dances: { list: DANCES, byId: danceById, owned: 'dances', equipped: 'dance' },
};

// ----- pets (hatched from eggs, paid in Gems); equipped pets multiply the Gems you earn -----
export const RARITY = {
    common: { name: 'Common', color: '#b8c4d8', order: 0 },
    rare: { name: 'Rare', color: '#3aa8ff', order: 1 },
    epic: { name: 'Epic', color: '#c45aff', order: 2 },
    legendary: { name: 'Legendary', color: '#ffb81c', order: 3 },
    mythic: { name: 'Mythic', color: '#ff3f7a', order: 4 },
};
export const PETS = [
    { id: 'blueSlime', name: 'Blue Slime', rarity: 'common', mult: 1.1, kind: 'slime', color: 0x4ac8ff },
    { id: 'greenSlime', name: 'Green Slime', rarity: 'common', mult: 1.15, kind: 'slime', color: 0x6aff5a },
    { id: 'mochi', name: 'Mochi Bun', rarity: 'common', mult: 1.2, kind: 'bun', color: 0xfff0f4 },
    { id: 'jellyBear', name: 'Jelly Bear', rarity: 'rare', mult: 1.35, kind: 'bear', color: 0xff6a6a, clear: true },
    { id: 'peach', name: 'Peach Squish', rarity: 'rare', mult: 1.5, kind: 'peach', color: 0xffa88a },
    { id: 'cloud', name: 'Cloud Squish', rarity: 'epic', mult: 1.8, kind: 'cloud', color: 0xf4f8ff },

    { id: 'pinkSlime', name: 'Pink Slime', rarity: 'rare', mult: 1.5, kind: 'slime', color: 0xff7ad0 },
    { id: 'calcCat', name: 'Calculator Cat', rarity: 'rare', mult: 1.7, kind: 'keycat', color: 0xffb8e8 },
    { id: 'star', name: 'Star Squish', rarity: 'epic', mult: 2.2, kind: 'star', color: 0xffe04a },
    { id: 'countFrog', name: 'Counting Frog', rarity: 'epic', mult: 2.5, kind: 'frog', color: 0x7aff6a },
    { id: 'abacusDog', name: 'Abacus Dog', rarity: 'legendary', mult: 3.2, kind: 'dog', color: 0xffe0b0 },
    { id: 'goldSlime', name: 'Gold Slime', rarity: 'legendary', mult: 3.5, kind: 'slime', color: 0xffcc2a, shiny: true },

    { id: 'galaxy', name: 'Galaxy Squish', rarity: 'epic', mult: 3, kind: 'bun', color: 0x6a3aff, galaxy: true },
    { id: 'piBunny', name: 'Pi Bunny', rarity: 'legendary', mult: 4, kind: 'keybunny', color: 0xc8f0ff },
    { id: 'rainbowDragon', name: 'Rainbow Dragon', rarity: 'legendary', mult: 5, kind: 'dragon', color: 0xff3fd8, rainbow: true },
    { id: 'rainbowSlime', name: 'Rainbow Slime', rarity: 'mythic', mult: 8, kind: 'slime', color: 0xffffff, rainbow: true },
    { id: 'goldenCalc', name: 'Golden Calculator', rarity: 'mythic', mult: 12, kind: 'keycat', color: 0xffc828, shiny: true },
];
export const petById = Object.fromEntries(PETS.map((d) => [d.id, d]));

export const EGGS = [
    { id: 'basic', name: 'Basic Egg', price: 250, ic: '🥚', color: 0xf5f0e1, spots: 0x78c8ff, drops: [['blueSlime', 34], ['greenSlime', 30], ['mochi', 18], ['jellyBear', 10], ['peach', 6], ['cloud', 2]] },
    { id: 'golden', name: 'Golden Egg', price: 1000, ic: '🪺', color: 0xffd23c, spots: 0xffffff, drops: [['pinkSlime', 30], ['calcCat', 26], ['star', 20], ['countFrog', 14], ['abacusDog', 7], ['goldSlime', 3]] },
    { id: 'genius', name: 'Genius Egg', price: 5000, ic: '🧠', color: 0x8c5aff, spots: 0xffdc5a, drops: [['galaxy', 36], ['piBunny', 30], ['rainbowDragon', 22], ['rainbowSlime', 9], ['goldenCalc', 3]] },
];
export const eggById = Object.fromEntries(EGGS.map((d) => [d.id, d]));
export function rollEgg(egg, rnd) {
    const total = egg.drops.reduce((a, d) => a + d[1], 0);
    let r = rnd() * total;
    for (const [id, w] of egg.drops) { r -= w; if (r <= 0) return id; }
    return egg.drops[0][0];
}
export function petMult(ids) {
    let bonus = 0;
    for (const id of ids) { const d = petById[id]; if (d) bonus += d.mult - 1; }
    return 1 + bonus;
}
export const petSlots = (p) => (p.passes && p.passes.VIP ? CFG.vipPetSlots : CFG.petSlots);
export function equippedIds(p) {
    const byU = new Map((p.pets || []).map((x) => [x.u, x.id]));
    return (p.equippedPets || []).map((u) => byU.get(u)).filter(Boolean);
}
export function gemsMult(p) {
    let m = petMult(equippedIds(p));
    if (p.passes && p.passes.DoubleGems) m *= 2;
    if (p.passes && p.passes.VIP) m *= CFG.vipGemsMult;
    return m;
}

// ----- the Gem shop -----
export const PASSES = {
    VIP: { name: 'VIP', price: 3000, ic: '👑', desc: '+50% Gems, VIP tag, the VIP lounge and 4 pet slots' },
    DoubleGems: { name: 'x2 Gems', price: 8000, ic: '💎', desc: 'Double Gems forever' },
    UnlimitedAnswers: { name: 'Unlimited Answers', price: 5000, ic: '♾️', desc: 'Never run out of second chances' },
    AlgebraMode: { name: 'Algebra Mode', price: 1500, ic: '🧮', desc: 'Vote for the secret Algebra difficulty' },
};
export const PRODUCTS = {
    PlusBlocks: { name: '+10 Blocks!', price: 75, ic: '🧱', desc: 'Instantly stack 10 blocks onto your tower' },
    Nuke: { name: 'Nuke!', price: 500, ic: '☢️', desc: 'The lava surges for everyone else!' },
    Retries: { name: '+3 Retries', price: 60, ic: '❤️', desc: 'Three more second chances' },
};

export const CODES = {
    MATH: { gems: 100 },
    TOWER: { gems: 150 },
    GENIUS: { gems: 250 },
    LEGION: { gems: 200 },
    RELEASE: { gems: 300 },
};

// The reaction bar under the screen (like the reference)
export const EMOJIS = ['🔥', '😂', '😭', '🤔', '💀'];

// Blocky fallback bodies before the Bloxity avatar loads
export const KITS = [
    { shirt: 0x1c1c22, shorts: 0x24242c, socks: 0x1c1c22 },
    { shirt: 0x3ac8ff, shorts: 0x2a2a4a, socks: 0xffffff },
    { shirt: 0xff7ad0, shorts: 0x3a3a5a, socks: 0xffffff },
    { shirt: 0x6aff5a, shorts: 0x2a3a2a, socks: 0xffffff },
    { shirt: 0xffd028, shorts: 0x3a2a1a, socks: 0xffffff },
    { shirt: 0xc45aff, shorts: 0x2a1a3a, socks: 0xffffff },
];
export const SKINS = [0xffcfa8, 0xe1af87, 0xc88c5f, 0x8c5a3c, 0xf0c8a0];

// ----- formatting -----
export function fmt(v) {
    v = Math.floor(v || 0);
    if (v < 1000) return String(v);
    const u = ['', 'K', 'M', 'B', 'T'];
    let i = 0, x = v;
    while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
    return (x >= 100 ? Math.floor(x) : Math.floor(x * 10) / 10) + u[i];
}
export const fmtComma = (v) => Math.floor(v || 0).toLocaleString('en-US');
export function clock(s) {
    s = Math.max(0, Math.ceil(s));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
}
export function ordinal(n) {
    const t = n % 100;
    if (t >= 11 && t <= 13) return n + 'th';
    return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
}
// "A", "A and B", "A, B and C", "A, B, C and 3 others"
export function joinNames(names, max = 3) {
    if (names.length <= 1) return names[0] || '';
    if (names.length <= max) return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    return names.slice(0, max).join(', ') + ' and ' + (names.length - max) + ' others';
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function hsl(h, s, l) {
    const k = (n) => (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}
