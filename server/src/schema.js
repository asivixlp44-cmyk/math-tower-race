import { schema, t } from '@colyseus/schema';

// Public, synced to every client. Private progress (gems, pets owned, cosmetics, settings...) is
// sent only to its owner with the "profile" message.
export const PlayerState = schema({
    name: t.string().default(''),
    x: t.float32().default(0),
    y: t.float32().default(0),
    z: t.float32().default(0),
    ry: t.angle(),
    anim: t.uint8().default(0),     // 0 idle, 1 run, 2 air
    av: t.string().default(''),     // packed Bloxity avatar (equipped ids + proportions)
    kit: t.uint8().default(0),
    skin: t.uint8().default(0),
    wins: t.number().default(0),
    vip: t.boolean().default(false),
    pets: t.string().default(''),   // equipped pet ids, comma separated
    // the match
    inMatch: t.boolean().default(false),
    alive: t.boolean().default(false),
    slot: t.int8().default(-1),     // index into SLOTS (where the tower stands)
    height: t.uint16().default(0),  // tower height in blocks (server-owned)
    tower: t.string().default('stone'),
    banim: t.string().default('stack'),
    dance: t.string().default('classic'),
    dancing: t.boolean().default(false),
    celebrate: t.boolean().default(false),
}, 'PlayerState');

export const GameState = schema({
    players: t.map(PlayerState),
    phase: t.string().default('waiting'),   // waiting intermission voting voteResult starting roundIntro question results rising elimination victory
    phaseEnd: t.number().default(0),       // server ms
    need: t.uint8().default(1),
    matchId: t.uint16().default(0),        // 0 = no game running
    mode: t.string().default(''),
    round: t.uint16().default(0),
    alive: t.uint8().default(0),
    started: t.uint8().default(0),
    // lava, in blocks above the pit floor: tweens from lavaFrom to lava starting at lavaAt (server ms)
    lava: t.float32().default(-2),
    lavaFrom: t.float32().default(-2),
    lavaAt: t.number().default(0),
    lavaDur: t.float32().default(0),
    // live vote counts on the four pads
    vEasy: t.uint8().default(0),
    vMedium: t.uint8().default(0),
    vHard: t.uint8().default(0),
    vAlgebra: t.uint8().default(0),
}, 'GameState');
