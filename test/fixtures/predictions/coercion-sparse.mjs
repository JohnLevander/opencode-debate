const sparse = [, undefined, 1];
const seen = [];
const mapped = sparse.map((value, index) => { seen.push(index); return String(value); });
const big = 2n ** 60n;
console.log(JSON.stringify({
  seen, mapped, spread: [...sparse], own0: Object.hasOwn(mapped, 0),
  exactPower: Number(big) === 2 ** 60,
  adjacent: Number(big) === Number(big + 1n),
  mixedEqual: big == Number(big), mixedStrict: big === Number(big),
  nullish: [0 || 9, 0 ?? 9, NaN ?? 9].map(String),
  sort: [3, 20, 100].sort(), shift: (2 ** 32 + 1) >> 0,
}));
