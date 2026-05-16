# Monorepo

TypeScript monorepo powered by pnpm workspaces and Turborepo.

## Layout

```
apps/
  web/        Next.js application
  api/        Hono HTTP API
packages/
  ui/         Shared React components
  types/      Shared TypeScript types
  tsconfig/   Shared tsconfig presets
  eslint-config/  Shared ESLint config
```

## Getting started

```bash
pnpm install
pnpm dev        # run all apps
pnpm build      # build everything
pnpm typecheck  # typecheck everything
pnpm lint       # lint everything
pnpm test       # run all tests
```

## Adding a new app or package

1. Create a directory under `apps/` or `packages/`.
2. Add a `package.json` with a name like `@repo/<name>`.
3. `pnpm install` from the root to wire workspace links.
