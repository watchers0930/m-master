# m-master

Context-aware marketing platform.

## Deployment workflow

- `test` branch: all routine development goes here
- `production` branch: production deployment branch, update only by explicit promotion

## GitHub Actions deployment

- pushes to `test` deploy to the Vercel preview target and rebind `tm-master.vercel.app`
- pushes to `production` deploy to the Vercel production target and rebind `m-master.vercel.app`
- Vercel Git auto-deploy should stay disabled to avoid duplicate deployments

### Required repository secret

- `VERCEL_TOKEN`: token that can deploy and manage aliases for the `watchers0930s-projects/m-master` Vercel project

## Vercel strategy

- GitHub Actions is the deployment entry point
- local CLI direct deploys should be avoided except for emergency maintenance
- `tm-master.vercel.app` is the fixed test domain
- `m-master.vercel.app` is the fixed production domain

## Database

- Separate Neon database for `m-master`
- Prisma uses:
  - `DATABASE_URL` for application queries
  - `DIRECT_URL` for schema operations
