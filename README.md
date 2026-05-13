# m-master

Context-aware marketing platform.

## Core Rules

- 개발 절대규칙: [DEVELOPMENT_RULES.md](/Users/watchers/Desktop/m-master/DEVELOPMENT_RULES.md)
- 구현 규칙: [IMPLEMENTATION_RULES.md](/Users/watchers/Desktop/m-master/IMPLEMENTATION_RULES.md)
- 검증 규칙: [VERIFICATION_RULES.md](/Users/watchers/Desktop/m-master/VERIFICATION_RULES.md)
- 위키 작업 시스템: [wiki/README.md](/Users/watchers/Desktop/m-master/wiki/README.md)

## Deployment workflow

- `production` branch: all routine development and deployment happen here

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

1. Work only on `production`
2. Run local verification: at minimum `npm run build`
3. Push `production`
4. Wait for the GitHub Actions production deploy
5. Verify `m-master.vercel.app`

### If production promotion is not clean

- Do not force-push `production`
- If a direct `production` push is blocked by branch protection or branch divergence, create a temporary alignment branch from the latest `origin/production`
- Apply the verified content onto that branch
- Open a clean PR from the alignment branch into `production`
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
