#!/usr/bin/env npx tsx
// scripts/publish-naver-blog.ts — 호환용 진입점. 실제 구현은 scripts/naver-blog/ (claim-v1 작업자)
//   main.ts(진입) · api-client.ts(서버 API) · flow.ts(claim 처리 규칙) · login.ts(세션)
//   publish.ts(발행) · editor*.ts(SE 에디터 입력) · screenshot.ts · config.ts
// 실행: npx tsx scripts/naver-blog/main.ts [--dry-run]
import './naver-blog/main';
