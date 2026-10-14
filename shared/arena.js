// The world layout, shared by the client (which builds it) and the server (which checks votes,
// gem pickups and tower heights against it). Units are studs, y = 0 is the lobby grass.
//
//                         north (-z)
//            [ vote pads: Easy Medium Hard Algebra ]
//                     [ big question screen ]
//   victory   |   ===== walkway around the pit =====   |   tower
//   dances    |   [     the lava pit (arena)      ]    |   skins
//   (west     |   ==================================   |   (east
//    path)    |                                         |    path)
//      podium  [Top Wins] [How to Play] [Top Answers]  podium
//                          [ spawn plaza ]
//   ========================= cross path ===================> VIP door
//   eggs x3     pass pads   gem chest   pass pads     | VIP lounge |
//                         south (+z)
// Every feature has its own spot with room around it; paths connect them.
import { CFG, DIFFICULTIES } from './config.js';

export const ISLAND = 150;                  // half size of the grass island
export const BEACH = 182;                   // half size of the sand ring around it
export const PIT = { x: 60, z: 48, depth: 14 };
export const FLOOR_Y = -PIT.depth;          // the bottom of the lava pit

export const SPAWN = { x: 0, y: 0, z: 110, yaw: Math.PI };   // facing north, towards the arena
export const SCREEN = { x: 0, z: -60, y: 23, w: 60, h: 30 }; // the big question screen (you can walk under it)

// Vote pads (north of the pit) and where voters are dropped in front of them
export const VOTE = { z: -108, half: 12, spacing: 30, area: { x0: -42, x1: 42, z0: -90, z1: -76 } };
export const VOTE_PADS = DIFFICULTIES.map((d, i) => ({ ...d, x: (i - (DIFFICULTIES.length - 1) / 2) * VOTE.spacing, z: VOTE.z }));
export function padAt(x, z) {
    for (const p of VOTE_PADS) if (Math.abs(x - p.x) <= VOTE.half && Math.abs(z - p.z) <= VOTE.half) return p;
    return null;
}

// Tower slots in the pit: a 6 x 5 grid, ordered so the first players are spread out (checkerboard)
const COLS = 6, ROWS = 5, SPACING = 16;
export const SLOTS = (() => {
    const a = [], b = [];
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const p = { x: (c - (COLS - 1) / 2) * SPACING, z: (r - (ROWS - 1) / 2) * SPACING };
            ((r + c) % 2 === 0 ? a : b).push(p);
        }
    }
    return [...a, ...b];
})();
export const MAX_IN_MATCH = SLOTS.length;

export const towerTopY = (height) => FLOOR_Y + height * CFG.blockH;
export const lavaY = (level) => FLOOR_Y + level * CFG.blockH;

// The walkway around the pit fence: [inner, outer] distance from the centre on each axis
export const WALK = { x: [63, 69], z: [51, 57] };
// Paths (flat stone strips): { x0, x1, z0, z1 }
export const CROSS_Z = 122;                  // the east-west path south of the spawn, ending at the VIP door
export const PATHS = [
    { x0: -4, x1: 4, z0: WALK.z[1], z1: 134 },                   // the avenue: pit, How to Play arch, spawn, gem chest
    { x0: -124, x1: 100, z0: CROSS_Z - 3, z1: CROSS_Z + 3 },     // the cross path
    { x0: -124, x1: -118, z0: -84, z1: CROSS_Z - 3 },            // west path (victory dances)
    { x0: 118, x1: 124, z0: -104, z1: 72 },                      // east path (tower skins)
    { x0: -118, x1: -WALK.x[1], z0: -3, z1: 3 },                 // pit walkway -> west path
    { x0: WALK.x[1], x1: 118, z0: -3, z1: 3 },                   // pit walkway -> east path
    { x0: -4, x1: 4, z0: -92, z1: -WALK.z[1] },                  // pit walkway -> vote deck
];
export const PLAZA = { x: SPAWN.x, z: SPAWN.z, r: 15 };

// Lobby features
export const HOW_TO = { x: 0, z: 76, lift: 8 };               // an arch over the avenue
export const BOARDS = {
    wins: { x: -46, z: 78, title: 'Top Wins', icon: '🏆' },
    answers: { x: 46, z: 78, title: 'Top Answers', icon: '✅' },
};
export const PODIUMS = {
    wins: { x: -84, z: 80 },
    answers: { x: 84, z: 80 },
};
export const PADS = {
    UnlimitedAnswers: { x: -62, z: 138, color: 0xff4a5a, ic: '♾️', label: 'Unlimited Answers' },
    AlgebraMode: { x: -32, z: 138, color: 0xb06cff, ic: '🧮', label: 'Algebra Mode' },
    WatchGame: { x: 32, z: 138, color: 0x50e678, ic: '📺', label: 'Watch Game' },
    VIP: { x: 62, z: 138, color: 0xffc828, ic: '👑', label: 'VIP' },
};
export const CHEST = { x: 0, z: 139 };
export const VIP_LOUNGE = { x0: 100, x1: 144, z0: 100, z1: 144, door: { x: 100, z: CROSS_Z } };
export const EGG_STANDS = [{ x: -118, z: 137 }, { x: -102, z: 137 }, { x: -86, z: 137 }];
export const TOWER_SHOP = { x: 134, z0: -92, step: 12.5 };   // one display per tower skin, north to south
export const DANCE_SHOP = { x: -134, z0: -70, step: 17 };

