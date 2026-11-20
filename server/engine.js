'use strict';
/**
 * Pure deterministic single-tape Turing Machine engine.
 * M = (Q, Σ, Γ, δ, q0, qAccept, qReject),  δ(q, a) = (p, b, D), D ∈ {L, R, S}
 * No HTTP / persistence concerns live here.
 */

const DIRECTIONS = ['L', 'R', 'S'];
const MAX_INPUT_LENGTH = 1000;
const DEFAULT_MAX_STEPS = 10000;
const HARD_MAX_STEPS = 50000;

class MachineValidationError extends Error {
  constructor(errors) {
    super(errors.join('; '));
    this.errors = errors;
    this.status = 400;
  }
}

const deltaKey = (state, symbol) => `${state}\u0000${symbol}`;
const isSymbol = (s) => typeof s === 'string' && [...s].length === 1;

function validateMachine(m) {
  const errors = [];
  if (!m || typeof m !== 'object') return ['Machine definition must be an object'];
  if (!m.name || !String(m.name).trim()) errors.push('Machine name is required');

  const sigma = Array.isArray(m.inputAlphabet) ? m.inputAlphabet : null;
  const gamma = Array.isArray(m.tapeAlphabet) ? m.tapeAlphabet : null;
  const states = Array.isArray(m.states) ? m.states : null;
  const transitions = Array.isArray(m.transitions) ? m.transitions : null;
  if (!sigma) errors.push('Input alphabet Σ must be a list of symbols');
  if (!gamma) errors.push('Tape alphabet Γ must be a list of symbols');
  if (!states) errors.push('States Q must be a list');
  if (!transitions) errors.push('Transitions δ must be a list');
  if (errors.length && (!sigma || !gamma || !states || !transitions)) return errors;

  const { blank } = m;
  if (!isSymbol(blank)) errors.push('Blank symbol must be exactly one character');
  for (const s of sigma) if (!isSymbol(s)) errors.push(`Input symbol "${s}" must be exactly one character`);
  for (const s of gamma) if (!isSymbol(s)) errors.push(`Tape symbol "${s}" must be exactly one character`);
  if (new Set(sigma).size !== sigma.length) errors.push('Input alphabet contains duplicate symbols');
  if (new Set(gamma).size !== gamma.length) errors.push('Tape alphabet contains duplicate symbols');
  if (isSymbol(blank) && !gamma.includes(blank)) errors.push(`Tape alphabet Γ must contain the blank symbol "${blank}"`);
  if (sigma.includes(blank)) errors.push('Input alphabet Σ must not contain the blank symbol');
  for (const s of sigma) if (!gamma.includes(s)) errors.push(`Input symbol "${s}" is not in the tape alphabet Γ (Σ ⊆ Γ required)`);

  if (states.length === 0) errors.push('At least one state is required');
  for (const s of states) if (typeof s !== 'string' || !s.trim()) errors.push('State names must be non-empty strings');
  if (new Set(states).size !== states.length) errors.push('State names must be unique');
  const Q = new Set(states);
  if (!Q.has(m.initialState)) errors.push(`Initial state "${m.initialState ?? ''}" is not in Q`);
  if (!Q.has(m.acceptState)) errors.push(`Accept state "${m.acceptState ?? ''}" is not in Q`);
  if (!Q.has(m.rejectState)) errors.push(`Reject state "${m.rejectState ?? ''}" is not in Q`);
  if (m.acceptState && m.acceptState === m.rejectState) errors.push('Accept and reject states must be different');

  const seen = new Map();
  transitions.forEach((t, i) => {
    const label = `Transition #${i + 1}`;
    if (!t || typeof t !== 'object') { errors.push(`${label} is malformed`); return; }
    if (!Q.has(t.from)) errors.push(`${label}: source state "${t.from}" does not exist`);
    if (!Q.has(t.to)) errors.push(`${label}: target state "${t.to}" does not exist`);
    if (!gamma.includes(t.read)) errors.push(`${label}: read symbol "${t.read}" is not in Γ`);
    if (!gamma.includes(t.write)) errors.push(`${label}: write symbol "${t.write}" is not in Γ`);
    if (!DIRECTIONS.includes(t.dir)) errors.push(`${label}: direction must be L, R or S`);
    if (t.from === m.acceptState || t.from === m.rejectState) errors.push(`${label}: halting state "${t.from}" cannot have outgoing transitions`);
    const k = deltaKey(t.from, t.read);
    if (seen.has(k)) errors.push(`${label}: conflicts with transition #${seen.get(k) + 1} — δ(${t.from}, ${t.read}) defined twice (non-deterministic)`);
    else seen.set(k, i);
  });
  return errors;
}

