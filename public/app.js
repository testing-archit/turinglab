'use strict';
/* TuringLab SPA — all computation happens on the backend; this file only renders and replays recorded configurations. */

// ---------- utilities ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtDate = (d) => new Date(d).toLocaleString();
const badge = (s) => `<span class="badge b-${esc(s)}">${esc(s)}</span>`;
const dirName = { L: 'LEFT', R: 'RIGHT', S: 'STAY' };

function toast(msg, err = false) {
  const d = document.createElement('div');
  d.className = err ? 'err' : '';
  d.textContent = msg;
  $('#toast').appendChild(d);
  setTimeout(() => d.remove(), 4500);
}

async function api(method, url, body) {
  let r;
  try {
    r = await fetch(`/api${url}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new Error('Cannot reach the TuringLab server');
  }
  const data = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) {
    const e = new Error(data?.message || `Request failed (${r.status})`);
    e.errors = data?.errors || [];
    throw e;
  }
  return data;
}
const safe = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };

function confirmDialog(msg) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" style="width:420px"><h2>Please confirm</h2><p>${esc(msg)}</p><div class="row" style="justify-content:flex-end"><button data-a="0">Cancel</button><button class="primary" data-a="1">Confirm</button></div></div>`;
    bg.onclick = (e) => { const a = e.target.dataset?.a; if (a !== undefined || e.target === bg) { bg.remove(); resolve(a === '1'); } };
    document.body.appendChild(bg);
  });
}

// ---------- shared renderers ----------
function renderTape(tapeObj, head, blank, flashPos = null) {
  const positions = Object.keys(tapeObj).map(Number);
  const lo = Math.min(head, ...positions, 0) - 4;
  const hi = Math.max(head, ...positions, 0) + 4;
  let html = '';
  for (let p = lo; p <= hi; p++) {
    const sym = tapeObj[p] ?? blank;
    const cls = ['cell', sym === blank ? 'blank' : '', p === head ? 'head' : '', p === flashPos ? 'flash' : ''].join(' ');
    html += `<div class="${cls}">${esc(sym)}<span class="idx">${p}</span></div>`;
  }
  return `<div class="tape-wrap"><div class="tape">${html}</div></div>`;
}

function layoutFor(m) {
  const pos = {};
  const n = m.states.length;
  m.states.forEach((s, i) => {
    if (m.layout && m.layout[s]) { pos[s] = m.layout[s]; return; }
    const cols = Math.ceil(Math.sqrt(n * 2));
    pos[s] = { x: 80 + (i % cols) * 140, y: 70 + Math.floor(i / cols) * 120 + (i % 2) * 30 };
  });
  return pos;
}

