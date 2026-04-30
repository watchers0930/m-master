# Backend MVP API Design

## 주제

1차 웹 MVP 백엔드 API와 deterministic service 설계

## 목적

프론트 구현 전에 프로젝트 생성, 조회, 스튜디오 초기 진입 데이터를 안정적으로 제공할 서버 계약을 고정한다.

## 구현 범위

- `POST /api/projects`
- `POST /api/projects/context-preview`
- `GET /api/projects`
- `GET /api/projects/:projectId`
- `GET /api/projects/:projectId/studio`
- deterministic context draft service
- deterministic topic recommendation service
- deterministic studio seed service

## 설계 판단

- `workingPath`는 저장하되, 실제 분석 입력은 클라이언트가 전달한 `sourceFiles` 메타데이터와 excerpt를 사용한다.
- 프로젝트 생성 시 브랜드 프로필 초안과 주제 추천을 함께 만든다.
- 주제 추천은 AI 호출 없이 동일 입력에서 동일 결과가 나오게 고정 템플릿으로 만든다.
- 브라우저 File System Access API 또는 업로드 흐름은 프론트가 파일 메타와 텍스트 excerpt를 수집해 서버로 전달하는 구조를 전제로 한다.
- 스튜디오 진입 데이터는 DB에 새 콘텐츠를 쓰지 않고, 최신 브랜드 프로필과 상위 주제로 즉시 계산한다.
- Route Handler는 얇게 유지하고, 검증과 비즈니스 로직은 `server/`로 내린다.

## 응답 구조 원칙

- 모든 응답은 `{ ok, data | error }` 형태를 유지한다.
- 목록 응답은 카드형 요약 정보를 우선 제공한다.
- 상세 응답은 프로젝트, 최신 브랜드 프로필, 추천 주제를 함께 제공한다.
- 스튜디오 응답은 선택된 주제와 채널별 초안 자산을 함께 제공한다.

## 후속 확장 포인트

- source ingestion 연동 시 context draft 생성기를 실제 분석 결과 기반으로 교체
- topic score에 검색량/경쟁도/시즌성 필드 추가
- studio draft를 실제 `ContentJob`/`ContentAsset` 버전 데이터로 승격
