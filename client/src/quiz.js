// The question on screen: the panel at the top (timer, question, shape/angle drawing), the answer
// buttons at the bottom (keys 1-4), "Choose an answer!" / "Correct! +9 Blocks" / "Incorrect!", the
// hint, the "Use Second Chance" popup and the results list after every question.
import { $ } from './engine.js';
import { S, net, actions } from './state.js';
import { sfx } from './audio.js';
import { drawVisual } from './world.js';
import { CFG, KITS, clock } from '../../shared/config.js';

let cur = null;          // the question on screen
let lastTick = -1;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const setText = (n, t) => { if (n.textContent !== t) n.textContent = t; };
function pop(el, cls) { el.classList.remove(cls || 'pop'); void el.offsetWidth; el.classList.add(cls || 'pop'); }

function prompt(text, kind) {
    const p = $('#qPrompt');
    p.textContent = text;
    p.className = 'o' + (kind ? ' ' + kind : '');
    p.hidden = false;
    pop(p);
}
function hideAll() {
    for (const id of ['#qPanel', '#qAnswers', '#qPrompt', '#qHint', '#chance']) $(id).hidden = true;
}
function showHint() {
    if (!cur || cur.hintShown || !cur.hint || !cur.mine || S.hints === false) return;
    cur.hintShown = true;
    $('#qHintText').textContent = cur.hint;
    $('#qHint').hidden = false;
}
function showChance(left) {
    setText($('#chanceText'), `You have ${left} answer retr${left === 1 ? 'y' : 'ies'}!`);
    setText($('#chanceGo'), left > 0 ? 'Use' : 'Get More');
    $('#chanceGo').className = 'btn ' + (left > 0 ? 'g-green' : 'g-gold') + ' o1';
    $('#chance').hidden = false;
}
$('#chanceClose').addEventListener('click', () => { $('#chance').hidden = true; });
$('#chanceGo').addEventListener('click', () => {
    if (!cur) return;
    if (cur.retries > 0 || cur.unlimited) net.send('retry');
    else actions.buy('product', 'Retries');
});

// A new question. mine: this player is alive in the game and answers it; watching: spectating
export function onQuestion(m, mine, watching) {
    $('#results').hidden = true;
    cur = {
        id: m.id, text: m.text, options: m.options, hint: m.hint, hintDelay: m.hintDelay || CFG.hintDelay, visual: m.visual,
        endsAt: m.endsAt, startedAt: m.endsAt - (m.dur || CFG.question) * 1000, mine, answered: false, locked: false,
        pending: -1, hintShown: false, myAnswer: null, myCorrect: false, myTime: 0, retries: CFG.freeRetries + (S.retries || 0), unlimited: !!S.passes.UnlimitedAnswers,
        wrong: new Set(),
    };
    if (!mine && !watching) { hideAll(); return; }
    const q = $('#qText');
    q.textContent = m.text;
    q.className = 'o' + (m.small || m.text.length > 22 ? ' small' : '') + (m.visual ? ' left' : '');
    const cv = $('#qVisual');
    cv.hidden = !m.visual;
    if (m.visual) {
        const x = cv.getContext('2d');
        x.clearRect(0, 0, cv.width, cv.height);
        drawVisual(x, m.visual, 0, 0, cv.width, cv.height);
    }
    const panel = $('#qPanel');
    panel.hidden = false; pop(panel);
    $('#qHint').hidden = true;
    $('#chance').hidden = true;
    const bar = $('#qAnswers');
    bar.innerHTML = '';
    if (mine) {
        const words = m.options.some((o) => !/^-?\d+°?$/.test(o));
        m.options.forEach((o, i) => {
            const b = document.createElement('button');
            b.className = 'ans o' + (words ? ' word' : '');
            b.innerHTML = `<span class="n o1">${i + 1}</span>${esc(o)}`;
            b.addEventListener('click', () => submit(i));
            bar.appendChild(b);
        });
        bar.hidden = false;
        prompt(m.prompt || 'Choose an answer!');
        sfx('question');
    } else {
        bar.hidden = true;
        $('#qPrompt').hidden = true;
    }
}
function buttons() { return [...$('#qAnswers').children]; }
function submit(i) {
    if (!cur || !cur.mine || cur.answered || cur.locked || cur.pending >= 0 || cur.wrong.has(i)) return;
    const b = buttons()[i];
    if (!b) return;
    cur.pending = i;
    b.classList.add('pending');
    net.send('answer', { id: cur.id, i });
    const id = cur.id;
    setTimeout(() => { if (cur && cur.id === id && cur.pending === i && !cur.answered) { cur.pending = -1; b.classList.remove('pending'); } }, 2000);
}
export function answerKey(i) { if ($('#qAnswers').hidden) return false; submit(i); return true; }
export const answering = () => !!cur && cur.mine && !cur.answered && !$('#qAnswers').hidden;

