import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config, { listen } from '@colyseus/tools';
import { defineRoom } from 'colyseus';
import express from 'express';
import { RaceRoom } from './RaceRoom.js';
import { installStatReporter } from './bloxity.js';
import { statsSummary } from './stats.js';
import { CFG } from '../../shared/config.js';

// Serves the built client (client/dist) and the game room on the same port,
// so one Node host is enough to run the whole game.
const CLIENT_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'client', 'dist');

// Play stats are private: /api/stats needs ?key=<stats key>. Only the key's SHA-256 lives in the
// public repo (the key itself is in server/STATS_KEY.local.txt); locally (not on Legion) they're open.
const STATS_KEY_SHA256 = '9ca612ceff125d7706c61501689ee6840ae22e93b0fd7f143188472f05d1920b';
const ON_LEGION = !!process.env.BLOXITY_GAME_ID;
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const keyOk = (key) => !!key && crypto.timingSafeEqual(sha256(key), Buffer.from(STATS_KEY_SHA256, 'hex'));

const app = config({
    rooms: {
        race: defineRoom(RaceRoom),
    },
    initializeExpress: (expressApp) => {
        expressApp.get('/health', (req, res) => res.json({ ok: true }));
        // Play stats (aggregate, no names): /api/stats?key=<stats key>&days=7
        expressApp.get('/api/stats', async (req, res) => {
            const key = typeof req.query.key === 'string' ? req.query.key : '';
            if (ON_LEGION && !keyOk(key)) return res.status(401).json({ error: 'bad key' });
            const days = Math.min(60, Math.max(1, Number(req.query.days) || 7));
            try { res.json(await statsSummary(days)); } catch (e) { res.status(503).json({ error: e.message }); }
        });
        if (fs.existsSync(CLIENT_DIST)) expressApp.use(express.static(CLIENT_DIST));
    },
});

// Local QA only: MTR_FAST=1 shortens every match timer so bot tests finish quickly
if (process.env.MTR_FAST && !ON_LEGION) {
    Object.assign(CFG, process.env.MTR_FAST === '2'
        ? { intermission: 4, voting: 4, voteResult: 1, getReady: 1.5, roundIntro: 1.5, question: 9, results: 3, lavaRise: 2.5, elimination: 1.5, victory: 4 }
        : { intermission: 2, voting: 2, voteResult: 0.5, getReady: 0.5, roundIntro: 0.3, question: 3, results: 0.5, lavaRise: 0.4, elimination: 0.3, victory: 1 });
    console.log('[qa] fast match timers', process.env.MTR_FAST);
}

const reporter = installStatReporter();
process.once('beforeExit', () => { reporter.flush(); });

// 2607 locally so this game can run beside the other Legion games; Legion sets PORT
listen(app, Number(process.env.PORT) || 2607);
