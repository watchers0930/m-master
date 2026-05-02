# 컨텍스트 초안 및 승인

## 목적

프로젝트 입력과 브라우저 폴더에서 추출한 source payload를 바탕으로 브랜드 컨텍스트 초안을 보여주고, 사용자가 보정 후 승인하게 만들어 이후 주제 추천과 콘텐츠 생성의 기준을 고정한다.

## 사용자 흐름

1. 프로젝트 생성 직후 사용자가 컨텍스트 단계에 진입한다.
2. 클라이언트가 폴더에서 추출한 파일 목록과 텍스트 payload를 서버로 전달한다.
3. 시스템이 `BrandProfile` 초안을 생성한다.
4. 사용자는 `서비스 요약`, `타겟`, `톤`, `CTA`, `금지 표현`과 `참조 파일 목록`을 함께 검토한다.
5. 사용자는 틀린 필드만 수정한다.
6. 사용자가 `승인`을 누른다.
7. 시스템이 해당 버전의 `BrandProfile.approved=true`, `approvedAt`을 기록한다.
8. 승인 후 추천 주제 단계가 열린다.

## 입력

- 프로젝트 기본 정보
  - `name`
  - `domain`
  - `workingPath`
- source payload
  - `sourceFiles[]`
  - `extractedText[]` 또는 합쳐진 draft input
- 사용자 수정값
  - `summary`
  - `audience`
  - `tone`
  - `cta`
  - `bannedTerms`

## 출력

- 승인 가능한 `BrandProfile` 초안
- 초안 생성에 사용된 파일 요약 목록
- 승인 완료된 `BrandProfile` 버전
- 다음 단계용 `projectId`, `brandProfileVersion`

## 주요 상태

- `draft-loading`
  - 초안 생성 중
- `source-review`
  - 추출 파일과 제외 파일 확인 중
- `draft-ready`
  - 사용자 검토 가능
- `editing`
  - 일부 필드 수정 중
- `approval-pending`
  - 승인 요청 중
- `approved`
  - 주제 단계 진입 가능
- `draft-failed`
  - 초안 생성 실패

## 예외 케이스

- 추출 파일이 0건
  - 도메인과 프로젝트명만으로 약한 초안 생성 또는 수동 입력 전환
- 초안 생성 실패
  - 추출 텍스트 일부를 유지한 채 재시도 버튼 제공
- `summary`가 너무 짧거나 비어 있음
  - 승인 차단
- `bannedTerms`가 비어 있음
  - 승인 허용 가능
  - 다만 비어 있음을 명시해야 한다
- 승인 후 다시 수정하고 싶음
  - 1차는 `재편집 -> 재승인` 흐름 허용
- 아직 승인되지 않았는데 URL로 다음 단계 직접 접근
  - 서버와 프론트 모두 차단 필요

## 관련 화면

- `컨텍스트 분석`
- `컨텍스트 승인`

## 관련 API/서비스

- `POST /api/projects/:id/context/analyze`
- `PATCH /api/projects/:id/brand-profile`
- 제안 서비스
  - `buildBrandProfileDraft(projectId, sourcePayload)`
  - `approveBrandProfile(projectId, payload)`

## 관련 데이터 모델

- `BrandProfile`
- 연관 참조
  - `Project`

## 구현 메모

- 1차에서는 브라우저 추출 텍스트와 도메인 입력을 합쳐 deterministic draft를 생성한다.
- 초안 화면은 `어떤 파일을 참고했는지`를 보여줘야 사용자가 신뢰하고 수정할 수 있다.
- Step 2 승인 패널에는 최소한 `상위 참조 파일`, `키워드 힌트`, `excerpt digest`가 함께 보여야 한다.
- 승인 전에는 `주제`, `생성`, `검수` 탭을 읽기 전용 또는 비활성 상태로 유지한다.

## 검증 방법

- 초안이 생성되면 필수 필드가 모두 채워져 보이는지 확인
- 참조 파일 목록과 제외 파일 목록이 사용자에게 보이는지 확인
- 수정 후 새 값이 저장되고 승인 상태가 바뀌는지 확인
- 승인 전에는 주제 단계 접근이 차단되는지 확인
- 승인 후에는 추천 주제가 해당 프로필 기준으로 조회되는지 확인
- 초안 실패 시 재시도 또는 폴백 안내가 있는지 확인
