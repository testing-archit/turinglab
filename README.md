# TuringLab

Interactive platform for designing, simulating and visualizing **deterministic single-tape Turing Machines**
`M = (Q, Σ, Γ, δ, q0, q_accept, q_reject)`, with `δ(q, a) = (p, b, D)`, `D ∈ {L, R, S}`.

> Built for speed as a Node.js app (Express backend + dependency-free SPA). The engine, API and persistence
> layers are separated so the backend can later be swapped for Spring Boot/PostgreSQL behind the same REST API.

## Quick start
```bash
npm install
npm start            # http://localhost:8080
npm test             # engine + template + REST integration tests (node:test)
```
Docker: `docker compose up --build` → http://localhost:8080 (data persisted in the `turinglab-data` volume).

## Features
- **Dashboard** – real counts of machines/executions/accepted/rejected, recent items, quick-start templates.
- **Machine Designer** – define Σ, Γ, blank, states (add/rename/delete), initial/accept/reject, transitions (form with validation, determinism check); draggable SVG state graph; validate, save, edit, delete.
- **Simulator** – Start / Pause / Resume / Single step / Run to end / Reset / Previous / Next, speed slider, max-step limit, animated tape with head & indices (negative positions), current rule, active state highlighted in graph, full trace; inspecting old steps never alters the live execution.
- **Machine Library** – 6 verified templates (Binary Incrementer, Unary Addition, Palindrome Checker, Binary Subtractor, Even 1s, String Reversal) with formal definition, graph, transition table, samples.
- **Execution History** – filter by machine/result, inspect and replay recorded configurations.
- **Analytics** – totals, acceptance/rejection, avg/max steps, tape utilization, daily trend, per-machine stats — all computed from persisted executions.
- **Learning Center** – 7-tuple, δ, blanks, halting, guided examples, glossary, viva questions.

## Architecture
```
server/engine.js     pure TM engine (no HTTP/persistence): validation, sparse tape (Map<pos,symbol>), step/run,
                     halting (ACCEPTED/REJECTED/HALTED), STEP_LIMIT, LOOP_DETECTED (exact repeated config)
server/templates.js  bundled machines + sample expectations
server/store.js      JSON-file persistence with atomic writes (data/db.json)
server/app.js        REST controllers, DTO shaping, sessions, centralized error handling
public/              SPA (hash router, no build step); all computation is done by the backend
test/                engine, exhaustive template checks, REST integration tests
```
Step order: read → resolve δ → write → move → change state. Missing transition ⇒ `HALTED` (distinct from `REJECTED`).
A blank read is a normal symbol and matched against δ like any other.

## REST API
| Method | Path | Description |
|---|---|---|
| GET/POST | /api/machines | list / create (400 with `errors[]` if invalid) |
| GET/PUT/DELETE | /api/machines/{id} | read / update / delete |
| POST | /api/machines/{id}/validate, /api/machines/validate | validate stored / inline machine |
| GET | /api/templates, /api/templates/{key} | bundled machines |
| POST | /api/simulations | `{machineId \| templateKey \| machine, input, maxSteps}` |
| GET | /api/simulations/{id} | current configuration |
| POST | /api/simulations/{id}/step | one transition |
| POST | /api/simulations/{id}/run | `{steps?}` run a bounded chunk / to halt |
| POST | /api/simulations/{id}/pause, /reset | pause flag / restart |
| GET | /api/simulations/{id}/history | initial config + full trace |
| GET | /api/executions?machine=&status=, /api/executions/{id} | persisted history |
| GET | /api/analytics | aggregated statistics |

Errors: `{status, error, message, errors[]}`. Limits: input ≤ 1000 symbols, maxSteps ≤ 50 000.

## Troubleshooting
- Port busy → `PORT=3000 npm start`.
- Reset data → delete `data/db.json`.
