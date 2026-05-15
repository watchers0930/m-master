# vestra 1차 방문 집계 폴백

## 목적

- `vestra`의 GA4 속성이 비어 있을 때도 `m-master` 마케팅 대시보드에서 실제 방문 추이를 확인하게 한다.

## 구현

- `vestra`
  - `GET /api/public/analytics/overview`
  - `AnalyticsEvent` 테이블의 `page_view`, `page_leave`를 집계해 공개용 요약 데이터 반환
- `m-master`
  - `source=vestra` 조회 시 GA4 세션/뷰가 모두 `0`이면 위 공개 집계를 자동 사용
  - 화면 노트에 `자체 수집 집계 대체 표시` 문구 추가

## 이유

- 현재 `vestra`는 자체 이벤트 저장은 정상인데 GA4 속성 집계가 `0`으로 보인다.
- 운영 판단에는 “실제 방문 추이”가 우선이므로 GA4 복구 전에도 대시보드 공백을 없애야 한다.

## 검증 포인트

- `vestra` 공개 집계 API 응답
- `m-master /api/analytics/overview?source=vestra` 응답이 `provider=first-party`로 전환되는지
- 빌드 성공 여부