export function onAnswerResult(r) {
    if (!cur || r.id !== cur.id) return;
    if (r.retries !== undefined) cur.retries = r.retries;
    if (r.unlocked) {
        cur.locked = false;
        $('#chance').hidden = true;
        prompt('Choose an answer!');
        sfx('select');
        return;
    }
    const bs = buttons(), b = bs[r.i];
    cur.pending = -1;
    if (b) b.classList.remove('pending');
    cur.myAnswer = cur.options[r.i];
    if (r.correct) {
        cur.answered = true; cur.myCorrect = true; cur.myTime = r.time;
        bs.forEach((x, k) => { x.disabled = true; if (k === r.i) x.classList.add('correct'); else if (!x.classList.contains('wrong')) x.classList.add('dim'); });
        prompt(`Correct! +${r.blocks} Blocks`, 'good');
        $('#chance').hidden = true;
        sfx('correct');
    } else {
        cur.wrong.add(r.i);
        if (b) { b.classList.add('wrong'); b.disabled = true; }
        prompt('Incorrect!', 'bad');
        sfx('wrong');
        showHint();
        cur.locked = !!r.locked;
        cur.unlimited = !!r.unlimited;
        if (r.locked) showChance(r.retries || 0);
    }
}
// No retries left and "Use" was pressed: offer to buy more
export function onNoRetries() { if (cur) showChance(0); }

// After the question: show the right answer, then the list of everyone's answers
export function onResults(m, kitOf, myId, watching) {
    const mine = cur && cur.mine && cur.id === m.id;
    if (mine) {
        buttons().forEach((x) => { x.disabled = true; if (x.textContent.slice(1) === m.answer && !x.classList.contains('correct')) x.classList.add('reveal'); });
        S.review.unshift({ text: m.text, reveal: m.reveal, answer: m.answer, mine: cur.myAnswer, correct: cur.myCorrect, time: cur.myTime, round: net.state() && net.state().round, mode: net.state() && net.state().mode });
        if (S.review.length > 60) S.review.length = 60;
    }
    setTimeout(() => {
        hideAll();
        if (!mine && !watching) return;
        $('#resTitle').textContent = m.reveal;
        const list = $('#resList');
        list.innerHTML = '';
        m.entries.slice(0, 8).forEach((e, i) => {
            const d = document.createElement('div');
            d.className = 'res' + (e.s === myId ? ' me' : '');
            d.style.animationDelay = (i * 0.05) + 's';
            const kit = KITS[(kitOf(e.s) || 0) % KITS.length];
            const col = '#' + kit.shirt.toString(16).padStart(6, '0');
            d.innerHTML = `<span class="av o1" style="background:${col}">${esc((e.n || '?').slice(0, 1).toUpperCase())}</span>`
                + `<span class="a o1 ${e.c ? 'ok' : e.na ? 'na' : 'no'}">${esc(e.t)}</span>`
                + (e.c ? `<span class="tm o1">${e.tm.toFixed(1)}s</span>` : '<span class="tm x o1">X</span>');
            list.appendChild(d);
        });
        $('#results').hidden = false;
    }, mine ? 600 : 0);
}

// Every frame: the timer, the hint, and tidying up when the phase moves on
export function updateQuiz(now, phase, alive) {
    // (the question message can arrive a moment before the phase in the room state changes)
    const fresh = cur && now < cur.startedAt + 1500;
    if (phase !== 'results' && phase !== 'question' && !fresh && !$('#results').hidden) $('#results').hidden = true;
    if (!cur || $('#qPanel').hidden) return;
    if (phase !== 'question' && !fresh) { if (phase !== 'results') hideAll(); return; }
    const left = Math.max(0, (cur.endsAt - now) / 1000);
    const t = $('#qTimer');
    setText(t, clock(left));
    const urgent = left <= 5;
    t.classList.toggle('urgent', urgent);
    const whole = Math.ceil(left);
    if (urgent && whole !== lastTick && whole > 0) {
        lastTick = whole;
        if (cur.mine && !cur.answered) sfx('tickUrgent');
    }
    if (cur.mine && !cur.answered && now - cur.startedAt >= cur.hintDelay * 1000) showHint();
    // eliminated mid-question (a nuke): the buttons go away
    if (cur.mine && !alive) { cur.mine = false; $('#qAnswers').hidden = true; $('#qPrompt').hidden = true; $('#chance').hidden = true; $('#qHint').hidden = true; }
}
export const quizVisible = () => !$('#qPanel').hidden || !$('#results').hidden;