function graphSVG(m, { active = null, activeEdge = null } = {}) {
  const pos = layoutFor(m);
  const groups = {};
  for (const t of m.transitions) {
    const k = `${t.from}\u0000${t.to}`;
    (groups[k] ||= { from: t.from, to: t.to, labels: [] }).labels.push(`${t.read}→${t.write},${t.dir}`);
  }
  const xs = Object.values(pos).map((p) => p.x);
  const ys = Object.values(pos).map((p) => p.y);
  const vb = `${Math.min(...xs, 0) - 70} ${Math.min(...ys, 0) - 80} ${Math.max(...xs, 400) - Math.min(...xs, 0) + 160} ${Math.max(...ys, 260) - Math.min(...ys, 0) + 150}`;
  let edges = '';
  for (const g of Object.values(groups)) {
    const a = pos[g.from]; const b = pos[g.to];
    if (!a || !b) continue;
    const hot = activeEdge && activeEdge.from === g.from && activeEdge.to === g.to;
    const color = hot ? 'var(--accent2)' : 'var(--muted)';
    const lines = g.labels.map((l, i) => `<tspan x="0" dy="${i ? 13 : 0}">${esc(l)}</tspan>`).join('');
    if (g.from === g.to) {
      edges += `<path d="M${a.x - 12},${a.y - 22} C${a.x - 40},${a.y - 75} ${a.x + 40},${a.y - 75} ${a.x + 12},${a.y - 22}" fill="none" stroke="${color}" stroke-width="${hot ? 2.5 : 1.4}" marker-end="url(#arr${hot ? 'h' : ''})"/>`;
      edges += `<text transform="translate(${a.x},${a.y - 66 - (g.labels.length - 1) * 13})" font-size="11" text-anchor="middle" fill="${color}">${lines}</text>`;
      continue;
    }
    const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
    const bidir = groups[`${g.to}\u0000${g.from}`];
    const off = bidir ? 28 : 0;
    const nx = -dy / len; const ny = dx / len;
    const sx = a.x + (dx / len) * 25; const sy = a.y + (dy / len) * 25;
    const ex = b.x - (dx / len) * 27; const ey = b.y - (dy / len) * 27;
    const cx = (a.x + b.x) / 2 + nx * off * 1.6; const cy = (a.y + b.y) / 2 + ny * off * 1.6;
    edges += `<path d="M${sx},${sy} Q${cx},${cy} ${ex},${ey}" fill="none" stroke="${color}" stroke-width="${hot ? 2.5 : 1.4}" marker-end="url(#arr${hot ? 'h' : ''})"/>`;
    const lx = (sx + 2 * cx + ex) / 4 + nx * 10; const ly = (sy + 2 * cy + ey) / 4 + ny * 10;
    edges += `<text transform="translate(${lx},${ly - (g.labels.length - 1) * 6})" font-size="11" text-anchor="middle" fill="${color}" style="paint-order:stroke;stroke:var(--bg);stroke-width:4px">${lines}</text>`;
  }
  let nodes = '';
  for (const s of m.states) {
    const p = pos[s];
    const isA = s === m.acceptState; const isR = s === m.rejectState; const isI = s === m.initialState;
    const stroke = isA ? 'var(--ok)' : isR ? 'var(--bad)' : 'var(--accent)';
    const fill = s === active ? stroke : 'var(--panel2)';
    nodes += `<g class="node" data-node="${esc(s)}" transform="translate(${p.x},${p.y})">`;
    if (isI) nodes += `<path d="M-52,0 L-27,0" stroke="var(--text)" stroke-width="1.6" marker-end="url(#arrs)"/>`;
    nodes += `<circle r="24" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
    if (isA || isR) nodes += `<circle r="19" fill="none" stroke="${stroke}" stroke-width="1.4"/>`;
    nodes += `<text text-anchor="middle" dy="4" font-size="12" font-weight="600" ${s === active ? 'fill="#0b0d12"' : ''}>${esc(s)}</text></g>`;
  }
  const marker = (id, c) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`;
  return `<svg class="graph" viewBox="${vb}"><defs>${marker('arr', 'var(--muted)')}${marker('arrh', 'var(--accent2)')}${marker('arrs', 'var(--text)')}</defs>${edges}${nodes}</svg>`;
}

function enableDrag(container, machine, onChange) {
  const svg = container.querySelector('svg');
  if (!svg) return;
  let drag = null;
  const pt = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
  svg.onmousedown = (e) => { const g = e.target.closest('.node'); if (g) { drag = g.dataset.node; machine.layout = { ...layoutFor(machine) }; } };
  svg.onmousemove = (e) => {
    if (!drag) return;
    const p = pt(e);
    machine.layout[drag] = { x: Math.round(p.x), y: Math.round(p.y) };
    const g = svg.querySelector(`.node[data-node="${CSS.escape(drag)}"]`);
    if (g) g.setAttribute('transform', `translate(${p.x},${p.y})`);
  };
  const end = () => { if (drag) { drag = null; onChange(); } };
  svg.onmouseup = end; svg.onmouseleave = end;
}

function transitionTable(m) {
  return `<table><tr><th>δ(state, read)</th><th>next</th><th>write</th><th>move</th></tr>${m.transitions.map((t) =>
    `<tr><td class="mono">δ(${esc(t.from)}, ${esc(t.read)})</td><td class="mono">${esc(t.to)}</td><td class="mono">${esc(t.write)}</td><td class="mono">${esc(t.dir)}</td></tr>`).join('')}</table>`;
}

function formalDef(m) {
  return `<div class="kv mono" style="font-size:12px">
    <div>Q</div><div>{${m.states.map(esc).join(', ')}}</div>
    <div>Σ</div><div>{${m.inputAlphabet.map(esc).join(', ')}}</div>
    <div>Γ</div><div>{${m.tapeAlphabet.map(esc).join(', ')}}</div>
    <div>blank</div><div>${esc(m.blank)}</div>
    <div>q₀</div><div>${esc(m.initialState)}</div>
    <div>q_accept</div><div>${esc(m.acceptState)}</div>
    <div>q_reject</div><div>${esc(m.rejectState)}</div></div>`;
}

// ---------- pages ----------
const pages = {};

pages.dashboard = async (el) => {
  const [an, machines, execs, tps] = await Promise.all([api('GET', '/analytics'), api('GET', '/machines'), api('GET', '/executions'), api('GET', '/templates')]);
  el.innerHTML = `
  <header class="top"><div><h1>Dashboard</h1><div class="sub">Design, simulate and analyse deterministic Turing Machines.</div></div>
  <div class="row"><a class="btn" href="#/designer">＋ New machine</a><a class="btn primary" style="background:var(--accent);color:#fff" href="#/simulator">▶ Open simulator</a></div></header>
  <div class="grid g4">
    ${[['Saved machines', an.totalMachines], ['Simulations', an.totalExecutions], ['Accepted', an.accepted], ['Rejected', an.rejected]].map(([l, v]) => `<div class="card stat"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}
  </div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h2>Recent machines</h2>${machines.length ? `<table>${machines.slice(0, 6).map((m) => `<tr class="click" data-href="#/designer/${m.id}"><td>${esc(m.name)}</td><td class="muted">${m.states} states · ${m.transitions} rules</td><td class="muted">${fmtDate(m.updatedAt)}</td></tr>`).join('')}</table>` : '<div class="empty">No saved machines yet. Create one in the designer or copy a template from the library.</div>'}</div>
    <div class="card"><h2>Recent executions</h2>${execs.length ? `<table>${execs.slice(0, 6).map((e) => `<tr class="click" data-href="#/history/${e.id}"><td>${esc(e.machineName)}</td><td class="mono">${esc(e.input) || 'ε'}</td><td>${badge(e.status)}</td><td class="muted">${e.totalSteps} steps</td></tr>`).join('')}</table>` : '<div class="empty">No executions yet. Run a machine in the simulator.</div>'}</div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Quick-start templates</h2><div class="grid g3">${tps.map((t) => `
    <div class="card" style="background:var(--panel2)"><b>${esc(t.name)}</b><div class="muted" style="font-size:12px;margin:6px 0 10px">${esc(t.description.slice(0, 110))}…</div>
    <a class="btn" href="#/simulator?template=${t.key}&input=${encodeURIComponent(t.samples[0].input)}">▶ Simulate</a></div>`).join('')}</div></div>`;
  el.querySelectorAll('[data-href]').forEach((r) => { r.onclick = () => { location.hash = r.dataset.href; }; });
};

// ----- Designer -----
const blankMachine = () => ({
  name: 'Untitled machine', description: '', inputAlphabet: ['0', '1'], tapeAlphabet: ['0', '1', '_'], blank: '_',
  states: ['q0', 'qa', 'qr'], initialState: 'q0', acceptState: 'qa', rejectState: 'qr', transitions: [], layout: {},
});
const parseSymbols = (s) => s.split(/[\s,]+/).filter(Boolean);

pages.designer = async (el, [id], query) => {
  let m;
  if (id) m = await api('GET', `/machines/${id}`);
  else if (query.get('template')) { const t = await api('GET', `/templates/${query.get('template')}`); m = { ...t, name: `${t.name} (copy)`, layout: {} }; delete m.key; delete m.samples; }
  else m = blankMachine();
  let issues = null;
  let editIndex = null; // transition being edited

  const render = () => {
    const stateOpts = (sel) => m.states.map((s) => `<option ${s === sel ? 'selected' : ''}>${esc(s)}</option>`).join('');
    const tr = editIndex !== null ? (m.transitions[editIndex] || { from: m.initialState, read: m.blank, to: m.initialState, write: m.blank, dir: 'R' }) : null;
    el.innerHTML = `
    <header class="top"><div><h1>Machine Designer</h1><div class="sub">${id ? 'Editing saved machine' : 'New machine (unsaved)'} · drag states to arrange the graph</div></div>
    <div class="row">
      <button id="validate">✓ Validate</button>
      <button id="simulate" ${id ? '' : 'disabled title="Save first"'}>▶ Simulate</button>
      ${id ? '<button id="delete" class="danger">🗑 Delete</button>' : ''}
      <button id="save" class="primary">💾 ${id ? 'Save changes' : 'Save machine'}</button>
    </div></header>
    ${issues ? (issues.length ? `<div class="errors" style="margin-bottom:12px"><b>Validation failed</b><ul>${issues.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : '<div class="okbox" style="margin-bottom:12px">✓ Machine definition is valid and deterministic.</div>') : ''}
    <div class="grid" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
      <div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h2 style="margin:0">State graph</h2><button id="relayout">⟲ Reset layout</button></div>
        <div id="graph">${graphSVG(m)}</div>
        <div class="muted" style="font-size:12px;margin-top:6px">→ initial · <span style="color:var(--ok)">◎ accept</span> · <span style="color:var(--bad)">◎ reject</span> · labels show read→write,move</div>
      </div>
      <div class="card">
        <h2>Definition</h2>
        <div class="field"><label>Name</label><input id="f-name" value="${esc(m.name)}" maxlength="120"></div>
        <div class="field"><label>Description</label><textarea id="f-desc" rows="2">${esc(m.description)}</textarea></div>
        <div class="grid g3" style="gap:8px">
          <div class="field"><label>Input alphabet Σ</label><input id="f-sigma" class="mono" value="${esc(m.inputAlphabet.join(', '))}"></div>
          <div class="field"><label>Tape alphabet Γ</label><input id="f-gamma" class="mono" value="${esc(m.tapeAlphabet.join(', '))}"></div>
          <div class="field"><label>Blank</label><input id="f-blank" class="mono" maxlength="1" value="${esc(m.blank)}"></div>
        </div>
        <div class="grid g3" style="gap:8px">
          <div class="field"><label>Initial q₀</label><select id="f-init">${stateOpts(m.initialState)}</select></div>
          <div class="field"><label>Accept</label><select id="f-acc">${stateOpts(m.acceptState)}</select></div>
          <div class="field"><label>Reject</label><select id="f-rej">${stateOpts(m.rejectState)}</select></div>
        </div>
        <h3>States Q</h3>
        <div>${m.states.map((s, i) => `<span class="chip">${esc(s)} <a href="javascript:void 0" data-ren="${i}" title="Rename">✎</a> <a href="javascript:void 0" data-del="${i}" title="Delete" style="color:var(--bad)">×</a></span>`).join('')}</div>
        <div class="row" style="margin-top:8px"><input id="new-state" placeholder="new state name" style="flex:1"><button id="add-state">＋ Add state</button></div>
      </div>
    </div>
    <div class="card" style="margin-top:14px">
      <div class="row" style="justify-content:space-between"><h2 style="margin:0">Transition function δ (${m.transitions.length})</h2><button id="add-tr" class="primary">＋ Add transition</button></div>
      ${tr ? `<div class="card" style="background:var(--panel2);margin-top:12px" id="tr-form"><b>${editIndex < m.transitions.length ? 'Edit' : 'New'} transition</b> <span class="muted mono">δ(q, a) = (p, b, D)</span>
        <div class="grid" style="grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:8px">
          <div><label>From q</label><select id="t-from">${stateOpts(tr.from)}</select></div>
          <div><label>Read a</label><input id="t-read" class="mono" maxlength="1" value="${esc(tr.read)}"></div>
          <div><label>To p</label><select id="t-to">${stateOpts(tr.to)}</select></div>
          <div><label>Write b</label><input id="t-write" class="mono" maxlength="1" value="${esc(tr.write)}"></div>
          <div><label>Move D</label><select id="t-dir">${['L', 'R', 'S'].map((d) => `<option value="${d}" ${d === tr.dir ? 'selected' : ''}>${d} — ${dirName[d]}</option>`).join('')}</select></div>
        </div><div id="t-err" class="errors" style="display:none;margin-top:8px"></div>
        <div class="row" style="margin-top:10px;justify-content:flex-end"><button id="t-cancel">Cancel</button><button id="t-ok" class="primary">Apply</button></div></div>` : ''}
      ${m.transitions.length ? `<table style="margin-top:10px"><tr><th>From</th><th>Read</th><th>To</th><th>Write</th><th>Move</th><th></th></tr>
        ${m.transitions.map((t, i) => `<tr><td class="mono">${esc(t.from)}</td><td class="mono">${esc(t.read)}</td><td class="mono">${esc(t.to)}</td><td class="mono">${esc(t.write)}</td><td class="mono">${esc(t.dir)}</td>
        <td style="text-align:right"><button data-edit="${i}">Edit</button> <button class="danger" data-rm="${i}">Delete</button></td></tr>`).join('')}</table>`
        : '<div class="empty">No transitions yet. Add one to define δ.</div>'}
    </div>`;
    wire();
  };

  const syncForm = () => {
    m.name = $('#f-name').value; m.description = $('#f-desc').value;
    m.inputAlphabet = parseSymbols($('#f-sigma').value); m.tapeAlphabet = parseSymbols($('#f-gamma').value);
    m.blank = $('#f-blank').value; m.initialState = $('#f-init').value; m.acceptState = $('#f-acc').value; m.rejectState = $('#f-rej').value;
  };

  const wire = () => {
    ['#f-name', '#f-desc', '#f-sigma', '#f-gamma', '#f-blank', '#f-init', '#f-acc', '#f-rej'].forEach((s) => { $(s).onchange = () => { syncForm(); if (s.match(/init|acc|rej/)) render(); }; });
    enableDrag($('#graph'), m, () => {});
    $('#relayout').onclick = () => { m.layout = {}; render(); };
    $('#add-state').onclick = () => {
      syncForm();
      const n = $('#new-state').value.trim();
      if (!n) return toast('State name is required', true);
      if (m.states.includes(n)) return toast(`State "${n}" already exists`, true);
      m.states.push(n); render();
    };
    el.querySelectorAll('[data-ren]').forEach((a) => { a.onclick = () => {
      syncForm();
      const old = m.states[a.dataset.ren];
      const n = (prompt === undefined ? null : window.prompt(`Rename state "${old}" to:`, old) || '').trim();
      if (!n || n === old) return;
      if (m.states.includes(n)) return toast(`State "${n}" already exists`, true);
      m.states[a.dataset.ren] = n;
      for (const k of ['initialState', 'acceptState', 'rejectState']) if (m[k] === old) m[k] = n;
      for (const t of m.transitions) { if (t.from === old) t.from = n; if (t.to === old) t.to = n; }
      if (m.layout?.[old]) { m.layout[n] = m.layout[old]; delete m.layout[old]; }
      render();
    }; });
    el.querySelectorAll('[data-del]').forEach((a) => { a.onclick = async () => {
      syncForm();
      const s = m.states[a.dataset.del];
      const used = m.transitions.filter((t) => t.from === s || t.to === s).length;
      if (!(await confirmDialog(`Delete state "${s}"${used ? ` and its ${used} transition(s)` : ''}?`))) return;
      m.states.splice(a.dataset.del, 1);
      m.transitions = m.transitions.filter((t) => t.from !== s && t.to !== s);
      render();
    }; });
    $('#add-tr').onclick = () => { syncForm(); editIndex = m.transitions.length; render(); };
    el.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => { syncForm(); editIndex = Number(b.dataset.edit); render(); }; });
    el.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { syncForm(); m.transitions.splice(Number(b.dataset.rm), 1); editIndex = null; render(); }; });
    if ($('#t-ok')) {
      $('#t-cancel').onclick = () => { editIndex = null; render(); };
      $('#t-ok').onclick = () => {
        syncForm();
        const t = { from: $('#t-from').value, read: $('#t-read').value, to: $('#t-to').value, write: $('#t-write').value, dir: $('#t-dir').value };
        const errs = validateTransitionForm(t, m, editIndex);
        if (errs.length) { $('#t-err').style.display = 'block'; $('#t-err').innerHTML = errs.map(esc).join('<br>'); return; }
        m.transitions[editIndex] = t; editIndex = null; render();
      };
    }
    $('#validate').onclick = safe(async () => { syncForm(); issues = (await api('POST', '/machines/validate', m)).errors; render(); });
    $('#save').onclick = safe(async () => {
      syncForm();
      try {
        const saved = id ? await api('PUT', `/machines/${id}`, m) : await api('POST', '/machines', m);
        toast('Machine saved');
        if (!id) { location.hash = `#/designer/${saved.id}`; return; }
        issues = []; render();
      } catch (e) { issues = e.errors.length ? e.errors : [e.message]; render(); }
    });
    if ($('#simulate')) $('#simulate').onclick = () => { if (id) location.hash = `#/simulator?machine=${id}`; };
    if ($('#delete')) $('#delete').onclick = safe(async () => {
      if (!(await confirmDialog(`Delete machine "${m.name}" permanently?`))) return;
      await api('DELETE', `/machines/${id}`); toast('Machine deleted'); location.hash = '#/dashboard';
    });
  };
  render();
};

