# Fired Up Pizza

Online ordering and order management for a neighborhood pizza restaurant. Customers order pizzas customized by size, crust, and toppings using only their phone number, pay at the counter, and track their order. Staff run a live kitchen queue and manage the menu. It runs on a single machine with SQLite and no third-party services.

> **Status:** MVP complete. Every per-feature success criterion in the [project manifest](docs/PROJECT_MANIFEST.md#success-criteria) is implemented and tested. [docs/current/architecture.md](docs/current/architecture.md) maps the code.

## Features

**Customers** need no account and pay at the counter:

- Browse the available pizzas, grouped by category.
- Build a pizza: size, crust, up to 10 toppings, and a quantity, with a price estimate.
- Review the cart, which the browser keeps across reloads, then place the order with a phone number and optional notes for the kitchen.
- See the confirmation with the prices and total the server charged.
- Track their orders by phone number. The status (placed → preparing → ready → delivered, or cancelled) refreshes every 10 seconds.

**Staff** work under `/staff`:

- The live order queue shows every placed, preparing, and ready order, oldest first, and refreshes every 10 seconds. One click moves an order to its next status. Cancelling is offered only while an order is placed or preparing.
- Menu management creates and edits pizzas and toppings, and hides or shows them. Nothing is deleted, and price changes never alter orders already placed.

The staff pages and the `/api/staff` endpoints have no login yet. Anyone who can reach the app can use them. Access control is planned as one middleware, `server/src/routes/staff/require-staff.ts` (ADR 0006 rule 3). The Vite dev server answers only on localhost, but the API listens on every network interface. Other devices on the network can therefore call `/api/staff` on port 3001 directly (bead `fup-h1d`).

## Quick start

Requires Node.js 22.22.2+ on 22.x, 24.15+ on 24.x, or 26+: the `engines` range in `package.json`. 24 is recommended (see `.nvmrc`).

```bash
npm install
npm run dev
```

`npm run dev` starts the API and the Vite dev server together, and Ctrl+C stops both. The first start creates the SQLite database at `server/data/fired-up-pizza.sqlite` (gitignored), applies the migrations, and seeds a starter menu. Later starts keep the data.

| Page                  | URL                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Menu                  | http://localhost:5173/                                                                            |
| Pizza builder         | http://localhost:5173/menu/1, opened from the menu                                                |
| Cart and checkout     | http://localhost:5173/cart                                                                        |
| Order confirmation    | http://localhost:5173/order-confirmation/1, opened by checkout                                    |
| Order tracking        | http://localhost:5173/track                                                                       |
| Staff order queue     | http://localhost:5173/staff/orders (http://localhost:5173/staff redirects here)                   |
| Staff menu management | http://localhost:5173/staff/menu                                                                  |
| API health            | http://localhost:5173/api/health, proxied to the API on [:3001](http://localhost:3001/api/health) |

## Scripts

Run from the repository root.

| Command                                     | What it does                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `npm run dev`                               | Starts the API (`tsx watch`) and the Vite dev server together                            |
| `npm test`                                  | Runs all Vitest projects: `shared`, `server`, `client`                                   |
| `npm run test:watch`                        | Vitest in watch mode                                                                     |
| `npm run lint`                              | ESLint (zero warnings) plus Prettier check                                               |
| `npm run format`                            | Rewrites files with Prettier                                                             |
| `npm run typecheck`                         | `tsc --noEmit` for the tooling configs and every workspace                               |
| `npm run build`                             | Typecheck plus the client production build (`client/dist/`)                              |
| `npm start -w @fired-up-pizza/server`       | Runs the API alone, without restarting on file changes                                   |
| `npm run preview -w @fired-up-pizza/client` | Serves the production build on http://localhost:4173, proxying `/api` like `npm run dev` |

## Configuration

Everything has a default. Set these only to override:

| Variable           | Default                             | Used by                   |
| ------------------ | ----------------------------------- | ------------------------- |
| `PORT`             | `3001`                              | API server                |
| `DATABASE_PATH`    | `server/data/fired-up-pizza.sqlite` | API server                |
| `API_PROXY_TARGET` | `http://localhost:3001`             | Vite dev proxy for `/api` |

The root scripts run the API from `server/`, so a relative `DATABASE_PATH` is relative to `server/`. Only `server/data/` is gitignored.

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
- [Current architecture](docs/current/architecture.md): module map, request flows, work breakdown.
- [CLAUDE.md](CLAUDE.md): working rules and quality gates for coding agents.

## Troubleshooting

- **`better-sqlite3` and native modules:** `better-sqlite3` ships prebuilt binaries for macOS, Windows, and Linux (glibc and musl), on x64 and arm64. `.npmrc` sets `ignore-scripts=true`, so `npm install` needs no compiler. On any other platform the API stops at startup with `Cannot find module '…/better-sqlite3/build/Release/better_sqlite3.node'`. Build it from source with `(cd node_modules/better-sqlite3 && npx node-gyp rebuild --release)`, which needs Python 3 and a C++20 compiler.
- **Port already in use:** if port 5173 is taken, Vite uses the next free port and prints it. If port 3001 is taken, the API logs `Could not start the API on port 3001: listen EADDRINUSE`, but `npm run dev` keeps running. The client's proxy still sends `/api` to whatever holds port 3001, which may be another copy of this app with its own database. Stop the other process, or move the API and point the proxy at it: `PORT=3002 API_PROXY_TARGET=http://localhost:3002 npm run dev`.
- **Starting over with a fresh database:** stop `npm run dev` and delete `server/data/`. The next start creates, migrates, and seeds a new database. This deletes every order and menu edit.
- **`npm install` reports 2 moderate vulnerabilities:** both are React Router 6 advisories, and no 6.x release fixes them. GHSA-wrjc-x8rr-h8h6 (an open redirect through backslash paths in links) does not apply while the app passes no user-controlled strings to `Link` or `navigate()` (ADR 0007 rule 9). GHSA-337j-9hxr-rhxg affects server-side rendering, which the app does not use. Do not run `npm audit fix --force`: it installs React Router 7, a breaking change. Whether to upgrade is open as bead `fup-hi8`.
