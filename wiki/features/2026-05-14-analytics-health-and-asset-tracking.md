# 분석 헬스체크와 자산 추적 패키지

## 목적

- GA4 데이터가 `0`으로 보일 때 단순 조회 실패인지, 실제 수집 중단인지 바로 구분하게 한다.
- 콘텐츠 내보내기 결과에 채널별 UTM 추적 링크를 포함해 성과를 자산 단위로 다시 연결할 기반을 만든다.

## 배경

- 루트 `/`를 분석 대시보드로 전환한 뒤 `vestra` 소스가 정상 응답인데도 최근 데이터가 `0`으로 보이는 문제가 있었다.
- 이 상태에서는 운영자가 `GA4 API 문제`, `OAuth 문제`, `태그 미수집`, `도메인/속성 불일치`를 화면에서 구분할 수 없었다.
- 기존 내보내기 구조는 HTML/TXT/JSON만 제공했고, 채널별 CTA 링크 추적 패키지가 없었다.

## 이번 구현 범위

### 1. GA4 헬스체크 API

- 새 API
  - `GET /api/analytics/health`
- 구현 위치
  - `app/api/analytics/health/route.ts`
  - `lib/ga4.ts`
- 반환 내용
  - 소스별 설정 여부
  - property ID
  - 최근 7일 사용자/세션/뷰 요약
  - 상태
    - `healthy`
    - `no-data`
    - `error`
    - `not-configured`
  - 운영자가 바로 볼 수 있는 이슈 문구

### 2. 분석 대시보드 상태 카드

- 구현 위치
  - `features/analytics/analytics-dashboard.tsx`
  - `app/globals.css`
- 추가된 요소
  - 소스별 상태 카드
  - 선택 소스의 경고 카드
  - 미설정 소스 비활성화
- 의도
  - 조회값 표만 보는 화면이 아니라, `수집 신뢰성`을 먼저 확인하는 화면으로 만든다.

### 3. 자산 추적 링크 패키지

- 구현 위치
  - `lib/content-tracking.ts`
  - `server/services/project-service.ts`
  - `features/dashboard/types.ts`
  - `features/pipeline/types.ts`
- 내보내기 결과에 추가된 값
  - `baseUrl`
  - `trackedUrl`
  - `utm_source`
  - `utm_medium`
  - `utm_campaign`
  - `utm_content`
- 생성 규칙
  - 프로젝트 도메인이 있으면 채널별 UTM 링크를 자동 생성한다.
  - 도메인이 없으면 링크 대신 운영 메모를 반환한다.

### 4. 발행 준비 화면 보강

- 구현 위치
  - `features/dashboard/publish-panel.tsx`
  - `features/dashboard/use-publish-workflow.ts`
  - `features/dashboard/content-studio.tsx`
  - `features/dashboard/dashboard-shell.tsx`
- 추가된 기능
  - 현재 채널의 추적 링크 표시
  - 추적 링크 클립보드 복사
  - UTM 메타값 확인

## 기대 효과

- 운영자는 `데이터가 없는 이유`를 조회 화면에서 바로 추정할 수 있다.
- 추적 링크를 수동으로 붙이는 작업을 줄이고, 자산별 성과 연결을 위한 최소 규격을 확보한다.
- 이후 전환 이벤트, CTA 클릭, 자산별 성과 리포트로 확장하기 쉬운 형태가 된다.

## 후속 권장 작업

1. 자산별 `utm_content`와 실제 전환 이벤트를 연결한 성과 리포트 추가
2. published URL 기준의 실측 페이지 성과 연결
3. `trackedUrl`이 실제 CTA에 반영됐는지 검수 단계에서 확인하는 체크 추가
4. 소스별 `realtime/recent heartbeat` 감지와 알림 추가

## 검증

- `m-master`에서 `npm run build` 성공
- 라우트 목록에 `GET /api/analytics/health` 추가 확인
- 내보내기 타입 확장 이후 대시보드/파이프라인 빌드 정상 확인
