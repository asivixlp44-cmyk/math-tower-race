// Every math question in the game, shared by the server (which picks them and checks answers)
// and the client (QA tools). Difficulty comes from the vote pads; each difficulty gets harder in
// tiers as the rounds go on.
//
// A question:
// {
//   kind: 'Multiply',
//   text: '2 x 9 = ???',          // big text on the question panel
//   answer: '18',                 // always one of options
//   options: ['24', '18', '16', '8'],
//   prompt: 'Choose an answer!',  // line above the answer buttons
//   hint: 'Hint: ...',            // optional
//   reveal: '2 x 9 = 18',         // title of the results list
//   visual: null | { type: 'rect', w, h } | { type: 'triangle', b, h } | { type: 'angle', deg } | { type: 'polygon', sides },
//   small: true,                  // a long sentence: smaller font
// }
//
// Wrong options deliberately include the classic mistakes (8² -> 16, area -> length + width,
// a x b -> a + b ...) plus close neighbours, like the reference game.

const SQ = '²', CU = '³';

function makeRng(rnd) {
    const r = rnd || Math.random;
    return {
        int: (a, b) => a + Math.floor(r() * (b - a + 1)),
        num: (a, b) => (a ?? 0) + r() * ((b ?? 1) - (a ?? 0)),
        chance: (p) => r() < p,
        pick: (list) => list[Math.floor(r() * list.length)],
        shuffle(list) {
            for (let i = list.length - 1; i > 0; i--) {
                const j = Math.floor(r() * (i + 1));
                [list[i], list[j]] = [list[j], list[i]];
            }
            return list;
        },
    };
}

function gcd(a, b) {
    while (b !== 0) [a, b] = [b, a % b];
    return a;
}

// The answer, then some of the "mistake" candidates, then random neighbours until there are `count`
function numberOptions(R, answer, mistakes, count = 4, allowNegative = false) {
    const seen = new Set([answer]);
    const values = [answer];
    const tryAdd = (v) => {
        if (values.length >= count) return;
        v = Math.round(v);
        if (!Number.isFinite(v) || seen.has(v) || (v < 0 && !allowNegative)) return;
        seen.add(v);
        values.push(v);
    };
    for (const m of R.shuffle([...mistakes])) {
        // keep a couple of mistakes, not all of them, so the options stay varied
        if (values.length < count - 1 || R.chance(0.5)) tryAdd(m);
    }
    const spread = Math.max(3, Math.floor(Math.abs(answer) * 0.2));
    for (let guard = 0; values.length < count && guard < 200; guard++) tryAdd(answer + R.int(1, spread) * (R.chance(0.5) ? -1 : 1));
    for (let n = answer + 1; values.length < count; n++) tryAdd(n);
    return R.shuffle(values).map(String);
}

function textOptions(R, answer, wrong, count = 4) {
    const seen = new Set([answer]);
    const out = [answer];
    for (const w of R.shuffle([...wrong])) {
        if (out.length >= count) break;
        if (!seen.has(w)) { seen.add(w); out.push(w); }
    }
    return R.shuffle(out);
}

function arithmetic(R, text, answer, mistakes, extra, allowNegative) {
    return {
        text: text + ' = ???',
        answer: String(answer),
        options: numberOptions(R, answer, mistakes, 4, allowNegative),
        prompt: 'Choose an answer!',
        reveal: text + ' = ' + answer,
        ...(extra || {}),
    };
}

