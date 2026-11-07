// Exact rational arithmetic. A value is a frozen {n, d} with d > 0 and
// gcd(|n|, d) = 1, so structural equality is numeric equality.

const gcd = (a, b) => {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
};

export function rat(n, d = 1) {
  if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d)) {
    throw new RangeError(`rat: not a safe integer pair ${n}/${d}`);
  }
  if (d === 0) throw new RangeError('rat: zero denominator');
  if (d < 0) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d) || 1;
  return Object.freeze({ n: n / g, d: d / g });
}

export const ZERO = rat(0);

export const add = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a, b) => rat(a.n * b.n, a.d * b.d);
export const div = (a, b) => {
  if (b.n === 0) throw new RangeError('rat: division by zero');
  return rat(a.n * b.d, a.d * b.n);
};

export const eq = (a, b) => a.n === b.n && a.d === b.d;
export const isInt = (a) => a.d === 1;
export const isNeg = (a) => a.n < 0;

// Accepts integers, "7", "-3", "3/4", "-1/2", and the Unicode minus "−".
export function parse(x) {
  if (typeof x === 'number') {
    if (!Number.isInteger(x)) throw new TypeError(`rat: ${x} is not an integer; write fractions as "a/b"`);
    return rat(x);
  }
  if (typeof x !== 'string') throw new TypeError(`rat: cannot parse ${JSON.stringify(x)}`);
  const m = x.trim().replace(/−/g, '-').match(/^(-?\d+)(?:\s*\/\s*(\d+))?$/);
  if (!m) throw new TypeError(`rat: cannot parse "${x}"`);
  return rat(Number(m[1]), m[2] === undefined ? 1 : Number(m[2]));
}

// ASCII form, round-trips through parse(). Display code may prettify the minus.
export const format = (a) => (a.d === 1 ? `${a.n}` : `${a.n}/${a.d}`);