function validateTransitionForm(t, m, index) {
  const errs = [];
  if ([...t.read].length !== 1) errs.push('Read symbol must be exactly one character');
  else if (!m.tapeAlphabet.includes(t.read)) errs.push(`Read symbol "${t.read}" is not in Γ`);
  if ([...t.write].length !== 1) errs.push('Write symbol must be exactly one character');
  else if (!m.tapeAlphabet.includes(t.write)) errs.push(`Write symbol "${t.write}" is not in Γ`);
  if (t.from === m.acceptState || t.from === m.rejectState) errs.push('Halting states cannot have outgoing transitions');
  if (m.transitions.some((o, i) => i !== index && o.from === t.from && o.read === t.read)) errs.push(`δ(${t.from}, ${t.read}) is already defined — machine must stay deterministic`);
  return errs;
}

// ----- Simulator -----
const SPEEDS = [1000, 600, 350, 180, 80, 25, 1];
let simLoop = { running: false };

pages.simulator = async (el, _p, query) => {
  const [machines, tps] = await Promise.all([api('GET', '/machines'), api('GET', '/templates')]);
  const st = { sim: null, machine: null, trace: [], initial: null, view: null, speed: 3, playing: false, flash: null };
  const sel = query.get('machine') ? `m:${query.get('machine')}` : query.get('template') ? `t:${query.get('template')}` : (tps[0] ? `t:${tps[0].key}` : '');

  el.innerHTML = `
  <header class="top"><div><h1>Simulator</h1><div class="sub">Step through computations on the backend engine; inspect any earlier configuration.</div></div></header>
  <div class="card"><div class="grid" style="grid-template-columns:2fr 2fr 1fr auto;gap:10px;align-items:end">
    <div><label>Machine</label><select id="s-machine">
      <optgroup label="Templates">${tps.map((t) => `<option value="t:${t.key}">${esc(t.name)}</option>`).join('')}</optgroup>
      ${machines.length ? `<optgroup label="Saved machines">${machines.map((m) => `<option value="m:${m.id}">${esc(m.name)}</option>`).join('')}</optgroup>` : ''}
    </select></div>
    <div><label>Input string</label><input id="s-input" class="mono" maxlength="1000" value="${esc(query.get('input') ?? '')}" placeholder="ε (empty)"></div>
    <div><label>Max steps</label><input id="s-max" type="number" min="1" max="50000" value="10000"></div>
    <button id="s-load" class="primary">⏏ Load</button>
  </div><div id="s-alpha" class="muted" style="font-size:12px;margin-top:8px"></div></div>
  <div id="s-body" style="margin-top:14px"><div class="card empty">Pick a machine and input, then press Load.</div></div>`;
  $('#s-machine').value = sel;

  const loadMachineInfo = async () => {
    const v = $('#s-machine').value;
    st.machine = v.startsWith('t:') ? tps.find((t) => `t:${t.key}` === v) : await api('GET', `/machines/${v.slice(2)}`);
    const m = st.machine;
    $('#s-alpha').innerHTML = `Σ = {${m.inputAlphabet.map(esc).join(', ')}} · Γ = {${m.tapeAlphabet.map(esc).join(', ')}} · blank = <span class="mono">${esc(m.blank)}</span>${m.samples ? ` · samples: ${m.samples.map((s) => `<a href="javascript:void 0" class="mono" data-sample="${esc(s.input)}">${esc(s.input) || 'ε'}</a>`).join(', ')}` : ''}`;
    el.querySelectorAll('[data-sample]').forEach((a) => { a.onclick = () => { $('#s-input').value = a.dataset.sample; load(); }; });
  };

  const config = (i) => {
    if (i === 0) return { state: st.initial.state, head: st.initial.head, tape: st.initial.tape, rule: null };
    const t = st.trace[i - 1];
    return { state: t.nextState, head: t.headAfter, tape: t.tape, rule: t };
  };

  const render = () => {
    const s = st.sim; const m = st.machine;
    const live = st.view === null;
    const idx = live ? st.trace.length : st.view;
    const c = config(idx);
    const r = c.rule;
    const running = s.status === 'RUNNING';
    $('#s-body').innerHTML = `
    <div class="card">
      <div class="row" style="justify-content:space-between">
        <div class="row">${badge(s.status)} <span class="muted">${live ? 'Live' : `Inspecting step ${idx} of ${st.trace.length} (execution unaffected)`}</span></div>
        <div class="row">
          ${st.playing ? '<button id="c-pause">⏸ Pause</button>' : `<button id="c-start" class="primary" ${running ? '' : 'disabled'}>▶ ${s.steps > 0 ? 'Resume' : 'Start'}</button>`}
          <button id="c-step" ${running && !st.playing ? '' : 'disabled'}>⤼ Single step</button>
          <button id="c-run" ${running && !st.playing ? '' : 'disabled'}>⏭ Run to end</button>
          <button id="c-prev" ${idx > 0 && !st.playing ? '' : 'disabled'}>◀ Previous</button>
          <button id="c-next" ${!live && !st.playing ? '' : 'disabled'}>Next ▶</button>
          <button id="c-reset" ${st.playing ? 'disabled' : ''}>↺ Reset</button>
          <label style="margin:0 0 0 8px">Speed</label><input id="c-speed" type="range" min="0" max="6" value="${st.speed}" style="width:100px">
        </div>
      </div>
      ${renderTape(c.tape, c.head, m.blank, live ? st.flash : null)}
      ${s.haltReason && live ? `<div class="muted" style="text-align:center;margin-top:6px">${esc(s.haltReason)}</div>` : ''}
    </div>
    <div class="grid g3" style="margin-top:14px">
      <div class="card"><h2>Configuration</h2><div class="kv">
        <div>Step</div><div class="mono">${idx}</div><div>State</div><div class="mono">${esc(c.state)}</div>
        <div>Head</div><div class="mono">${c.head}</div><div>Input</div><div class="mono">${esc(s.input) || 'ε'}</div>
        <div>Tape output</div><div class="mono">${esc(live ? s.output : '') || (live ? 'ε' : '—')}</div><div>Tape cells used</div><div class="mono">${live ? s.tapeUtilization : '—'}</div></div></div>
      <div class="card"><h2>Current transition</h2>${r ? `<div class="rule">δ(${esc(r.state)}, ${esc(r.read)}) = (${esc(r.nextState)}, ${esc(r.write)}, ${r.direction})</div>
        <div class="kv" style="margin-top:10px"><div>Read</div><div class="mono">${esc(r.read)}</div><div>Written</div><div class="mono">${esc(r.write)}</div><div>Move</div><div class="mono">${dirName[r.direction]}</div></div>` : '<div class="empty">Initial configuration — no transition applied yet.</div>'}</div>
      <div class="card"><h2>State graph</h2>${graphSVG(m, { active: c.state, activeEdge: r ? { from: r.state, to: r.nextState } : null }).replace('class="graph"', 'class="graph" style="height:220px"')}</div>
    </div>
    <div class="card" style="margin-top:14px"><h2>Execution trace (${st.trace.length} steps)</h2>
      ${st.trace.length ? `<div class="scroll" id="trace"><table><tr><th>#</th><th>State</th><th>Head</th><th>Read</th><th>Write</th><th>Dir</th><th>Next state</th></tr>
      ${st.trace.slice(-300).map((t) => `<tr class="click ${t.step === idx ? 'sel' : ''}" data-step="${t.step}"><td class="mono">${t.step}</td><td class="mono">${esc(t.state)}</td><td class="mono">${t.head}</td><td class="mono">${esc(t.read)}</td><td class="mono">${esc(t.write)}</td><td class="mono">${t.direction}</td><td class="mono">${esc(t.nextState)}</td></tr>`).join('')}</table></div>
      ${st.trace.length > 300 ? '<div class="muted" style="font-size:12px">Showing the latest 300 steps.</div>' : ''}` : '<div class="empty">No steps yet.</div>'}</div>`;
    wire();
    const tr = $('#trace'); if (tr && live) tr.scrollTop = tr.scrollHeight;
  };

  const apply = (s) => {
    st.sim = s;
    if (s.lastStep && (!st.trace.length || st.trace[st.trace.length - 1].step < s.lastStep.step)) st.trace.push(s.lastStep);
    st.flash = s.lastStep ? s.lastStep.head : null;
  };

  const step = async () => { apply(await api('POST', `/simulations/${st.sim.id}/step`)); st.view = null; };
  const play = async () => {
    st.playing = true; st.view = null; simLoop = st; render();
    try {
      while (st.playing && st.sim.status === 'RUNNING' && simLoop === st) {
        await step();
        render();
        await sleep(SPEEDS[st.speed]);
      }
    } catch (e) { toast(e.message, true); }
    if (st.playing && st.sim.status !== 'RUNNING') toast(`Execution finished: ${st.sim.status}`);
    st.playing = false;
    if (simLoop === st) render();
  };

  const wire = () => {
    if ($('#c-start')) $('#c-start').onclick = () => play();
    if ($('#c-pause')) $('#c-pause').onclick = safe(async () => { st.playing = false; await api('POST', `/simulations/${st.sim.id}/pause`); render(); });
    $('#c-step').onclick = safe(async () => { await step(); render(); });
    $('#c-run').onclick = safe(async () => {
      st.sim = await api('POST', `/simulations/${st.sim.id}/run`, {});
      const h = await api('GET', `/simulations/${st.sim.id}/history`);
      st.trace = h.trace; st.view = null; st.flash = null; render();
      toast(`Execution finished: ${st.sim.status} in ${st.sim.steps} steps`);
    });
    $('#c-prev').onclick = () => { const i = st.view === null ? st.trace.length : st.view; st.view = Math.max(0, i - 1); render(); };
    $('#c-next').onclick = () => { st.view = st.view + 1 >= st.trace.length ? null : st.view + 1; render(); };
    $('#c-reset').onclick = safe(async () => { st.sim = await api('POST', `/simulations/${st.sim.id}/reset`); st.trace = []; st.view = null; st.flash = null; render(); });
    $('#c-speed').oninput = (e) => { st.speed = Number(e.target.value); };
    el.querySelectorAll('[data-step]').forEach((r) => { r.onclick = () => { if (st.playing) return; const n = Number(r.dataset.step); st.view = n === st.trace.length ? null : n; render(); }; });
  };

  const load = safe(async () => {
    st.playing = false;
    const v = $('#s-machine').value;
    const body = { input: $('#s-input').value, maxSteps: Number($('#s-max').value) };
    if (v.startsWith('t:')) body.templateKey = v.slice(2); else body.machineId = v.slice(2);
    try {
      const s = await api('POST', '/simulations', body);
      st.sim = s; st.trace = []; st.view = null; st.flash = null;
      st.initial = (await api('GET', `/simulations/${s.id}/history`)).initial;
      render();
    } catch (e) {
      $('#s-body').innerHTML = `<div class="errors"><b>${esc(e.message)}</b>${e.errors.length > 1 ? `<ul>${e.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`;
    }
  });

  $('#s-load').onclick = load;
  $('#s-machine').onchange = safe(loadMachineInfo);
  $('#s-input').onkeydown = (e) => { if (e.key === 'Enter') load(); };
  await loadMachineInfo();
  if (query.get('machine') || query.get('template')) await load();
};

// ----- Library -----
pages.library = async (el) => {
  const tps = await api('GET', '/templates');
  el.innerHTML = `<header class="top"><div><h1>Machine Library</h1><div class="sub">Verified template machines — each is covered by automated tests.</div></div></header>
  ${tps.map((t) => `<div class="card" style="margin-bottom:14px">
    <div class="row" style="justify-content:space-between"><div><h2 style="margin:0">${esc(t.name)}</h2><div class="muted" style="max-width:760px;margin-top:4px">${esc(t.description)}</div></div>
    <div class="row"><a class="btn primary" style="background:var(--accent);color:#fff" href="#/simulator?template=${t.key}&input=${encodeURIComponent(t.samples[0].input)}">▶ Open in simulator</a><a class="btn" href="#/designer?template=${t.key}">⧉ Copy to designer</a></div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) minmax(0,1fr);margin-top:12px">
      <div>${graphSVG(t).replace('class="graph"', 'class="graph" style="height:260px"')}</div>
      <div><h3>Formal definition</h3>${formalDef(t)}<h3>Sample inputs & expected behaviour</h3>
        <table>${t.samples.map((s) => `<tr><td class="mono"><a href="#/simulator?template=${t.key}&input=${encodeURIComponent(s.input)}">${esc(s.input) || 'ε'}</a></td><td>${badge(s.status)}</td><td class="mono">${s.output !== undefined ? `→ ${esc(s.output) || 'ε'}` : ''}</td></tr>`).join('')}</table></div>
      <div class="scroll" style="max-height:300px"><h3>Transition table</h3>${transitionTable(t)}</div>
    </div></div>`).join('')}`;
};

// ----- History -----
pages.history = async (el, [execId], query) => {
  const [all, an] = await Promise.all([api('GET', '/executions'), api('GET', '/analytics')]);
  const machineNames = an.perMachine.map((p) => p.machine);
  const fm = query.get('machine') || ''; const fs = query.get('status') || '';
  const list = all.filter((e) => (!fm || e.machineName === fm) && (!fs || e.status === fs));
  el.innerHTML = `<header class="top"><div><h1>Execution History</h1><div class="sub">Every completed execution is persisted with its full trace.</div></div></header>
  <div class="card"><div class="row" style="margin-bottom:10px">
    <div style="width:240px"><label>Machine</label><select id="h-m"><option value="">All machines</option>${machineNames.map((n) => `<option ${n === fm ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
    <div style="width:200px"><label>Result</label><select id="h-s"><option value="">All results</option>${['ACCEPTED', 'REJECTED', 'HALTED', 'LOOP_DETECTED', 'STEP_LIMIT'].map((s) => `<option ${s === fs ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
  </div>
  ${list.length ? `<table><tr><th>Machine</th><th>Input</th><th>Result</th><th>Steps</th><th>Output</th><th>Date</th></tr>${list.map((e) => `<tr class="click" data-id="${e.id}"><td>${esc(e.machineName)}</td><td class="mono">${esc(e.input) || 'ε'}</td><td>${badge(e.status)}</td><td class="mono">${e.totalSteps}</td><td class="mono">${esc(e.output) || 'ε'}</td><td class="muted">${fmtDate(e.createdAt)}</td></tr>`).join('')}</table>` : '<div class="empty">No executions match these filters.</div>'}</div>`;
  const filter = () => { const q = new URLSearchParams(); if ($('#h-m').value) q.set('machine', $('#h-m').value); if ($('#h-s').value) q.set('status', $('#h-s').value); location.hash = `#/history?${q}`; };
  $('#h-m').onchange = filter; $('#h-s').onchange = filter;
  el.querySelectorAll('[data-id]').forEach((r) => { r.onclick = () => openReplay(r.dataset.id); });
  if (execId) openReplay(execId);
};

async function openReplay(id) {
  const e = await api('GET', `/executions/${id}`).catch((err) => { toast(err.message, true); return null; });
  if (!e) return;
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  document.body.appendChild(bg);
  let i = 0; let timer = null;
  const cfg = (k) => (k === 0 ? { ...e.initial, rule: null } : { state: e.trace[k - 1].nextState, head: e.trace[k - 1].headAfter, tape: e.trace[k - 1].tape, rule: e.trace[k - 1] });
  const stop = () => { clearInterval(timer); timer = null; };
  const render = () => {
    const c = cfg(i); const r = c.rule;
    bg.innerHTML = `<div class="modal"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${esc(e.machineName)} · <span class="mono">${esc(e.input) || 'ε'}</span> ${badge(e.status)}</h2><button data-x="close">✕ Close</button></div>
      <div class="muted" style="margin-top:4px">${esc(e.haltReason || '')} · ${e.totalSteps} steps · ${e.durationMs} ms · ${fmtDate(e.createdAt)}${e.traceTruncated ? ' · trace truncated to first 2000 steps' : ''}</div>
      ${renderTape(c.tape, c.head, e.blank)}
      <div class="row" style="justify-content:center;margin:8px 0">
        <button data-x="first">⏮</button><button data-x="prev" ${i ? '' : 'disabled'}>◀ Prev</button>
        <button data-x="play" class="primary">${timer ? '⏸ Pause' : '▶ Replay'}</button>
        <button data-x="next" ${i < e.trace.length ? '' : 'disabled'}>Next ▶</button><button data-x="last">⏭</button>
        <span class="mono">step ${i}/${e.trace.length} · state ${esc(c.state)} · head ${c.head}</span></div>
      ${r ? `<div class="rule">δ(${esc(r.state)}, ${esc(r.read)}) = (${esc(r.nextState)}, ${esc(r.write)}, ${r.direction})</div>` : ''}
      <div class="scroll" style="margin-top:10px"><table><tr><th>#</th><th>State</th><th>Head</th><th>Read</th><th>Write</th><th>Dir</th><th>Next</th></tr>
      ${e.trace.map((t) => `<tr class="click ${t.step === i ? 'sel' : ''}" data-s="${t.step}"><td class="mono">${t.step}</td><td class="mono">${esc(t.state)}</td><td class="mono">${t.head}</td><td class="mono">${esc(t.read)}</td><td class="mono">${esc(t.write)}</td><td class="mono">${t.direction}</td><td class="mono">${esc(t.nextState)}</td></tr>`).join('')}</table></div></div>`;
  };
  bg.onclick = (ev) => {
    const x = ev.target.closest('[data-x]')?.dataset.x; const s = ev.target.closest('[data-s]')?.dataset.s;
    if (ev.target === bg || x === 'close') { stop(); bg.remove(); return; }
    if (s) { stop(); i = Number(s); }
    if (x === 'first') { stop(); i = 0; } if (x === 'last') { stop(); i = e.trace.length; }
    if (x === 'prev') { stop(); i = Math.max(0, i - 1); } if (x === 'next') { stop(); i = Math.min(e.trace.length, i + 1); }
    if (x === 'play') {
      if (timer) stop();
      else { if (i >= e.trace.length) i = 0; timer = setInterval(() => { if (!document.body.contains(bg) || i >= e.trace.length) { stop(); render(); return; } i += 1; render(); }, 250); }
    }
    render();
  };
  render();
}

// ----- Analytics -----
pages.analytics = async (el) => {
  const a = await api('GET', '/analytics');
  const n = a.totalExecutions;
  const seg = [['ACCEPTED', a.accepted, 'var(--ok)'], ['REJECTED', a.rejected, 'var(--bad)'], ['HALTED', a.halted, 'var(--warn)'], ['LOOP_DETECTED', a.loopDetected, 'var(--violet)'], ['STEP_LIMIT', a.stepLimit, 'var(--muted)']];
  const maxDay = Math.max(1, ...a.trend.map((d) => d.executions));
  el.innerHTML = `<header class="top"><div><h1>Analytics</h1><div class="sub">Computed live from persisted executions.</div></div></header>
  ${n === 0 ? '<div class="card empty">No executions recorded yet — run machines in the simulator to populate analytics.</div>' : `
  <div class="grid g4">${[['Total executions', n], ['Accepted', a.accepted], ['Rejected', a.rejected], ['Average steps', a.averageSteps.toFixed(1)], ['Max steps', a.maxSteps], ['Avg tape cells used', a.averageTapeUtilization.toFixed(1)], ['Max tape cells used', a.maxTapeUtilization], ['Halted / loop / limit', `${a.halted} / ${a.loopDetected} / ${a.stepLimit}`]].map(([l, v]) => `<div class="card stat"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('')}</div>
  <div class="grid g2" style="margin-top:14px">
    <div class="card"><h2>Outcome distribution</h2><div class="bar" style="height:16px">${seg.map(([, v, c]) => (v ? `<span style="width:${(v / n) * 100}%;background:${c}"></span>` : '')).join('')}</div>
      <div style="margin-top:10px">${seg.map(([l, v, c]) => `<div class="row" style="justify-content:space-between"><span><span style="color:${c}">●</span> ${l}</span><span class="mono">${v} (${((v / n) * 100).toFixed(0)}%)</span></div>`).join('')}</div></div>
    <div class="card"><h2>Execution trend (per day)</h2><div style="display:flex;align-items:flex-end;gap:6px;height:170px;border-bottom:1px solid var(--border)">
      ${a.trend.map((d) => `<div title="${d.date}: ${d.executions} (${d.accepted} accepted, ${d.rejected} rejected)" style="flex:1;max-width:48px;display:flex;flex-direction:column-reverse;height:${(d.executions / maxDay) * 100}%">
        <span style="flex:${d.accepted};background:var(--ok)"></span><span style="flex:${d.rejected};background:var(--bad)"></span><span style="flex:${d.other};background:var(--warn)"></span></div>`).join('')}</div>
      <div style="display:flex;gap:6px;font-size:10px" class="muted">${a.trend.map((d) => `<div style="flex:1;max-width:48px;text-align:center">${d.date.slice(5)}</div>`).join('')}</div></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>Per-machine statistics</h2><table><tr><th>Machine</th><th>Executions</th><th>Accepted</th><th>Rejected</th><th>Avg steps</th><th>Max steps</th><th>Acceptance rate</th></tr>
    ${a.perMachine.map((p) => `<tr class="click" data-m="${esc(p.machine)}"><td>${esc(p.machine)}</td><td class="mono">${p.executions}</td><td class="mono">${p.accepted}</td><td class="mono">${p.rejected}</td><td class="mono">${p.averageSteps.toFixed(1)}</td><td class="mono">${p.maxSteps}</td>
    <td style="width:180px"><div class="bar"><span style="width:${(p.accepted / p.executions) * 100}%;background:var(--ok)"></span></div></td></tr>`).join('')}</table></div>`}`;
  el.querySelectorAll('[data-m]').forEach((r) => { r.onclick = () => { location.hash = `#/history?machine=${encodeURIComponent(r.dataset.m)}`; }; });
};

// ----- Learning center -----
pages.learn = async (el) => {
  const tps = await api('GET', '/templates');
  const link = (k, label) => `<a href="#/simulator?template=${k}&input=${encodeURIComponent(tps.find((t) => t.key === k).samples[0].input)}">${label}</a>`;
  el.innerHTML = `<header class="top"><div><h1>Learning Center</h1><div class="sub">Theory, guided examples, glossary and viva preparation.</div></div></header>
  <div class="grid g2 prose">
  <div class="card"><h2>What is a Turing Machine?</h2><p>A Turing Machine is an abstract model of computation: a finite control (states) attached to a head reading and writing an unbounded tape. Despite its simplicity, it can compute anything any modern computer can (Church–Turing thesis).</p>
  <h3>The formal 7-tuple</h3><p class="mono">M = (Q, Σ, Γ, δ, q₀, q_accept, q_reject)</p><ul>
  <li><b>Q</b> — finite set of states.</li><li><b>Σ</b> — input alphabet; must not contain the blank.</li><li><b>Γ</b> — tape alphabet; Σ ⊆ Γ and the blank ∈ Γ.</li>
  <li><b>δ</b> — transition function Q × Γ → Q × Γ × {L, R, S}.</li><li><b>q₀</b> — initial state.</li><li><b>q_accept, q_reject</b> — distinct halting states.</li></ul></div>
  <div class="card"><h2>Transition function</h2><p><code>δ(q, a) = (p, b, D)</code> means: in state <code>q</code> reading <code>a</code>, write <code>b</code>, move the head in direction <code>D</code> (LEFT, RIGHT or STAY), then enter state <code>p</code>.</p>
  <p>The tape is infinite in both directions; every cell not yet written holds the <b>blank symbol</b>. TuringLab stores the tape sparsely, so only non-blank cells consume memory and negative positions work naturally.</p>
  <h3>Determinism & halting</h3><p>A machine is deterministic when every (state, symbol) pair has at most one transition — TuringLab rejects definitions that violate this. A computation <b>accepts</b> on entering q_accept, <b>rejects</b> on q_reject, and <b>halts</b> (without decision) if no transition applies. It may also run forever: TuringLab reports <b>LOOP_DETECTED</b> when an entire configuration (state, head, tape) repeats, and <b>STEP_LIMIT</b> when the configured bound is reached. By the halting problem, no algorithm can detect every non-halting run.</p></div>
  <div class="card"><h2>Guided examples</h2><ol>
  <li>${link('even-ones', 'Even number of 1s')} — a TM that only moves right behaves like a DFA. Watch the parity state flip on each 1.</li>
  <li>${link('binary-incrementer', 'Binary incrementer')} — scan to the end, then propagate a carry left. Try <code>111</code> to see the tape grow into position −1.</li>
  <li>${link('palindrome-checker', 'Palindrome checker')} — the machine "remembers" one symbol in its state and zig-zags across the tape: O(n²) steps.</li>
  <li>${link('unary-addition', 'Unary addition')}, ${link('binary-subtractor', 'binary subtraction')} and ${link('string-reversal', 'string reversal')} — TMs as transducers computing functions.</li></ol></div>
  <div class="card"><h2>Glossary</h2><div class="kv">
  <div>Configuration</div><div>Snapshot of state, head position and tape contents.</div><div>Blank (_)</div><div>Symbol filling every unwritten tape cell.</div>
  <div>Decider</div><div>A TM that halts on every input.</div><div>Recognizer</div><div>A TM that accepts exactly the strings of a language (may loop otherwise).</div>
  <div>Turing-recognizable</div><div>Language accepted by some TM.</div><div>Decidable</div><div>Language decided by some TM that always halts.</div>
  <div>Universal TM</div><div>A TM that simulates any TM given its encoding.</div></div></div>
  <div class="card" style="grid-column:1/-1"><h2>Viva preparation</h2><ol>
  <li><b>Difference between Σ and Γ?</b> Σ is what the input may contain; Γ also includes the blank and any working markers (e.g. X, #).</li>
  <li><b>Why must q_accept ≠ q_reject?</b> Otherwise the machine could not distinguish acceptance from rejection.</li>
  <li><b>What makes a TM more powerful than a PDA?</b> Read/write access to an unbounded tape with bidirectional movement, versus a stack.</li>
  <li><b>Can loops always be detected?</b> No — the halting problem is undecidable. Repeated-configuration detection catches only cycles in finite configuration space.</li>
  <li><b>Is a multi-tape TM more powerful?</b> No; it can be simulated by a single-tape TM with at most quadratic slowdown.</li>
  <li><b>What is the time complexity of the palindrome checker?</b> O(n²) — each pass crosses the remaining input.</li></ol></div>
  </div>`;
};

// ---------- router ----------
async function route() {
  const raw = location.hash.slice(2) || 'dashboard';
  const [pathPart, qs] = raw.split('?');
  const [name, ...params] = pathPart.split('/');
  const page = pages[name] || pages.dashboard;
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === name));
  simLoop = { running: false }; // stop any running simulator loop when navigating
  const view = $('#view');
  view.innerHTML = '<div class="empty">Loading…</div>';
  try { await page(view, params, new URLSearchParams(qs || '')); } catch (e) {
    view.innerHTML = `<div class="card errors"><b>Could not load this page.</b><div>${esc(e.message)}</div><button onclick="location.reload()" style="margin-top:8px">Retry</button></div>`;
  }
}
window.addEventListener('hashchange', route);

try { const t = localStorage.getItem('tl-theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* storage unavailable */ }
$('#themeBtn').onclick = () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('tl-theme', t); } catch { /* ignore */ }
};
route();
