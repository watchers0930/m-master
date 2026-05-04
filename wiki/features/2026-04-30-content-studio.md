# 콘텐츠 스튜디오

## 목적

선택한 주제를 기준으로 블로그, 인스타그램, 페이스북 3채널 초안을 하나의 작업 화면에서 생성, 비교, 수정하게 한다.

## 사용자 흐름

1. 사용자가 추천 주제 선택 또는 직접 입력을 마친다.
2. 스튜디오에 진입하면 좌측 패널에 `주제`, `목적`, `톤`, `CTA`, `채널`이 보인다.
3. 사용자가 `전체 생성`을 실행한다.
4. 시스템이 하나의 `ContentJob`을 만들고, 3개의 `ContentAsset` 초안을 채운다.
5. 사용자는 우측 탭에서 `블로그`, `인스타그램`, `페이스북`을 전환해 본다.
6. 사용자는 채널별로 텍스트를 편집하거나 부분 재생성 액션을 선택한다.
7. 저장 후 검수 단계로 이동한다.

## 입력

- 승인된 `BrandProfile`
- 선택 주제 또는 직접 주제
- 생성 설정
  - `objective`
  - `tone`
  - `cta`
  - `enabledChannels`

## 출력

- 생성된 `ContentJob`
  - `id`
  - `topic`
  - `objective`
  - `status`
- 생성된 `ContentAsset[]`
  - `channel=blog`
  - `channel=instagram`
  - `channel=facebook`
  - `title`
  - `body`
  - `cta`

## 주요 상태

- `idle`
  - 생성 전
- `generating`
  - 전체 생성 중
- `generated`
  - 결과 확인 가능
- `editing`
  - 사용자 수정 중
- `regenerating-section`
  - 부분 재생성 중
- `save-pending`
  - 변경 저장 중

## 예외 케이스

- 승인되지 않은 프로필로 진입
  - 차단
- 주제가 비어 있음
  - 생성 차단
- 1개 채널만 생성 실패
  - 실패 채널만 오류 표기하고 다른 채널 결과는 유지
- 사용자가 수정 중인데 재생성을 눌렀음
  - 덮어쓰기 경고 또는 현재 편집본 저장 필요
- 블로그는 생성됐지만 SNS 파생이 비정상적으로 짧음
  - 검수 이전에도 채널별 최소 길이 경고 가능

## 관련 화면

- `콘텐츠 스튜디오`

## 관련 API/서비스

- `POST /api/projects/:id/content-jobs`
- `GET /api/content-jobs/:id`
- `PATCH /api/assets/:id`
- 제안 서비스
  - `createContentJob(projectId, payload)`
  - `generateChannelAssets(contentJobId)`
  - `updateContentAsset(assetId, payload)`

## 관련 데이터 모델

- `ContentJob`
- `ContentAsset`
- 참조 기준
  - `Project`
  - `BrandProfile`
  - `TopicCandidate`

## 구현 메모

- 디자인 문서 기준으로 스튜디오는 `좌측 설정 패널 + 우측 채널 탭 + 하단 액션/검수 진입` 구조를 유지해야 한다.
- 같은 주제를 바탕으로 3채널 결과가 연결되어 보이는 것이 핵심이므로, 각 채널을 완전히 분리된 페이지로 쪼개면 안 된다.
- Step 4 편집은 `현재 채널 1개만 보고 저장`하는 흐름이 기본이어야 한다.
- 1차에서는 이미지 생성 버튼을 숨기거나 `준비 중` 상태로 두는 편이 정확하다.
- 저장 버튼과 생성 버튼 위치는 고정해야 한다.

## 검증 방법

- 주제 선택 후 스튜디오 시작값이 정확히 채워지는지 확인
- `ContentJob` 1건 아래 3채널 `ContentAsset`이 생성되는지 확인
- 탭 전환 시 채널별 본문이 섞이지 않는지 확인
- 사용자 수정 후 저장값이 유지되는지 확인
- 일부 채널 실패 시 전체 화면이 깨지지 않고 부분 오류만 보이는지 확인
