'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Simulation, Tape, validateMachine, MachineValidationError } = require('../server/engine');
const { templates } = require('../server/templates');

const base = (over = {}) => ({
  name: 'T', inputAlphabet: ['0', '1'], tapeAlphabet: ['0', '1', '_'], blank: '_',
  states: ['q0', 'qa', 'qr'], initialState: 'q0', acceptState: 'qa', rejectState: 'qr', transitions: [], ...over,
});

test('tape: blank default, write/read, negative positions, blank writes are not stored', () => {
  const t = new Tape('_');
  assert.equal(t.read(5), '_');
  assert.equal(t.read(-3), '_');
  t.write(-2, '1'); t.write(3, '0');
  assert.equal(t.read(-2), '1');
  assert.equal(t.contents(), '1____0');
  t.write(-2, '_');
  assert.equal(t.cells.has(-2), false);
  assert.equal(t.contents(), '0');
});

test('left/right movement into negative positions', () => {
  const m = base({ states: ['q0', 'q1', 'qa', 'qr'], transitions: [
    { from: 'q0', read: '1', to: 'q1', write: '0', dir: 'L' },
    { from: 'q1', read: '_', to: 'qa', write: '1', dir: 'R' },
  ] });
  const s = new Simulation(m, '1');
  s.run();
  assert.equal(s.status, 'ACCEPTED');
  assert.equal(s.head, 0);
  assert.deepEqual(s.tape.snapshot(), { '-1': '1', 0: '0' });
  assert.equal(s.trace[0].head, 0);
  assert.equal(s.trace[0].headAfter, -1);
});

test('reading blank uses a transition on blank (not treated as missing)', () => {
  const m = base({ transitions: [{ from: 'q0', read: '_', to: 'qa', write: '_', dir: 'S' }] });
  const s = new Simulation(m, '');
  s.step();
  assert.equal(s.status, 'ACCEPTED');
});

test('explicit reject vs missing transition halt', () => {
  const rej = new Simulation(base({ transitions: [{ from: 'q0', read: '0', to: 'qr', write: '0', dir: 'S' }] }), '0');
  rej.run();
  assert.equal(rej.status, 'REJECTED');
  const halt = new Simulation(base({ transitions: [{ from: 'q0', read: '0', to: 'qr', write: '0', dir: 'S' }] }), '1');
  halt.run();
  assert.equal(halt.status, 'HALTED');
  assert.equal(halt.steps, 0);
});

test('step limit', () => {
  const m = base({ transitions: [{ from: 'q0', read: '_', to: 'q0', write: '1', dir: 'R' }, { from: 'q0', read: '1', to: 'q0', write: '1', dir: 'R' }] });
  const s = new Simulation(m, '', { maxSteps: 25 });
  s.run();
  assert.equal(s.status, 'STEP_LIMIT');
  assert.equal(s.steps, 25);
});

test('loop detection only on genuinely repeated configuration', () => {
  const ping = base({ states: ['q0', 'q1', 'qa', 'qr'], transitions: [
    { from: 'q0', read: '0', to: 'q1', write: '0', dir: 'R' },
    { from: 'q1', read: '_', to: 'q0', write: '_', dir: 'L' },
  ] });
  const s = new Simulation(ping, '0');
  s.run();
  assert.equal(s.status, 'LOOP_DETECTED');
  assert.equal(s.steps, 2);
  // Infinite rightward writer never repeats a configuration -> must hit step limit, not loop.
  const grow = base({ transitions: [{ from: 'q0', read: '_', to: 'q0', write: '1', dir: 'R' }] });
  const g = new Simulation(grow, '', { maxSteps: 100 });
  g.run();
  assert.equal(g.status, 'STEP_LIMIT');
});

