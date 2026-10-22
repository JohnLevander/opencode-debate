const map = new Map([['a', 1], ['b', 2]]);
const iterator = map.keys();
const events = [iterator.next().value];
map.delete('b'); map.set('c', 3); map.delete('a'); map.set('a', 4);
events.push(iterator.next().value, iterator.next().value, iterator.next().done);
map.set('d', 5); events.push(iterator.next().done);
const seen = [];
map.forEach((value, key) => {
  seen.push([key, value]);
  if (key === 'c') { map.delete('a'); map.set('e', 6); }
});
console.log(JSON.stringify({ events, seen, keys: [...map.keys()], setSize: new Set([NaN, NaN, -0, +0]).size }));
