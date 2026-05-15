# 커스텀 방문자 추적 소스 추가

## 목적

- 고정된 `m-master`, `vestra` 외에도 다른 프로젝트의 방문 집계를 대시보드에서 직접 추가하게 한다.

## 구현

- 분석 대시보드에 `방문자 추적 추가` 버튼과 모달 추가
- 브라우저 로컬 저장소에 커스텀 소스 저장
- 새 API
  - `POST /api/analytics/external-overview`
- 지원 입력 형식
  - 공개 집계 URL
  - JSON 키
    - `label`
    - `endpointUrl`
    - `accessKey` 선택

## 동작

- 저장 시 즉시 외부 집계 엔드포인트를 검증한다.
- 검증이 성공하면 소스 토글에 추가된다.
- 커스텀 소스는 서버 프록시를 통해 조회하므로 브라우저 CORS 제약을 줄인다.

## 응답 규격

- 외부 프로젝트는 다음 둘 중 하나를 반환하면 된다.
  - `m-master`의 GA4 overview 형태
  - `vestra` 공개 집계와 같은 first-party overview 형태
