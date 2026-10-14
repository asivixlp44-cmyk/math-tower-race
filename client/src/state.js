// Local mirror of this player's progress. The server owns the real values:
// public stats arrive through the room state, private ones in "profile" messages.
export const S = {
    gems: 0, totalGems: 0, wins: 0, answers: 0, games: 0, bestRound: 0, playtime: 0, retries: 0,
    towers: { stone: true }, tower: 'stone', anims: { stack: true }, anim: 'stack', dances: { classic: true }, dance: 'classic',
    pets: [], equippedPets: [], passes: {}, chestAt: 0, codes: {}, autoJoin: true, hints: true, pendingBlocks: 0,
    firstPlay: Date.now(), name: '', profileAt: Date.now(),
    // questions answered this session, newest first (the Review panel)
    review: [],
};

// Game actions that world objects (pads, shop stands, eggs, the chest) trigger; filled in by main.js / ui.js
export const actions = {};

export const net = {
    room: null,
    offset: 0,
    send(type, msg) { if (this.room) this.room.send(type, msg || {}); },
    // Server clock in ms, so countdowns and the lava line up for everyone
    now() { return Date.now() + this.offset; },
    state() { return this.room && this.room.state; },
    me() { const r = this.room; return r && r.state && r.state.players ? r.state.players.get(r.sessionId) : null; },
};