class Tape {
  constructor(blank) {
    this.blank = blank;
    this.cells = new Map(); // sparse: only non-blank cells are stored
    this.min = 0;
    this.max = 0;
  }
  read(pos) { return this.cells.has(pos) ? this.cells.get(pos) : this.blank; }
  write(pos, symbol) {
    if (symbol === this.blank) this.cells.delete(pos); else this.cells.set(pos, symbol);
    this.touch(pos);
  }
  touch(pos) { if (pos < this.min) this.min = pos; if (pos > this.max) this.max = pos; }
  entries() { return [...this.cells.entries()].sort((a, b) => a[0] - b[0]); }
  snapshot() { return Object.fromEntries(this.entries()); }
  signature() { return this.entries().map(([p, c]) => `${p}:${c}`).join(','); }
  /** Non-blank region of the tape as a string (inner blanks kept). */
  contents() {
    const e = this.entries();
    if (!e.length) return '';
    let out = '';
    for (let p = e[0][0]; p <= e[e.length - 1][0]; p++) out += this.read(p);
    return out;
  }
}

class Simulation {
  constructor(machine, input = '', { maxSteps = DEFAULT_MAX_STEPS } = {}) {
    const errors = validateMachine(machine);
    if (errors.length) throw new MachineValidationError(errors);
    if (typeof input !== 'string') throw new MachineValidationError(['Input must be a string']);
    if (input.length > MAX_INPUT_LENGTH) throw new MachineValidationError([`Input exceeds ${MAX_INPUT_LENGTH} symbols`]);
    for (const ch of input) {
      if (!machine.inputAlphabet.includes(ch)) throw new MachineValidationError([`Input symbol "${ch}" is not in the input alphabet Σ = {${machine.inputAlphabet.join(', ')}}`]);
    }
    const n = Number(maxSteps);
    if (!Number.isInteger(n) || n < 1 || n > HARD_MAX_STEPS) throw new MachineValidationError([`Max steps must be an integer between 1 and ${HARD_MAX_STEPS}`]);
    this.machine = machine;
    this.input = input;
    this.maxSteps = n;
    this.delta = new Map(machine.transitions.map((t) => [deltaKey(t.from, t.read), t]));
    this.reset();
  }

  reset() {
    const m = this.machine;
    this.tape = new Tape(m.blank);
    [...this.input].forEach((c, i) => this.tape.write(i, c));
    this.tape.min = 0;
    this.tape.max = Math.max(0, this.input.length - 1);
    this.head = 0;
    this.state = m.initialState;
    this.steps = 0;
    this.status = 'RUNNING';
    this.haltReason = null;
    this.trace = [];
    this.seen = new Set([this.signature()]);
    this.initial = this.configuration();
    this.checkHaltingState();
  }

  signature() { return `${this.state}|${this.head}|${this.tape.signature()}`; }
  configuration() { return { state: this.state, head: this.head, tape: this.tape.snapshot() }; }
  get done() { return this.status !== 'RUNNING'; }
  get tapeUtilization() { return this.tape.max - this.tape.min + 1; }
  output() { return this.tape.contents(); }

  checkHaltingState() {
    if (this.state === this.machine.acceptState) {
      this.status = 'ACCEPTED';
      this.haltReason = `Reached accept state ${this.state}`;
      return true;
    }
    if (this.state === this.machine.rejectState) {
      this.status = 'REJECTED';
      this.haltReason = `Reached reject state ${this.state}`;
      return true;
    }
    return false;
  }

  /** Executes exactly one transition. Returns the trace entry, or null if no step was taken. */
  step() {
    if (this.done) return null;
    const read = this.tape.read(this.head);
    const t = this.delta.get(deltaKey(this.state, read));
    if (!t) {
      // A missing transition is a halt, distinct from entering the explicit reject state.
      this.status = 'HALTED';
      this.haltReason = `No transition defined for δ(${this.state}, ${read}); machine halted outside accept/reject states`;
      return null;
    }
    const from = this.state;
    const headBefore = this.head;
    this.tape.write(this.head, t.write); // 1. write
    this.head += t.dir === 'L' ? -1 : t.dir === 'R' ? 1 : 0; // 2. move
    this.tape.touch(this.head);
    this.state = t.to; // 3. change state
    this.steps += 1;
    const entry = {
      step: this.steps, state: from, head: headBefore, read, write: t.write,
      direction: t.dir, nextState: t.to, headAfter: this.head, tape: this.tape.snapshot(),
    };
    this.trace.push(entry);

    if (!this.checkHaltingState()) {
      const sig = this.signature();
      if (this.seen.has(sig)) {
        this.status = 'LOOP_DETECTED';
        this.haltReason = `Configuration (state ${this.state}, head ${this.head}, identical tape) repeated — machine will never halt`;
      } else {
        this.seen.add(sig);
        if (this.steps >= this.maxSteps) {
          this.status = 'STEP_LIMIT';
          this.haltReason = `Step limit of ${this.maxSteps} reached`;
        }
      }
    }
    return entry;
  }

  /** Runs up to `limit` steps (default: until halt or maxSteps). Returns steps executed. */
  run(limit = Infinity) {
    let n = 0;
    while (!this.done && n < limit) {
      this.step();
      n += 1;
    }
    return n;
  }
}

module.exports = {
  Simulation, Tape, validateMachine, MachineValidationError,
  DIRECTIONS, MAX_INPUT_LENGTH, DEFAULT_MAX_STEPS, HARD_MAX_STEPS,
};
