# Meeting source

An isolated source checkout for CI and development testing. It contains the Meeting routes, APIs, processing modules, and the shared files those modules import. The app shell and database schema are limited to Meeting needs.

## Local checks

- `pnpm install`
- `pnpm prisma:validate`
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`

Set `DATABASE_URL` for commands that need Prisma configuration. Do not add production credentials to this repository. CI validates and builds only; it does not deploy.
