# Fired Up Pizza: guide for coding agents

Online ordering and staff order management for one pizza restaurant: an npm-workspaces monorepo with `client/` (React 18 + Vite + Tailwind), `server/` (Express 5 + SQLite via `better-sqlite3`), and `shared/` (TypeScript domain types and pure rules).

Read before changing code:

1. Your bead (`gc bd show <id>`), including its Design section, which lists the files you own.
2. [docs/decision-records/](docs/decision-records/): binding ADRs. The architect rejects branches that break them.
3. [docs/current/architecture.md](docs/current/architecture.md): module map and which bead owns what.
4. [docs/PROJECT_MANIFEST.md](docs/PROJECT_MANIFEST.md): domain model, constraints, review standards.

## Setup

```bash
npm install   # needed once in a fresh worktree
```

Node 22.22.2+ on 22.x, 24.15+ on 24.x, or 26+ (`engines` in `package.json`; `.nvmrc` pins 24). `.npmrc` disables dependency install scripts on purpose (ADR 0001 rule 9). Do not approve or re-enable them.

## Quality Gates

Every command must pass from the repository root before you submit:

```bash
npm run lint       # ESLint (type-aware, zero warnings) + Prettier check
npm run typecheck  # tsc --noEmit for the tooling configs and every workspace
npm test           # Vitest projects: shared, server, client
npm run build      # typecheck + client production build
```

`npm run format` fixes Prettier failures.

## Rules

- **Scope:** change only the files your bead lists. Router mounts (`server/src/app.ts`, `server/src/routes/staff/index.ts`), the route table (`client/src/App.tsx`), and the provider list (`client/src/AppProviders.tsx`) are pre-wired. Fill in your stub rather than editing a registry (ADR 0001 rule 10).
- **Shared types:** import domain types from `@fired-up-pizza/shared`. Add new shared modules as `shared/src/<name>.ts` and import them as `@fired-up-pizza/shared/<name>`. Never redeclare a domain type.
- **SQL** lives only in `server/src/db/` and `server/src/repositories/`, as prepared statements with bound parameters (ADR 0002).
- **Money** is integer cents. The server recomputes prices, and reads use the snapshot columns (ADR 0003).
- **Order status** changes only through `server/src/services/order-status.ts` (ADR 0004).
- **Phone numbers** are parsed only by `shared/src/phone.ts` and `server/src/identity/`, and never logged (ADR 0005).
- **API:**
  - Throw `AppError` (`server/src/http/errors.ts`) and validate with `parseWith` (`server/src/http/validate.ts`).
  - Staff endpoints live under `/api/staff`.
  - Routers are factories taking `{ db }` (ADR 0006).
- **Client:**
  - Hooks + Context only; HTTP only through `client/src/api/`.
  - Poll at 15 s or faster.
  - Every view has loading, empty, error, and stale states.
  - Style with Tailwind utilities only (ADR 0007).
- **Never add** WebSockets/SSE, payments, auth providers, external services, component libraries, or state managers. A new runtime dependency needs a justification in the commit body.
- **Commits:** Conventional Commits with the bead id in the subject, e.g. `feat(server): add catalog routes (fup-oe9.1)`, and a body explaining why.

## Testing notes

- Tests are co-located as `*.test.ts(x)`. Vitest globals are off, so import `describe`/`it`/`expect` from `vitest`.
- Server: `request(createApp({ db }))` with supertest against an in-memory database. Never use the real database file.
- Client: Testing Library with a mocked `fetch`. Render through `renderWithProviders` / `renderApp` from `client/src/test/render.tsx` so providers match `main.tsx`.
- ESLint is type-aware: no floating promises, and no unsafe `any` in production code. Test files relax the `no-unsafe-*` rules for untyped JSON.
- `eslint-plugin-react-hooks` v7 flags synchronous `setState` inside effects. Derive state, or set it from async callbacks.
