# m-master

Context-aware marketing platform.

## Core Rules

- 개발 절대규칙: [DEVELOPMENT_RULES.md](/Users/watchers/Desktop/m-master/DEVELOPMENT_RULES.md)
- 구현 규칙: [IMPLEMENTATION_RULES.md](/Users/watchers/Desktop/m-master/IMPLEMENTATION_RULES.md)
- 검증 규칙: [VERIFICATION_RULES.md](/Users/watchers/Desktop/m-master/VERIFICATION_RULES.md)
- 위키 작업 시스템: [wiki/README.md](/Users/watchers/Desktop/m-master/wiki/README.md)

## Deployment workflow

- `production` is the only release branch
- routine changes should start from the latest `origin/production` in a short-lived working branch
- deployment happens only after that branch is merged back into `production`

## GitHub Actions deployment

- pushes to `production` deploy to the Vercel production target and rebind `m-master.vercel.app`
- Vercel Git auto-deploy should stay disabled to avoid duplicate deployments

### Required repository secret

- `VERCEL_TOKEN`: token that can deploy and manage aliases for the `watchers0930s-projects/m-master` Vercel project

## Vercel strategy

- GitHub Actions is the deployment entry point
- local CLI direct deploys should be avoided except for emergency maintenance
- `m-master.vercel.app` is the fixed production domain

## CMS routes

- `/`
  - CMS 기반 공개 쇼케이스 페이지
- `/cms`
  - `플랫폼개발`, `주요실적` 관리자 화면
- `/studio`
  - 기존 콘텐츠 생성 파이프라인

## Promotion checklist

1. Create a short-lived branch from the latest `origin/production`
2. Keep the change scoped to one purpose
3. Run local verification: at minimum `npm run build`
4. Open a PR into `production` immediately after verification
5. Merge the PR to trigger the GitHub Actions production deploy
6. Verify `m-master.vercel.app`

### If production promotion is not clean

- Do not force-push `production`
- Do not keep long-lived working branches
- If the branch drifts from `origin/production`, recreate a fresh branch from the latest `origin/production`
- Cherry-pick or re-apply only the verified commits
- Open a clean PR into `production`
- If the production deploy workflow does not auto-start after merge, run `deploy.yml` with `workflow_dispatch` on `production`

## Database

- Separate Neon database for `m-master`
- Prisma uses:
  - `DATABASE_URL` for application queries
  - `DIRECT_URL` for schema operations

## Image generation

- `UNSPLASH_ACCESS_KEY`: if set, the image studio prefers Unsplash hotlinked images
- `OPENAI_API_KEY`: used for text generation and image fallback when Unsplash is unavailable
- `OPENAI_TEXT_MODEL`: optional override for GPT draft generation, defaults to `gpt-5.4-mini`
- `OPENAI_IMAGE_MODEL`: optional override, defaults to `dall-e-3`
- default image path prefers Unsplash and falls back to `dall-e-3`
- if the API key is missing or the OpenAI request fails, the app falls back to the built-in SVG generator
- channel draft generation also uses the same `OPENAI_API_KEY`; if the request fails, it falls back to the built-in rule-based draft generator
