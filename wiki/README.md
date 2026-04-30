# m-master Wiki

이 위키는 `읽기 전용 문서`가 아니라 `구현 전 확인`, `구현 중 판단 기록`, `구현 후 반영`까지 포함하는 작업 시스템이다.

## 사용 순서

1. 구현 전에 아래 3개 규칙 문서를 먼저 확인한다.
   - [DEVELOPMENT_RULES.md](/Users/watchers/Desktop/m-master/DEVELOPMENT_RULES.md)
   - [IMPLEMENTATION_RULES.md](/Users/watchers/Desktop/m-master/IMPLEMENTATION_RULES.md)
   - [VERIFICATION_RULES.md](/Users/watchers/Desktop/m-master/VERIFICATION_RULES.md)
2. 작업 주제가 기존 위키에 있으면 먼저 읽는다.
3. 없으면 `analysis/` 또는 `features/`에 새 문서를 만든다.
4. 구현 중 구조 판단, 예외, 결정 이유를 문서에 남긴다.
5. 구현 후 실제 코드 기준으로 문서를 업데이트한다.

## 폴더 구조

- `00-overview.md`
  - 제품과 시스템 전체 요약
- `01-architecture.md`
  - 구조 원칙과 계층 책임
- `02-workflow.md`
  - 구현 전후 작업 순서
- `03-code-review-method.md`
  - 위키 방식 코드 확인 기준
- `04-agent-structure.md`
  - 에이전트 역할 구조와 협업 방식
- `analysis/`
  - 조사, 코드 읽기, 구조 판단 기록
- `features/`
  - 기능별 목적, 흐름, 예외, 체크리스트
- `decisions/`
  - 중요한 기술 결정 기록
- `templates/`
  - 새 문서 작성 템플릿

## 기록 원칙

- 위키는 코드와 함께 살아 있어야 한다.
- 구현하면서 알게 된 구조 판단은 바로 기록한다.
- 사람 기억에 남겨두지 않는다.
- 문서는 500줄 미만 원칙을 지키고, 커지면 분리한다.
- 추상 설명보다 실제 폴더, 컴포넌트, API, 테이블 이름을 쓴다.

## 언제 반드시 기록하나

- 새 기능을 처음 만들 때
- 구조를 바꿀 때
- DB 모델을 바꿀 때
- AI 생성/검수 흐름을 바꿀 때
- 발행, 배포, 권한, 보안 흐름이 바뀔 때
- 리뷰 중 드러난 중요한 판단이 있을 때

## 문서 종류

- `analysis`
  - 읽으면서 구조를 이해한 메모
- `feature`
  - 구현 대상 기능의 목적과 흐름
- `decision`
  - 왜 이렇게 설계했는지 남기는 기록

## 목표

- 코드를 빨리 읽기 위한 것이 아니다.
- 코드를 더 정확하게 분석하고, 같은 판단을 반복하지 않기 위한 것이다.
