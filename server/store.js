'use strict';
/** Minimal JSON-file persistence (atomic write). Swap for PostgreSQL later behind the same API. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = process.env.TURINGLAB_DATA || path.join(__dirname, '..', 'data', 'db.json');

class Store {
  constructor(file = DATA_FILE) {
    this.file = file;
    this.db = { machines: [], executions: [] };
    if (file !== ':memory:' && fs.existsSync(file)) {
      try { this.db = { ...this.db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) {
        console.error('Could not parse data file, starting empty:', e.message);
      }
    }
  }
  save() {
    if (this.file === ':memory:') return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db));
    fs.renameSync(tmp, this.file);
  }
  id() { return crypto.randomUUID(); }

  listMachines() { return [...this.db.machines].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
  getMachine(id) { return this.db.machines.find((m) => m.id === id) || null; }
  createMachine(data) {
    const now = new Date().toISOString();
    const m = { ...data, id: this.id(), createdAt: now, updatedAt: now };
    this.db.machines.push(m); this.save(); return m;
  }
  updateMachine(id, data) {
    const i = this.db.machines.findIndex((m) => m.id === id);
    if (i < 0) return null;
    this.db.machines[i] = { ...this.db.machines[i], ...data, id, updatedAt: new Date().toISOString() };
    this.save(); return this.db.machines[i];
  }
  deleteMachine(id) {
    const before = this.db.machines.length;
    this.db.machines = this.db.machines.filter((m) => m.id !== id);
    if (this.db.machines.length === before) return false;
    this.save(); return true;
  }

  addExecution(e) { const ex = { ...e, id: this.id() }; this.db.executions.push(ex); this.save(); return ex; }
  listExecutions() { return [...this.db.executions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  getExecution(id) { return this.db.executions.find((e) => e.id === id) || null; }
}

module.exports = { Store };
