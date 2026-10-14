# Fired Up Pizza

Online ordering and order management for a neighborhood pizza restaurant. Customers order pizzas customized by size, crust, and toppings using only their phone number, pay at the counter, and track their order. Staff run a live kitchen queue and manage the menu. It runs on a single machine with SQLite and no third-party services.

> **Status:** project scaffold. The app shells, tooling, and API skeleton are in place. Features land through the beads listed in [docs/current/architecture.md](docs/current/architecture.md#work-breakdown).

## Quick start

Requires Node.js 22.12 or newer (24 recommended; see `.nvmrc`).

```bash
npm install
npm run dev
```

| What            | URL                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------- |
| Customer site   | http://localhost:5173                                                                              |
| Staff dashboard | http://localhost:5173/staff                                                                        |
| API health      | http://localhost:5173/api/health (proxied to the API on [:3001](http://localhost:3001/api/health)) |

The SQLite database is created automatically at `server/data/fired-up-pizza.sqlite` (gitignored).

## Scripts

Run from the repository root.

| Command              | What it does                                                  |
| -------------------- | ------------------------------------------------------------- |
| `npm run dev`        | Starts the API (`tsx watch`) and the Vite dev server together |
| `npm test`           | Runs all Vitest projects: `shared`, `server`, `client`        |
| `npm run test:watch` | Vitest in watch mode                                          |
| `npm run lint`       | ESLint (zero warnings) plus Prettier check                    |
| `npm run format`     | Rewrites files with Prettier                                  |
| `npm run typecheck`  | `tsc --noEmit` for the tooling configs and every workspace    |
| `npm run build`      | Typecheck plus the client production build (`client/dist/`)   |

## Configuration

Everything has a default. Set these only to override:

| Variable           | Default                             | Used by                   |
| ------------------ | ----------------------------------- | ------------------------- |
| `PORT`             | `3001`                              | API server                |
| `DATABASE_PATH`    | `server/data/fired-up-pizza.sqlite` | API server                |
| `API_PROXY_TARGET` | `http://localhost:3001`             | Vite dev proxy for `/api` |

## Project layout

```
client/   React 18 + Vite + Tailwind: customer pages and /staff dashboard
server/   Express 5 REST API under /api, SQLite via better-sqlite3
shared/   TypeScript domain types and pure rules used by both sides
docs/     Product manifests, decision records, current architecture
```

## Documentation

- [Project overview](docs/PROJECT_OVERVIEW.md) and [project manifest](docs/PROJECT_MANIFEST.md): what we're building, the domain model, constraints, review standards, and release criteria.
- [Software factory manifest](docs/SOFTWARE_FACTORY_MANIFEST.md): how the factory is meant to run.
- [Decision records](docs/decision-records/): binding architecture decisions (ADRs).
- [Current architecture](docs/current/architecture.md): module map, implementation state, work breakdown.
- [CLAUDE.md](CLAUDE.md): working rules and quality gates for coding agents.

## Troubleshooting

- **`npm install` and native modules:** `better-sqlite3` ships prebuilt binaries for macOS, Windows, and Linux (x64 and arm64), and `.npmrc` sets `ignore-scripts=true`, so no compiler is needed. On any other platform, build it from source with `(cd node_modules/better-sqlite3 && npx node-gyp rebuild --release)` (requires Python and a C++ toolchain).
- **Port already in use:** set `PORT` for the API. Vite picks the next free port and prints it.
