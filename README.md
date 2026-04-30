# m-master

Context-aware marketing platform.

## Deployment workflow

- `test` branch: all routine development goes here
- `production` branch: production deployment branch, update only by explicit promotion

## Vercel strategy

- Git pushes to `test` should create preview deployments
- Git pushes to `production` should create production deployments
- Local CLI direct deploys should be avoided after Git integration is completed

## Database

- Separate Neon database for `m-master`
- Prisma uses:
  - `DATABASE_URL` for application queries
  - `DIRECT_URL` for schema operations