// ----- generators: (R, tier 1-3) -> question -----
const G = {
    // Easy ------------------------------------------------------------------
    Add(R, tier) {
        const [a, b] = tier === 1 ? [R.int(1, 9), R.int(1, 9)] : tier === 2 ? [R.int(5, 20), R.int(2, 15)] : [R.int(10, 50), R.int(5, 40)];
        const s = a + b;
        return arithmetic(R, `${a} + ${b}`, s, [s + 1, s - 1, s + 10, Math.abs(a - b), s + 2]);
    },
    Subtract(R, tier) {
        let a, b;
        if (tier === 1) { a = R.int(4, 12); b = R.int(1, a - 1); } else if (tier === 2) { a = R.int(12, 30); b = R.int(2, a - 2); } else { a = R.int(30, 99); b = R.int(10, a - 5); }
        const d = a - b;
        return arithmetic(R, `${a} - ${b}`, d, [a + b, d + 1, d - 1, d + 10]);
    },
    MultiplySmall(R, tier) {
        const a = R.int(1, tier === 1 ? 5 : 6), b = R.int(1, 10), p = a * b;
        return arithmetic(R, `${a} x ${b}`, p, [a + b, a * (b + 1), a * Math.max(1, b - 1), p + 1]);
    },
    MissingNumber(R, tier) {
        const a = R.int(1, tier === 1 ? 10 : 25), missing = R.int(1, tier === 1 ? 10 : 25), total = a + missing;
        return {
            text: `${a} + ? = ${total}`, answer: String(missing),
            options: numberOptions(R, missing, [total + a, total, missing + 1, missing - 1]),
            prompt: 'Find the missing number!', hint: `Hint: What do you add to ${a} to make ${total}?`,
            reveal: `${a} + ${missing} = ${total}`,
        };
    },
    DoubleHalf(R, tier) {
        const n = R.int(2, tier === 1 ? 10 : 25);
        if (R.chance(0.5)) return arithmetic(R, `Double ${n}`, n * 2, [n + 2, n * 2 + 2, n * 2 - 1, n]);
        const whole = n * 2;
        return arithmetic(R, `Half of ${whole}`, n, [whole - 2, n + 1, n - 1, whole]);
    },
    ShapeSides(R) {
        const [sides, name] = R.pick([[3, 'triangle'], [4, 'square'], [5, 'pentagon'], [6, 'hexagon'], [8, 'octagon']]);
        return {
            text: `How many sides does ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name} have?`, answer: String(sides),
            options: numberOptions(R, sides, [sides + 1, sides - 1, sides + 2]),
            prompt: 'Count the sides!', hint: 'Hint: Count every straight edge of the shape!',
            reveal: `A ${name} has ${sides} sides`, visual: { type: 'polygon', sides }, small: true,
        };
    },
    Biggest(R, tier) {
        const top = tier === 1 ? 20 : tier === 2 ? 100 : 999;
        const values = [];
        while (values.length < 4) { const v = R.int(1, top); if (!values.includes(v)) values.push(v); }
        const biggest = Math.max(...values);
        return {
            text: 'Which number is the biggest?', answer: String(biggest), options: values.map(String),
            prompt: 'Pick the biggest number!', reveal: `The biggest number is ${biggest}`, small: true,
        };
    },

    // Medium (the reference's mode) ------------------------------------------
    Multiply(R, tier) {
        const top = tier === 1 ? 10 : 12, a = R.int(2, top), b = R.int(2, top), p = a * b;
        return arithmetic(R, `${a} x ${b}`, p, [a + b, p + a, p - b, p + 1, p - 1, (a + 1) * b, p + 10]);
    },
    Divide(R, tier) {
        const top = tier === 1 ? 10 : 12, b = R.int(1, top), q = R.int(1, top), a = b * q;
        return arithmetic(R, `${a} ÷ ${b}`, q, [q + 1, q - 1, q + 2, b, q * 2, a - b]);
    },
    RectArea(R, tier) {
        const top = tier === 1 ? 8 : 12;
        let w = R.int(2, top);
        const h = R.int(2, top);
        if (w === h) w = Math.min(top, w + 1) === h ? w - 1 : Math.min(top, w + 1);
        const area = w * h;
        return {
            kind: 'RectArea', text: 'What is the area of the shape?', answer: String(area),
            options: numberOptions(R, area, [w + h, 2 * (w + h), area + w, area - h, area + 1]),
            prompt: 'Select the area of the shape above!', hint: 'Hint: Area of Rectangle = Length x Width!',
            reveal: `What is the area of the shape?\n${h}x${w} = ${area}`, visual: { type: 'rect', w, h }, small: true,
        };
    },
    SquareArea(R, tier) {
        const s = R.int(2, tier === 1 ? 8 : 12), area = s * s;
        return {
            kind: 'SquareArea', text: 'What is the area of the shape?', answer: String(area),
            options: numberOptions(R, area, [s + s, 4 * s, area + 1, area - 2, area + s]),
            prompt: 'Select the area of the shape above!', hint: 'Hint: Area of Rectangle = Length x Width!',
            reveal: `What is the area of the shape?\n${s}x${s} = ${area}`, visual: { type: 'rect', w: s, h: s }, small: true,
        };
    },
    Perimeter(R, tier) {
        const w = R.int(2, tier === 1 ? 9 : 15), h = R.int(2, tier === 1 ? 9 : 15), p = 2 * (w + h);
        return {
            kind: 'Perimeter', text: 'What is the perimeter of the shape?', answer: String(p),
            options: numberOptions(R, p, [w * h, w + h, p + 2, p - 2]),
            prompt: 'Add up every side!', hint: 'Hint: Perimeter = Length + Width + Length + Width!',
            reveal: `Perimeter: ${w}+${h}+${w}+${h} = ${p}`, visual: { type: 'rect', w, h }, small: true,
        };
    },
    Sequence(R, tier) {
        let step = tier === 1 ? R.pick([1, 2, 5, 10]) : R.int(2, tier === 2 ? 9 : 15);
        const start = R.int(1, tier === 1 ? 10 : 30);
        let terms = [start, start + step, start + step * 2];
        if (tier >= 2 && R.chance(0.3)) {
            // counting down, staying positive
            const top = start + step * 4;
            terms = [top, top - step, top - step * 2];
            step = -step;
        }
        const next = terms[2] + step, text = terms.join(', ');
        return {
            kind: 'Sequence', text: text + ', ?', answer: String(next),
            options: numberOptions(R, next, [0, next + 1, next - 1, terms[2], next + Math.abs(step), terms[2] * 2]),
            prompt: 'Find the next number!', hint: `Hint: The number changes by ${Math.abs(step)} each time!`,
            reveal: text + ', ' + next,
        };
    },
    Square(R, tier) {
        const base = R.int(2, tier === 1 ? 10 : 12), sq = base * base;
        return {
            kind: 'Square', text: `${base}${SQ} = ?`, answer: String(sq),
            options: numberOptions(R, sq, [base * 2, sq - base, sq + base, sq - 4, sq + 3]),
            prompt: 'Solve the exponent', hint: `Hint: ${base}${SQ} = ? is the same as ${base} x ${base}!`,
            reveal: `${base}${SQ} = ${sq}`,
        };
    },
    AngleType(R, tier) {
        let kind = R.pick(['Acute', 'Right', 'Obtuse']);
        let deg = kind === 'Acute' ? R.int(3, 16) * 5 : kind === 'Right' ? 90 : R.int(20, 34) * 5;
        const options = ['Acute', 'Obtuse', 'Right'];
        if (tier >= 3) {
            if (R.chance(0.25)) { kind = 'Straight'; deg = 180; }
            options.push('Straight');
        }
        return {
            kind: 'AngleType', text: 'What type of angle is this?', answer: kind,
            options, // fixed order like the reference: Acute / Obtuse / Right
            prompt: 'Choose an answer!', hint: 'Hint: Acute < 90°, Right = 90°, Obtuse > 90°!',
            reveal: `What type of angle is this?\n${kind} Angle`, visual: { type: 'angle', deg }, small: true,
        };
    },
    TwoDigitAdd(R, tier) {
        const top = tier === 1 ? 49 : 99, a = R.int(11, top), b = R.int(11, top), s = a + b;
        return arithmetic(R, `${a} + ${b}`, s, [s + 10, s - 10, s + 1, s - 1]);
    },
    TwoDigitSubtract(R, tier) {
        const a = R.int(30, tier === 1 ? 70 : 150), b = R.int(11, a - 5), d = a - b;
        return arithmetic(R, `${a} - ${b}`, d, [d + 10, d - 10, d + 1, a + b]);
    },
    Rounding(R, tier) {
        const to = tier >= 3 ? R.pick([10, 100]) : 10;
        let n;
        do { n = R.int(to === 10 ? 11 : 101, to === 10 ? 99 : 999); } while (n % to === 0 || n % to === to / 2);
        const rounded = Math.round(n / to) * to, down = Math.floor(n / to) * to, up = down + to;
        const wrong = rounded === up ? down : up;
        return {
            kind: 'Rounding', text: `Round ${n} to the nearest ${to}`, answer: String(rounded),
            options: textOptions(R, String(rounded), [String(wrong), String(n), String(rounded + to), String(rounded - to), String(down + to * 2)]),
            prompt: 'Choose an answer!', hint: 'Hint: 5 or more rounds up, 4 or less rounds down!',
            reveal: `${n} rounds to ${rounded}`, small: true,
        };
    },

    // Hard ------------------------------------------------------------------
    MultiplyBig(R, tier) {
        const a = R.int(11, tier >= 3 ? 25 : 19), b = tier >= 3 ? R.int(11, 19) : R.int(3, 12), p = a * b;
        return arithmetic(R, `${a} x ${b}`, p, [p + 10, p - 10, p + a, p - b, a * (b - 1)]);
    },
    DivideBig(R, tier) {
        const b = R.int(3, tier >= 3 ? 15 : 12), q = R.int(11, tier >= 3 ? 30 : 20), a = b * q;
        return arithmetic(R, `${a} ÷ ${b}`, q, [q + 1, q - 1, q + 10, q - 10, q * 2]);
    },
    Cube(R, tier) {
        const base = R.int(2, tier >= 3 ? 7 : 5), c = base ** 3;
        return {
            kind: 'Cube', text: `${base}${CU} = ?`, answer: String(c),
            options: numberOptions(R, c, [base * 3, base * base, c + base, c - base]),
            prompt: 'Solve the exponent', hint: `Hint: ${base}${CU} = ${base} x ${base} x ${base}!`,
            reveal: `${base}${CU} = ${c}`,
        };
    },
    SquareRoot(R, tier) {
        const n = R.int(2, tier >= 3 ? 20 : 12), sq = n * n;
        return {
            kind: 'SquareRoot', text: `√${sq} = ?`, answer: String(n),
            options: numberOptions(R, n, [n + 1, n - 1, n * 2, Math.floor(sq / 2)]),
            prompt: 'Find the square root!', hint: `Hint: Which number times itself makes ${sq}?`,
            reveal: `√${sq} = ${n}  (${n} x ${n} = ${sq})`,
        };
    },
    OrderOfOperations(R, tier) {
        const a = R.int(2, 12), b = R.int(2, 9), c = R.int(2, 9);
        if (tier >= 2 && R.chance(0.5)) {
            const ans = (a + b) * c;
            return arithmetic(R, `(${a} + ${b}) x ${c}`, ans, [a + b * c, ans + c, ans - 1], { kind: 'OrderOfOperations', hint: 'Hint: Always solve the brackets first!' });
        }
        const ans = a + b * c;
        return arithmetic(R, `${a} + ${b} x ${c}`, ans, [(a + b) * c, ans + 1, ans - b], { kind: 'OrderOfOperations', hint: 'Hint: Multiply before you add!' });
    },
    Percent(R, tier) {
        const [p, tip] = R.pick([[10, '10% is the same as dividing by 10!'], [20, '20% is the same as ⅕!'], [25, '25% is the same as ¼!'], [50, '50% is the same as half!'], [75, '75% is the same as ¾!']]);
        const unit = 100 / gcd(p, 100), n = unit * R.int(1, tier >= 3 ? 12 : 6), ans = (n * p) / 100;
        return arithmetic(R, `${p}% of ${n}`, ans, [ans + (p / 10) * 2, n - ans, ans * 2, ans + 5], { kind: 'Percent', hint: 'Hint: ' + tip });
    },
    FractionOf(R, tier) {
        let den = R.pick([2, 3, 4, 5, 8, 10]), num = R.int(1, den - 1);
        const g = gcd(num, den);
        num /= g; den /= g;
        const n = den * R.int(2, tier >= 3 ? 12 : 8), ans = (n / den) * num;
        return arithmetic(R, `${num}/${den} of ${n}`, ans, [n / den, ans + num, n - ans, ans * 2], { kind: 'FractionOf', hint: `Hint: Divide by ${den}, then multiply by ${num}!` });
    },
    GeometricSequence(R, tier) {
        const ratio = tier >= 3 ? R.pick([2, 3, 4]) : R.pick([2, 3]);
        const start = R.int(1, ratio === 2 ? 6 : 3);
        const terms = [start, start * ratio, start * ratio * ratio], next = terms[2] * ratio, text = terms.join(', ');
        return {
            kind: 'GeometricSequence', text: text + ', ?', answer: String(next),
            options: numberOptions(R, next, [terms[2] + (terms[2] - terms[1]), next + ratio, next - 1, terms[2] * 2 + 1]),
            prompt: 'Find the next number!', hint: `Hint: Each number is multiplied by ${ratio}!`,
            reveal: text + ', ' + next,
        };
    },
    SpecialSequence(R) {
        if (R.chance(0.5)) {
            const s = R.int(1, 5), terms = [];
            for (let i = s; i <= s + 3; i++) terms.push(i * i);
            const next = (s + 4) ** 2, text = terms.join(', ');
            return {
                kind: 'SquareSequence', text: text + ', ?', answer: String(next),
                options: numberOptions(R, next, [terms[3] + (terms[3] - terms[2]), next + 1, next - 2]),
                prompt: 'Find the next number!', hint: 'Hint: These are square numbers (1x1, 2x2, 3x3...)!',
                reveal: text + ', ' + next,
            };
        }
        const terms = [R.int(1, 3), R.int(2, 4)];
        for (let i = 0; i < 3; i++) terms.push(terms[terms.length - 1] + terms[terms.length - 2]);
        const next = terms[terms.length - 1] + terms[terms.length - 2], text = terms.join(', ');
        return {
            kind: 'FibonacciSequence', text: text + ', ?', answer: String(next),
            options: numberOptions(R, next, [terms[terms.length - 1] * 2, next + 1, next - 1]),
            prompt: 'Find the next number!', hint: 'Hint: Add the two numbers before it!',
            reveal: text + ', ' + next, small: text.length > 16,
        };
    },
    TriangleArea(R, tier) {
        let b, h;
        do { b = R.int(2, tier >= 3 ? 16 : 12); h = R.int(2, tier >= 3 ? 14 : 10); } while ((b * h) % 2 !== 0);
        const area = (b * h) / 2;
        return {
            kind: 'TriangleArea', text: 'What is the area of the triangle?', answer: String(area),
            options: numberOptions(R, area, [b * h, b + h, area + b, area - 1]),
            prompt: 'Select the area of the shape above!', hint: 'Hint: Area of Triangle = ½ x Base x Height!',
            reveal: `Area of the triangle?\n½ x ${b} x ${h} = ${area}`, visual: { type: 'triangle', b, h }, small: true,
        };
    },
    MissingAngle(R) {
        const a = R.int(3, 12) * 5, b = R.int(3, 12) * 5, c = 180 - a - b;
        return {
            kind: 'MissingAngle', text: `A triangle has angles of ${a}° and ${b}°. What is the third angle?`, answer: c + '°',
            options: numberOptions(R, c, [360 - a - b, 90 - Math.min(a, b), c + 10, c - 10]).map((v) => v + '°'),
            prompt: 'Choose an answer!', hint: 'Hint: The angles in a triangle add up to 180°!',
            reveal: `180° - ${a}° - ${b}° = ${c}°`, small: true,
        };
    },
    Negative(R, tier) {
        if (R.chance(0.5)) {
            const a = R.int(2, 15), b = R.int(2, tier >= 3 ? 30 : 20), ans = -a + b;
            return arithmetic(R, `-${a} + ${b}`, ans, [a + b, -(a + b), ans + 1, -ans], { kind: 'Negative', hint: `Hint: Start at -${a} and count up!` }, true);
        }
        const a = R.int(2, 12), b = R.int(a + 1, a + (tier >= 3 ? 25 : 15)), ans = a - b;
        return arithmetic(R, `${a} - ${b}`, ans, [b - a, a + b, ans - 1, ans + 1], { kind: 'Negative', hint: 'Hint: Going below zero makes a negative number!' }, true);
    },

    // Algebra ----------------------------------------------------------------
    AlgebraAdd(R, tier) {
        const x = R.int(1, tier >= 2 ? 30 : 15), a = R.int(1, 20);
        if (R.chance(0.5)) return solveFor(R, `x + ${a} = ${x + a}`, x, [x + a + a, x + 1, a, x - 1], `Hint: Take ${a} away from both sides!`);
        return solveFor(R, `x - ${a} = ${x}`, x + a, [x - a, x, x + a + 1], `Hint: Add ${a} to both sides!`);
    },
    AlgebraMultiply(R, tier) {
        const x = R.int(2, tier >= 2 ? 12 : 9), a = R.int(2, 9);
        if (R.chance(0.6)) return solveFor(R, `${a}x = ${a * x}`, x, [a * x - a, x + 1, a * x, x - 1], `Hint: Divide both sides by ${a}!`);
        return solveFor(R, `x ÷ ${a} = ${x}`, x * a, [x + a, x, x * a + a], `Hint: Multiply both sides by ${a}!`);
    },
    AlgebraTwoStep(R, tier) {
        const x = R.int(1, tier >= 3 ? 15 : 10), a = R.int(2, 6), b = R.int(1, 15);
        return solveFor(R, `${a}x + ${b} = ${a * x + b}`, x, [a * x, Math.floor((a * x + b) / a), x + 1, x + b], `Hint: Subtract ${b}, then divide by ${a}!`);
    },
    AlgebraEvaluate(R, tier) {
        const x = R.int(1, tier >= 2 ? 9 : 6);
        if (tier >= 2 && R.chance(0.4)) {
            const b = R.int(1, 10), ans = x * x + b;
            return {
                kind: 'AlgebraEvaluate', text: `If y = ${x}, what is y${SQ} + ${b}?`, answer: String(ans),
                options: numberOptions(R, ans, [x * 2 + b, x + b, ans + x]),
                prompt: 'Plug in the number!', hint: `Hint: y${SQ} means ${x} x ${x}!`, reveal: `${x}${SQ} + ${b} = ${ans}`, small: true,
            };
        }
        const a = R.int(2, 9), b = R.int(1, 12), ans = a * x + b;
        return {
            kind: 'AlgebraEvaluate', text: `If x = ${x}, what is ${a}x + ${b}?`, answer: String(ans),
            options: numberOptions(R, ans, [a + x + b, Number(`${a}${x}`) + b, ans - b, ans + a]),
            prompt: 'Plug in the number!', hint: `Hint: ${a}x means ${a} x ${x}!`, reveal: `${a} x ${x} + ${b} = ${ans}`, small: true,
        };
    },
    AlgebraLikeTerms(R) {
        const a = R.int(2, 9), b = R.int(2, 9), v = R.pick(['x', 'y', 'a']), answer = `${a + b}${v}`;
        return {
            kind: 'AlgebraLikeTerms', text: `${a}${v} + ${b}${v} = ?`, answer,
            options: textOptions(R, answer, [`${a * b}${v}`, `${a + b}${v}${SQ}`, `${Math.abs(a - b)}${v}`, `${a + b + 1}${v}`]),
            prompt: 'Simplify!', hint: `Hint: Add the numbers in front of ${v}!`, reveal: `${a}${v} + ${b}${v} = ${answer}`,
        };
    },
    AlgebraExpand(R) {
        const a = R.int(2, 6), b = R.int(1, 9), answer = `${a}x + ${a * b}`;
        return {
            kind: 'AlgebraExpand', text: `${a}(x + ${b}) = ?`, answer,
            options: textOptions(R, answer, [`${a}x + ${b}`, `x + ${a * b}`, `${a}x + ${a + b}`, `${a + b}x`]),
            prompt: 'Expand the brackets!', hint: `Hint: Multiply ${a} by everything inside the brackets!`, reveal: `${a}(x + ${b}) = ${answer}`,
        };
    },
    AlgebraSystem(R) {
        let x = R.int(3, 12), y = R.int(1, 8);
        if (y >= x) [x, y] = [y + R.int(1, 4), x];
        return {
            kind: 'AlgebraSystem', text: `x + y = ${x + y}  and  x - y = ${x - y}.  What is x?`, answer: String(x),
            options: numberOptions(R, x, [y, x + y, x - y, x + 1]),
            prompt: 'Solve for x!', hint: 'Hint: Add the two equations together!', reveal: `x = ${x}, y = ${y}`, small: true,
        };
    },
};

