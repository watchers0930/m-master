# MINTEQ GEO 적대적 리뷰 수정

- cron: active + nextAttemptAt 만기만 선택. lastCheckedAt NULL 우선, 이후 오래된 확인 순서와 createdAt/id로 순회한다. 실패·스킵·pending은 1분부터 최대 24시간 지수 백오프, 성공은 초기화한다. attemptFailures는 연속 재시도 횟수다.
- 수집 입력: 예약 트랜잭션에서 captureConfig에 질문·시장·브랜드·경쟁사·도메인 호스트/ID를 고정한다. 판정과 시장/도메인 집계는 고정 입력을 사용한다. 기존 NULL 행만 기존 설정을 읽는다. 기존 데이터에는 과거 설정을 복원할 근거가 없다.
- PATCH: 질문/시장/별칭/도메인 변경은 pending 전부 failed, 엔진 제거는 제거된 엔진만 failed, 비활성화는 pending 전부 failed로 종료한다. 완료 쓰기는 owner lock + pending 조건으로 PATCH 이후 부활을 차단한다. 이미 지출한 원가는 유지하고 예약예산만 해제한다.
- 회수: 질문 등록 엔진과 별도로 전체 지원 엔진의 기존 pending을 먼저 회수한다. 새 작업의 예산 부족이 기존 유료 작업의 회수 트랜잭션을 되돌리지 않는다.
- 집계: PostgreSQL COUNT FILTER / GROUPING SETS / bool 집계. 전체 스냅샷/mention을 앱 메모리로 읽지 않는다. 일별 결과 최대 367일 × 4엔진, 경쟁사 상위 100개. score.ts는 단위 테스트의 순수 참조 구현이다.
- 인용: citationLimit 기본 50, 최대 100. citationCursor는 capturedAt + snapshot id + JSON 배열 ordinal. nextCitationCursor로 다음 페이지를 요청한다. 자체 도메인 여부는 고정 호스트 기준이다.
- 도메인: free 1, starter 5, pro 무제한. owner lock에서 개수와 분당 생성 5회를 검사하고 감사 이벤트를 같은 트랜잭션에 저장한다. 삭제 후 재생성해도 빈도 제한이 유지된다.
- DELETE /api/domains/[id]: 세션/소유권/출처 검사. 연결 질문과 이력은 보존하며 도메인 연결 해제 + 질문 비활성화 + pending 종료. 타인 ID는 404.
- 질문 목록: data 배열 계약 유지, 최상위 nextCursor 추가. createdAt DESC + id ASC 키셋 조건으로 커서 행이 삭제되어도 연속 조회 가능. UI는 다음 페이지 버튼으로 100개 초과를 관리한다.

## 검증 및 마이그레이션

- npx tsc --noEmit, node --test lib/visibility/__tests__/*.test.cjs.
- scripts/visibility/db-regression.cjs는 임시 PGlite PostgreSQL에서 SQL 집계/커서/소유권/고정 설정/DDL 두 번 적용을 검증한다. 별도 위치에 @electric-sql/pglite를 설치하고 PGLITE_MODULE로 모듈 경로를 지정할 수 있다. 운영 DB 접근 없음.
- prisma/manual-migrations/20261019_minteq_visibility.sql은 ADD COLUMN IF NOT EXISTS + DEFAULT, 테이블/인덱스/제약의 존재 검사를 사용한다. 원본 데이터 삭제/재작성 없음. 기존 테이블에서도 재실행 가능하다.
- 배포 시 DDL 먼저 적용 후 Prisma client를 재생성한다. 롤백은 이전 앱 코드로 되돌리고 추가 컬럼은 보존한다. 운영 DB 적용과 배포는 이 작업 범위에 포함하지 않는다.
