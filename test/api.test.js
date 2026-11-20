'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/app');
const { Store } = require('../server/store');

let server; let base;
test.before(async () => {
  server = createApp({ store: new Store(':memory:') }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://localhost:${server.address().port}/api`;
});
test.after(() => server.close());

const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: r.status === 204 ? null : await r.json() };
};

const machine = {
  name: 'Flip', inputAlphabet: ['0', '1'], tapeAlphabet: ['0', '1', '_'], blank: '_',
  states: ['q0', 'qa', 'qr'], initialState: 'q0', acceptState: 'qa', rejectState: 'qr',
  transitions: [
    { from: 'q0', read: '0', to: 'q0', write: '1', dir: 'R' },
    { from: 'q0', read: '1', to: 'q0', write: '0', dir: 'R' },
    { from: 'q0', read: '_', to: 'qa', write: '_', dir: 'S' },
  ],
};

test('machine CRUD + validation errors', async () => {
  const bad = await call('POST', '/machines', { ...machine, initialState: 'zz' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.errors.length > 0);
  const created = await call('POST', '/machines', machine);
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await call('GET', `/machines/${id}`)).body.name, 'Flip');
  assert.equal((await call('PUT', `/machines/${id}`, { ...machine, name: 'Flipper' })).body.name, 'Flipper');
  assert.equal((await call('POST', `/machines/${id}/validate`)).body.valid, true);
  assert.equal((await call('GET', '/machines')).body.length, 1);
  assert.equal((await call('DELETE', `/machines/${id}`)).status, 204);
  assert.equal((await call('GET', `/machines/${id}`)).status, 404);
});

test('simulation step/run/reset/history and execution persisted', async () => {
  const sim = (await call('POST', '/simulations', { templateKey: 'binary-incrementer', input: '101' })).body;
  assert.equal(sim.status, 'RUNNING');
  const s1 = (await call('POST', `/simulations/${sim.id}/step`)).body;
  assert.equal(s1.steps, 1);
  assert.equal(s1.lastStep.read, '1');
  const done = (await call('POST', `/simulations/${sim.id}/run`)).body;
  assert.equal(done.status, 'ACCEPTED');
  assert.equal(done.output, '110');
  const hist = (await call('GET', `/simulations/${sim.id}/history`)).body;
  assert.equal(hist.trace.length, done.steps);
  const ex = (await call('GET', '/executions?status=ACCEPTED')).body;
  assert.ok(ex.some((e) => e.id === done.executionId));
  const full = (await call('GET', `/executions/${done.executionId}`)).body;
  assert.equal(full.trace.length, done.steps);
  const reset = (await call('POST', `/simulations/${sim.id}/reset`)).body;
  assert.equal(reset.steps, 0);
  const an = (await call('GET', '/analytics')).body;
  assert.ok(an.totalExecutions >= 1);
  assert.ok(an.accepted >= 1);
});

test('invalid input symbol -> 400, unknown sim -> 404', async () => {
  assert.equal((await call('POST', '/simulations', { templateKey: 'binary-incrementer', input: '12' })).status, 400);
  assert.equal((await call('POST', '/simulations/nope/step')).status, 404);
  assert.equal((await call('GET', '/templates')).body.length, 6);
});
