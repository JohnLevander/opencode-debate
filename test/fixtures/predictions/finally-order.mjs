const events = [];
const p = Promise.reject('original');
let settled = false;
const q = p.finally(() => { events.push('cleanup'); return { then(resolve) { events.push('thenable'); resolve(); } }; });
q.catch(error => { settled = true; events.push('q:' + error); });
p.catch(() => events.push('p-catch:q-settled=' + settled));
queueMicrotask(() => events.push('microtask:q-settled=' + settled));
await new Promise(resolve => setImmediate(resolve));
console.log(JSON.stringify(events));
