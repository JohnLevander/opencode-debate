const output = {};
for (const mode of ['async-throw', 'async-break', 'sync-throw']) {
  const events = [];
  const value = () => Promise.resolve().then(() => { events.push('value'); return 7; });
  const iterator = mode === 'sync-throw' ? {
    [Symbol.iterator]() { events.push('iterator'); return this; },
    next() { events.push('next'); return { value: value(), done: false }; },
    return() { events.push('return'); throw Error('close'); },
  } : {
    [Symbol.asyncIterator]() { events.push('iterator'); return this; },
    async next() { events.push('next'); return { value: value(), done: false }; },
    async return() { events.push('return'); await null; events.push('return-after'); throw Error('close'); },
  };
  try {
    for await (const x of iterator) {
      events.push('body-promise:' + (x instanceof Promise));
      if (mode === 'async-break') break;
      throw Error('body');
    }
  } catch (error) { events.push('caught:' + error.message); }
  events.push('end'); output[mode] = events;
}
console.log(JSON.stringify(output));