// Spaces kept clear of gems and decor: { x0, x1, z0, z1 } (feature footprints plus a margin)
export const KEEP_CLEAR = [
    { x0: -PIT.x - 14, x1: PIT.x + 14, z0: -PIT.z - 16, z1: PIT.z + 14 },          // pit, walkway, screen
    { x0: -66, x1: 66, z0: -132, z1: -86 },                                       // vote deck and signs
    { x0: -102, x1: 102, z0: 68, z1: 92 },                                        // boards and podiums
    { x0: -16, x1: 16, z0: SPAWN.z - 16, z1: SPAWN.z + 16 },                      // spawn plaza
    { x0: -130, x1: 74, z0: 128, z1: 150 },                                       // eggs, pads, chest
    { x0: VIP_LOUNGE.x0 - 8, x1: 150, z0: VIP_LOUNGE.z0 - 8, z1: 150 },           // VIP lounge
    { x0: 126, x1: 150, z0: -110, z1: 86 },                                       // tower skin row
    { x0: -150, x1: -126, z0: -90, z1: 60 },                                      // dance row
];
// Round trees on the lawns (the client draws them, gems keep away from them)
export const TREES = [
    { x: -140, z: -140, s: 1.2 }, { x: 140, z: -140, s: 1.2 }, { x: -140, z: 140, s: 1.15 },
    { x: -100, z: -138, s: 1 }, { x: 100, z: -138, s: 1 },
    { x: -96, z: -44, s: 1.1 }, { x: -96, z: 36, s: 1 }, { x: 96, z: -44, s: 1.1 }, { x: 96, z: 36, s: 1 },
    { x: -62, z: 104, s: 0.9 }, { x: 62, z: 104, s: 0.9 }, { x: -138, z: 98, s: 1 },
];
// Bushes along the paths and around the plaza, and little flower beds
export const BUSHES = [
    { x: -112, z: -66 }, { x: -112, z: -10 }, { x: -112, z: 54 }, { x: -112, z: 104 },
    { x: 112, z: -86 }, { x: 112, z: -10 }, { x: 112, z: 56 },
    { x: -18, z: 96 }, { x: 18, z: 96 }, { x: -76, z: -108 }, { x: 76, z: -108 },
];
export const FLOWER_BEDS = [{ x: -28, z: 104 }, { x: 28, z: 104 }, { x: -12, z: 66 }, { x: 12, z: 66 }];
export const isClear = (x, z, m) => !KEEP_CLEAR.some((r) => x > r.x0 - (m || 0) && x < r.x1 + (m || 0) && z > r.z0 - (m || 0) && z < r.z1 + (m || 0));
const onPath = (x, z) => PATHS.some((p) => x > p.x0 - 1 && x < p.x1 + 1 && z > p.z0 - 1 && z < p.z1 + 1);

// Gem pickups: fixed spots spread over the open lawns (and a ring inside the VIP lounge)
export const GEM_SPOTS = (() => {
    const spots = [];
    let s = 9;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const free = (x, z) => isClear(x, z, 3) && !onPath(x, z) && TREES.every((t) => Math.hypot(t.x - x, t.z - z) > 10) && [...BUSHES, ...FLOWER_BEDS].every((b) => Math.hypot(b.x - x, b.z - z) > 6) && spots.every((p) => Math.hypot(p.x - x, p.z - z) > 14);
    for (let guard = 0; spots.length < 34 && guard < 8000; guard++) {
        const x = (rnd() * 2 - 1) * (ISLAND - 10), z = (rnd() * 2 - 1) * (ISLAND - 10);
        if (free(x, z)) spots.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, vip: false });
    }
    const cx = (VIP_LOUNGE.x0 + VIP_LOUNGE.x1) / 2, cz = (VIP_LOUNGE.z0 + VIP_LOUNGE.z1) / 2;
    for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        spots.push({ x: Math.round((cx + Math.cos(a) * 14) * 10) / 10, z: Math.round((cz + Math.sin(a) * 14) * 10) / 10, vip: true });
    }
    return spots.map((p, i) => ({ ...p, i, y: 2.5 }));
})();