function solveFor(R, text, x, mistakes, hint) {
    return {
        kind: 'Algebra', text: text + ',  x = ?', answer: String(x),
        options: numberOptions(R, x, mistakes),
        prompt: 'Solve for x!', hint, reveal: text + '  →  x = ' + x,
    };
}

// ----- weighted pools per difficulty and tier -----
export const POOLS = {
    Easy: [
        { Add: 4, Subtract: 3, MultiplySmall: 1, Sequence: 1, ShapeSides: 1, Biggest: 1, DoubleHalf: 1 },
        { Add: 3, Subtract: 3, MultiplySmall: 3, Sequence: 2, MissingNumber: 2, DoubleHalf: 1, ShapeSides: 1, Biggest: 1 },
        { Add: 2, Subtract: 2, MultiplySmall: 3, Multiply: 1, Sequence: 2, MissingNumber: 2, DoubleHalf: 1, Divide: 1, Biggest: 1 },
    ],
    Medium: [
        { Multiply: 4, Divide: 3, Square: 1, Sequence: 2, RectArea: 1, SquareArea: 1, AngleType: 1 },
        { Multiply: 3, Divide: 3, Square: 2, Sequence: 2, RectArea: 2, SquareArea: 1, AngleType: 2, TwoDigitAdd: 1, Perimeter: 1 },
        { Multiply: 3, Divide: 3, Square: 2, Sequence: 2, RectArea: 2, AngleType: 1, TwoDigitAdd: 1, TwoDigitSubtract: 1, Perimeter: 1, Rounding: 1 },
    ],
    Hard: [
        { MultiplyBig: 3, DivideBig: 2, OrderOfOperations: 2, Square: 1, Cube: 1, SquareRoot: 1, Percent: 1, GeometricSequence: 1 },
        { MultiplyBig: 2, DivideBig: 2, OrderOfOperations: 2, Cube: 1, SquareRoot: 2, Percent: 2, FractionOf: 1, GeometricSequence: 1, TriangleArea: 1, Negative: 1, SpecialSequence: 1 },
        { MultiplyBig: 2, DivideBig: 2, OrderOfOperations: 2, Cube: 2, SquareRoot: 1, Percent: 2, FractionOf: 2, GeometricSequence: 1, SpecialSequence: 1, TriangleArea: 1, MissingAngle: 1, Negative: 1 },
    ],
    Algebra: [
        { AlgebraAdd: 4, AlgebraMultiply: 3, AlgebraEvaluate: 2, AlgebraLikeTerms: 1 },
        { AlgebraAdd: 2, AlgebraMultiply: 3, AlgebraTwoStep: 3, AlgebraEvaluate: 2, AlgebraLikeTerms: 2, AlgebraExpand: 1 },
        { AlgebraMultiply: 2, AlgebraTwoStep: 4, AlgebraEvaluate: 2, AlgebraLikeTerms: 1, AlgebraExpand: 2, AlgebraSystem: 2 },
    ],
};

