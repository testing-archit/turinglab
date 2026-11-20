'use strict';
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Simulation, validateMachine, MachineValidationError, DEFAULT_MAX_STEPS } = require('./engine');
const { templates, getTemplate } = require('./templates');
const { Store } = require('./store');

const MACHINE_FIELDS = ['name', 'description', 'inputAlphabet', 'tapeAlphabet', 'blank', 'states',
  'initialState', 'acceptState', 'rejectState', 'transitions', 'layout'];
const MAX_SESSIONS = 500;
const MAX_STORED_TRACE = 2000;
const MAX_RUN_CHUNK = 50000;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

function sanitizeMachine(body) {
  const m = {};
  for (const f of MACHINE_FIELDS) if (body && body[f] !== undefined) m[f] = body[f];
  m.description = String(m.description ?? '').slice(0, 2000);
  m.name = String(m.name ?? '').trim().slice(0, 120);
  if (!m.layout || typeof m.layout !== 'object') m.layout = {};
  return m;
}

function createApp({ store = new Store() } = {}) {
  const app = express();
  const sessions = new Map();
  app.use(express.json({ limit: '1mb' }));

  // CORS for a separately hosted frontend (same-origin by default).
  const origin = process.env.CORS_ORIGIN || '';
  app.use((req, res, next) => {
    if (origin) { res.set('Access-Control-Allow-Origin', origin); res.set('Access-Control-Allow-Headers', 'Content-Type'); res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS'); }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const wrap = (fn) => (req, res, next) => { try { fn(req, res, next); } catch (e) { next(e); } };
  const machineOr404 = (id) => { const m = store.getMachine(id); if (!m) throw new HttpError(404, `Machine ${id} not found`); return m; };
  const toSummary = (m) => ({ id: m.id, name: m.name, description: m.description, states: m.states.length, transitions: m.transitions.length, createdAt: m.createdAt, updatedAt: m.updatedAt });

  app.get('/api/health', (req, res) => res.json({ status: 'UP' }));

  // ---------- Machines ----------
  app.get('/api/machines', wrap((req, res) => res.json(store.listMachines().map(toSummary))));
  app.get('/api/machines/:id', wrap((req, res) => res.json(machineOr404(req.params.id))));
  app.post('/api/machines', wrap((req, res) => {
    const m = sanitizeMachine(req.body);
    const errors = validateMachine(m);
    if (errors.length) throw new MachineValidationError(errors);
    res.status(201).json(store.createMachine(m));
  }));
  app.put('/api/machines/:id', wrap((req, res) => {
    machineOr404(req.params.id);
    const m = sanitizeMachine(req.body);
    const errors = validateMachine(m);
    if (errors.length) throw new MachineValidationError(errors);
    res.json(store.updateMachine(req.params.id, m));
  }));
  app.delete('/api/machines/:id', wrap((req, res) => {
    if (!store.deleteMachine(req.params.id)) throw new HttpError(404, `Machine ${req.params.id} not found`);
    res.sendStatus(204);
  }));
  app.post('/api/machines/validate', wrap((req, res) => {
    const errors = validateMachine(sanitizeMachine(req.body));
    res.json({ valid: errors.length === 0, errors });
  }));
  app.post('/api/machines/:id/validate', wrap((req, res) => {
    const errors = validateMachine(machineOr404(req.params.id));
    res.json({ valid: errors.length === 0, errors });
  }));

  // ---------- Templates ----------
  app.get('/api/templates', (req, res) => res.json(templates));
  app.get('/api/templates/:key', wrap((req, res) => {
    const tp = getTemplate(req.params.key);
    if (!tp) throw new HttpError(404, `Template ${req.params.key} not found`);
    res.json(tp);
  }));

  // ---------- Simulations ----------
  const sessionOr404 = (id) => { const s = sessions.get(id); if (!s) throw new HttpError(404, `Simulation ${id} not found or expired`); s.touched = Date.now(); return s; };

  const view = (s, lastStep) => {
    const sim = s.sim;
    return {
      id: s.id, machineId: s.machineId, templateKey: s.templateKey, machineName: sim.machine.name,
      input: sim.input, status: sim.status, haltReason: sim.haltReason, paused: s.paused,
      steps: sim.steps, maxSteps: sim.maxSteps, state: sim.state, head: sim.head,
      tape: sim.tape.snapshot(), blank: sim.machine.blank, output: sim.output(),
      tapeUtilization: sim.tapeUtilization, executionId: s.executionId || null,
      lastStep: lastStep ?? sim.trace[sim.trace.length - 1] ?? null,
    };
  };

  const recordIfDone = (s) => {
    const sim = s.sim;
    if (!sim.done || s.executionId) return;
    const ex = store.addExecution({
      machineId: s.machineId, templateKey: s.templateKey, machineName: sim.machine.name,
      input: sim.input, status: sim.status, haltReason: sim.haltReason, totalSteps: sim.steps,
      durationMs: Date.now() - s.startedAt, tapeUtilization: sim.tapeUtilization, output: sim.output(),
      blank: sim.machine.blank, initial: sim.initial, trace: sim.trace.slice(0, MAX_STORED_TRACE),
      traceTruncated: sim.trace.length > MAX_STORED_TRACE, createdAt: new Date().toISOString(),
    });
    s.executionId = ex.id;
  };

  const evictSessions = () => {
    if (sessions.size < MAX_SESSIONS) return;
    const oldest = [...sessions.values()].sort((a, b) => a.touched - b.touched)[0];
    sessions.delete(oldest.id);
  };

  app.post('/api/simulations', wrap((req, res) => {
    const { machineId, templateKey, machine: inline, input = '', maxSteps = DEFAULT_MAX_STEPS } = req.body || {};
    let machine;
    if (machineId) machine = machineOr404(machineId);
    else if (templateKey) { machine = getTemplate(templateKey); if (!machine) throw new HttpError(404, `Template ${templateKey} not found`); }
    else if (inline) machine = sanitizeMachine(inline);
    else throw new HttpError(400, 'Provide machineId, templateKey or machine');
    const sim = new Simulation(machine, input, { maxSteps });
    evictSessions();
    const s = { id: crypto.randomUUID(), sim, machineId: machineId || null, templateKey: templateKey || null, paused: false, startedAt: Date.now(), touched: Date.now() };
    sessions.set(s.id, s);
    recordIfDone(s);
    res.status(201).json(view(s));
  }));
  app.get('/api/simulations/:id', wrap((req, res) => res.json(view(sessionOr404(req.params.id)))));
  app.post('/api/simulations/:id/step', wrap((req, res) => {
    const s = sessionOr404(req.params.id);
    const entry = s.sim.step();
    recordIfDone(s);
    res.json(view(s, entry));
  }));
  app.post('/api/simulations/:id/run', wrap((req, res) => {
    const s = sessionOr404(req.params.id);
    const requested = req.body && req.body.steps !== undefined ? Number(req.body.steps) : MAX_RUN_CHUNK;
    if (!Number.isInteger(requested) || requested < 1) throw new HttpError(400, 'steps must be a positive integer');
    s.paused = false;
    s.sim.run(Math.min(requested, MAX_RUN_CHUNK));
    recordIfDone(s);
    res.json(view(s));
  }));
  app.post('/api/simulations/:id/pause', wrap((req, res) => { const s = sessionOr404(req.params.id); s.paused = true; res.json(view(s)); }));
  app.post('/api/simulations/:id/reset', wrap((req, res) => {
    const s = sessionOr404(req.params.id);
    s.sim.reset(); s.paused = false; s.executionId = null; s.startedAt = Date.now();
    recordIfDone(s);
    res.json(view(s));
  }));
  app.get('/api/simulations/:id/history', wrap((req, res) => {
    const s = sessionOr404(req.params.id);
    res.json({ initial: s.sim.initial, trace: s.sim.trace, blank: s.sim.machine.blank });
  }));

  // ---------- Executions ----------
  app.get('/api/executions', wrap((req, res) => {
    const { machine, status } = req.query;
    const list = store.listExecutions()
      .filter((e) => !machine || e.machineName === machine)
      .filter((e) => !status || e.status === status)
      .map(({ trace, initial, ...rest }) => rest);
    res.json(list);
  }));
  app.get('/api/executions/:id', wrap((req, res) => {
    const e = store.getExecution(req.params.id);
    if (!e) throw new HttpError(404, `Execution ${req.params.id} not found`);
    res.json(e);
  }));

  // ---------- Analytics (computed from persisted executions only) ----------
  app.get('/api/analytics', wrap((req, res) => {
    const ex = store.listExecutions();
    const count = (st) => ex.filter((e) => e.status === st).length;
    const byMachine = {};
    const byDay = {};
    for (const e of ex) {
      const m = (byMachine[e.machineName] ||= { machine: e.machineName, executions: 0, accepted: 0, rejected: 0, totalSteps: 0, maxSteps: 0 });
      m.executions += 1; m.totalSteps += e.totalSteps; m.maxSteps = Math.max(m.maxSteps, e.totalSteps);
      if (e.status === 'ACCEPTED') m.accepted += 1;
      if (e.status === 'REJECTED') m.rejected += 1;
      const day = e.createdAt.slice(0, 10);
      const d = (byDay[day] ||= { date: day, executions: 0, accepted: 0, rejected: 0, other: 0 });
      d.executions += 1;
      if (e.status === 'ACCEPTED') d.accepted += 1; else if (e.status === 'REJECTED') d.rejected += 1; else d.other += 1;
    }
    const n = ex.length;
    res.json({
      totalMachines: store.listMachines().length,
      totalExecutions: n,
      accepted: count('ACCEPTED'), rejected: count('REJECTED'), halted: count('HALTED'),
      loopDetected: count('LOOP_DETECTED'), stepLimit: count('STEP_LIMIT'),
      averageSteps: n ? ex.reduce((a, e) => a + e.totalSteps, 0) / n : 0,
      maxSteps: n ? Math.max(...ex.map((e) => e.totalSteps)) : 0,
      averageTapeUtilization: n ? ex.reduce((a, e) => a + e.tapeUtilization, 0) / n : 0,
      maxTapeUtilization: n ? Math.max(...ex.map((e) => e.tapeUtilization)) : 0,
      perMachine: Object.values(byMachine).map((m) => ({ ...m, averageSteps: m.totalSteps / m.executions })),
      trend: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
    });
  }));

  app.use('/api', (req, res) => res.status(404).json({ status: 404, error: 'Not Found', message: `No route ${req.method} ${req.originalUrl}` }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Centralized error handling
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ status: 400, error: 'Bad Request', message: 'Malformed JSON body' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ status, error: status === 400 ? 'Validation Failed' : status === 404 ? 'Not Found' : 'Error', message: err.message, errors: err.errors || [] });
  });
  return app;
}

module.exports = { createApp };