test('validation: alphabets, conflicts, unknown states, input symbols', () => {
  assert.ok(validateMachine(base({ tapeAlphabet: ['0', '1'] })).some((e) => /blank/.test(e)));
  assert.ok(validateMachine(base({ inputAlphabet: ['0', '1', '2'] })).some((e) => /"2"/.test(e)));
  const conflict = validateMachine(base({ transitions: [
    { from: 'q0', read: '0', to: 'qa', write: '0', dir: 'R' },
    { from: 'q0', read: '0', to: 'qr', write: '1', dir: 'L' },
  ] }));
  assert.ok(conflict.some((e) => /non-deterministic/.test(e)));
  assert.ok(validateMachine(base({ transitions: [{ from: 'q0', read: '0', to: 'nope', write: '0', dir: 'R' }] })).some((e) => /does not exist/.test(e)));
  assert.ok(validateMachine(base({ transitions: [{ from: 'q0', read: '0', to: 'qa', write: 'Z', dir: 'R' }] })).some((e) => /write symbol/.test(e)));
  assert.ok(validateMachine(base({ transitions: [{ from: 'q0', read: '0', to: 'qa', write: '0', dir: 'X' }] })).some((e) => /direction/.test(e)));
  assert.throws(() => new Simulation(base(), '012'), MachineValidationError);
});

test('reset reproduces identical trace', () => {
  const tp = templates.find((x) => x.key === 'palindrome-checker');
  const s = new Simulation(tp, '0110');
  s.run();
  const first = JSON.stringify(s.trace);
  s.reset();
  assert.equal(s.steps, 0);
  s.run();
  assert.equal(JSON.stringify(s.trace), first);
});

for (const tp of templates) {
  test(`template ${tp.name} is valid and matches all samples`, () => {
    assert.deepEqual(validateMachine(tp), []);
    for (const sample of tp.samples) {
      const s = new Simulation(tp, sample.input);
      s.run();
      assert.equal(s.status, sample.status, `${tp.key}("${sample.input}") status`);
      if (sample.output !== undefined) assert.equal(s.output(), sample.output, `${tp.key}("${sample.input}") output`);
    }
  });
}

test('binary incrementer exhaustively correct for 1..9 bit numbers', () => {
  const tp = templates.find((x) => x.key === 'binary-incrementer');
  for (let n = 0; n < 512; n++) {
    const s = new Simulation(tp, n.toString(2)); s.run();
    assert.equal(parseInt(s.output(), 2), n + 1);
  }
});

test('palindrome checker exhaustively correct up to length 8', () => {
  const tp = templates.find((x) => x.key === 'palindrome-checker');
  for (let len = 0; len <= 8; len++) for (let n = 0; n < 2 ** len; n++) {
    const w = len ? n.toString(2).padStart(len, '0') : '';
    const s = new Simulation(tp, w); s.run();
    assert.equal(s.status, w === [...w].reverse().join('') ? 'ACCEPTED' : 'REJECTED', w);
  }
});

test('binary subtractor correct for all a,b < 32', () => {
  const tp = templates.find((x) => x.key === 'binary-subtractor');
  for (let a = 0; a < 32; a++) for (let b = 0; b < 32; b++) {
    const s = new Simulation(tp, `${a.toString(2)}-${b.toString(2)}`, { maxSteps: 50000 }); s.run();
    if (a >= b) { assert.equal(s.status, 'ACCEPTED'); assert.equal(parseInt(s.output() || '0', 2), a - b, `${a}-${b}`); }
    else assert.equal(s.status, 'REJECTED', `${a}-${b}`);
  }
});

test('string reversal, even ones and unary addition exhaustive checks', () => {
  const rev = templates.find((x) => x.key === 'string-reversal');
  const even = templates.find((x) => x.key === 'even-ones');
  const add = templates.find((x) => x.key === 'unary-addition');
  for (let len = 0; len <= 6; len++) for (let n = 0; n < 2 ** len; n++) {
    const bits = len ? n.toString(2).padStart(len, '0') : '';
    const w = bits.replace(/0/g, 'a').replace(/1/g, 'b');
    const r = new Simulation(rev, w); r.run();
    assert.equal(r.output(), [...w].reverse().join(''));
    const e = new Simulation(even, bits); e.run();
    assert.equal(e.status, (bits.split('1').length - 1) % 2 === 0 ? 'ACCEPTED' : 'REJECTED');
  }
  for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) {
    const s = new Simulation(add, `${'1'.repeat(a)}+${'1'.repeat(b)}`); s.run();
    assert.equal(s.output(), '1'.repeat(a + b));
  }
});
