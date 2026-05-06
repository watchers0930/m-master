# m-master

Context-aware marketing platform.

## Core Rules

- 개발 절대규칙: [DEVELOPMENT_RULES.md](/Users/watchers/Desktop/m-master/DEVELOPMENT_RULES.md)
- 구현 규칙: [IMPLEMENTATION_RULES.md](/Users/watchers/Desktop/m-master/IMPLEMENTATION_RULES.md)
- 검증 규칙: [VERIFICATION_RULES.md](/Users/watchers/Desktop/m-master/VERIFICATION_RULES.md)
- 위키 작업 시스템: [wiki/README.md](/Users/watchers/Desktop/m-master/wiki/README.md)

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

## Image generation

- `OPENAI_API_KEY`: enables GPT image generation for the image studio
- `OPENAI_TEXT_MODEL`: optional override for GPT draft generation, defaults to `gpt-5.4-mini`
- `OPENAI_IMAGE_MODEL`: optional override, defaults to `gpt-image-1-mini`
- cost-optimized default: `low` quality and `1` variant per request
- if the API key is missing or the OpenAI request fails, the app falls back to the built-in SVG generator
- channel draft generation also uses the same `OPENAI_API_KEY`; if the request fails, it falls back to the built-in rule-based draft generator
