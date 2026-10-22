const events = [];
const target = {};
Object.defineProperty(target, 'fixed', { value: 7, configurable: false, writable: false });
const p = new Proxy(target, {
  get(_target, key) { events.push('get:' + String(key)); return 8; },
  set(_target, key, value) { events.push('set:' + key + ':' + value); return true; },
  deleteProperty(_target, key) { events.push('delete:' + key); return true; },
});
for (const action of [() => p.fixed, () => Reflect.set(p, 'fixed', 7), () => Reflect.set(p, 'fixed', 8), () => Reflect.deleteProperty(p, 'fixed')]) {
  try { events.push('value:' + action()); } catch (error) { events.push('error:' + error.name); }
}
events.push('target:' + target.fixed);
console.log(JSON.stringify(events));