export const tierFor = (round) => (round <= 3 ? 1 : round <= 7 ? 2 : 3);

function weightedPick(R, pool, avoid) {
    const entries = Object.entries(pool).filter(([k]) => k !== avoid);
    let roll = R.num(0, entries.reduce((a, [, w]) => a + w, 0));
    for (const [k, w] of entries) { roll -= w; if (roll <= 0) return k; }
    return entries[0][0];
}

// A question for this difficulty and round. `history` is an object the caller keeps for one game:
// it stops the same question coming up twice and the same kind twice in a row.
export function generateQuestion(difficulty, round, history, rnd) {
    const R = makeRng(rnd);
    const pool = (POOLS[difficulty] || POOLS.Medium)[tierFor(round) - 1];
    history = history || {};
    history.seen = history.seen || new Set();
    let q, key;
    for (let i = 0; i < 25; i++) {
        const kind = weightedPick(R, pool, history.lastKind);
        q = G[kind](R, tierFor(round));
        q.kind = q.kind || kind;
        q.gen = kind;
        // visual questions share their text, so the answer + shape make them unique
        const v = q.visual;
        key = q.text + '|' + q.answer + (v ? `|${v.w ?? v.b ?? v.sides ?? v.deg}x${v.h ?? 0}` : '');
        if (!history.seen.has(key)) break;
    }
    history.seen.add(key);
    history.lastKind = q.gen;
    q.prompt = q.prompt || 'Choose an answer!';
    q.difficulty = difficulty;
    q.round = round;
    return q;
}

export const GENERATORS = G;
