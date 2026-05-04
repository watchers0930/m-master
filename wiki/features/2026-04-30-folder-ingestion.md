# 작업폴더 분석

## 목적

사용자가 브라우저에서 선택한 작업 폴더를 클라이언트에서 안전하게 읽고, 컨텍스트 초안 생성에 필요한 텍스트와 메타데이터를 서버로 전달한다.

## 사용자 흐름

1. 사용자가 프로젝트 생성 화면에서 `작업 폴더 선택` 버튼을 누른다.
2. 브라우저가 폴더 권한 요청을 표시한다.
3. 사용자가 폴더를 선택하면 클라이언트가 하위 파일을 순회한다.
4. 클라이언트가 허용 확장자만 추출한다.
5. 사용자는 추출 성공 파일, 제외 파일, 실패 파일 요약을 본다.
6. 사용자가 프로젝트를 생성하거나 컨텍스트 분석을 시작한다.
7. 클라이언트가 source payload를 서버로 보낸다.
8. 서버가 이 payload를 기반으로 draft 분석을 실행한다.

## 입력

- 브라우저 폴더 권한
- 허용 파일 확장자 목록
  - `txt`
  - `md`
  - `html`
  - `json`
- 파일 크기 제한
  - 구현 시 별도 상수 필요

## 출력

- `workingPath`
  - 선택 폴더 표시 문자열
- `sourceFiles[]`
  - `name`
  - `relativePath`
  - `extension`
  - `size`
  - `status`
- `extractedTextPayload`
  - 서버 draft 분석에 전달할 텍스트 묶음

## 주요 상태

- `unsupported`
  - 브라우저 API 미지원
- `permission-idle`
  - 아직 선택 전
- `permission-denied`
  - 권한 거부
- `reading`
  - 폴더 순회 및 추출 중
- `ready`
  - payload 전송 가능
- `partial-ready`
  - 일부 파일 실패했지만 진행 가능
- `read-failed`
  - 추출 실패

## 예외 케이스

- 브라우저 미지원
  - 수동 입력 fallback 또는 안내 필요
- 권한 거부
  - 재선택 가능해야 한다
- 지원 파일 0개
  - 빈 payload 경고 후 진행 여부 선택
- 일부 파일이 바이너리이거나 너무 큼
  - 제외 목록에 기록
- 동일 이름 파일이 다른 경로에 있음
  - 상대경로까지 함께 저장
- 추출 텍스트 총량이 너무 큼
  - 파일 수 제한, 길이 제한, 요약 전처리 필요

## 관련 화면

- `프로젝트 생성`
- `컨텍스트 분석`

## 관련 API/서비스

- 클라이언트 제안 유틸
  - `pickWorkingDirectory()`
  - `scanDirectory(handle, options)`
  - `extractTextFromFile(file, options)`
  - `buildSourcePayload(entries)`
- 서버 제안 API
  - `POST /api/projects`
  - `POST /api/projects/:id/context/analyze`

## 관련 데이터 모델

- 현재 직접 저장
  - `Project.workingPath`
- 후속 저장 후보
  - `SourceDocument`
  - `SourceExtractionJob`

## 구현 메모

- 이 기능은 서버 기능이 아니라 브라우저 기능이다. 프론트와 백엔드 경계를 분명히 나눠야 한다.
- 추출 성공 수보다 `무엇이 제외되었는지`를 같이 보여야 사용자가 결과를 신뢰한다.
- 서버에는 raw handle이나 절대 경로를 보내지 않는다.
- 1차에서는 파일 전문 저장보다 `draft 분석용 payload` 전달이 우선이다.

## 검증 방법

- Chromium 계열에서 폴더 선택이 정상 작동하는지 확인
- 미지원 브라우저에서 대체 안내가 보이는지 확인
- 부분 실패가 있어도 payload 생성이 가능한지 확인
- 상대경로가 유지되는지 확인
- 서버로 전달되는 payload에 금지 확장자 내용이 포함되지 않는지 확인
