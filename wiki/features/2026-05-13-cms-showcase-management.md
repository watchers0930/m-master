# CMS Showcase Management

## 목적

- `플랫폼개발`
- `주요실적`

두 섹션을 운영자가 관리자 화면에서 직접 관리하고, 공개 페이지는 같은 데이터를 읽어 렌더링하게 한다.

## 범위

- Prisma에 `CmsSection`, `CmsItem` 추가
- `server/repositories`, `server/services`, `server/validators`로 CMS 계층 분리
- `/cms` 관리자 화면 추가
- `/` 공개 페이지를 CMS 데이터 기반 렌더링으로 전환
- 기존 생성 파이프라인은 `/studio`로 유지

## 데이터 모델

### CmsSection

- `key`
- `title`
- `description`
- `visible`
- `sortOrder`

### CmsItem

- `slug`
- `title`
- `subtitle`
- `clientName`
- `periodLabel`
- `summary`
- `body`
- `tags`
- `imageUrl`
- `linkUrl`
- `status`
- `featured`
- `visible`
- `sortOrder`

## 관리자 구조

- 좌측
  - 섹션 목록
- 우측
  - 섹션 설정
  - 항목 목록
  - 항목 편집기

질문 없이 바로 운영할 수 있게 `플랫폼개발`, `주요실적` 기본 섹션을 자동 부트스트랩한다.

## 구현 판단

- 기존 `PipelineShell`은 유지해야 해서 삭제하지 않고 `/studio`로 이동
- 홈(`/`)은 CMS 공개 페이지로 교체
- 인증 체계가 아직 없어서 이번 단계는 내부 운영 도구 기준의 무인증 관리자 화면으로 둔다
- `tags`는 빠른 운영을 위해 쉼표 문자열로 저장하고, 렌더링 시 배열로 변환한다

## 검증 계획

- `prisma db push`
- `npm run build`
- `/` 공개 페이지 렌더링 확인
- `/cms`에서 섹션/항목 생성 및 수정 확인
- `/studio` 기존 파이프라인 진입 확인
