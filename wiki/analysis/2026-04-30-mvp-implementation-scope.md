# MVP Implementation Scope Analysis

## 주제

초기 웹 MVP 구현 범위와 작업폴더 분석 방식 정리

## 목적

`marketing` 문서 기준으로 바로 구현 가능한 범위를 정리하고, 작업폴더 분석 요구사항을 웹 MVP 안에서 어떻게 유지할지 결정한다.

## 확인한 문서

- `marketing/context-aware-marketing-platform-master-plan.html`
- `marketing/context-aware-marketing-platform-design-spec.html`
- `marketing/context-aware-marketing-platform-design-concept.html`

## 핵심 이해

- 첫 화면 목표는 `프로젝트 생성 → 컨텍스트 분석/승인 → 콘텐츠 스튜디오 → 검수` 흐름이다.
- 시스템 핵심은 블로그 원본과 인스타그램·페이스북 파생 구조다.
- 브랜드 컨텍스트는 생성 전에 승인 가능한 상태로 보여야 한다.
- 이미지 생성은 후속 모듈이지만 데이터 구조와 UI 진입점은 고려해야 한다.

## 현재 코드 상태

- UI는 단일 랜딩 화면만 존재한다.
- Prisma 스키마는 `Project`, `BrandProfile`, `TopicCandidate`, `ContentJob`, `ContentAsset`, `ImageJob`, `ImageAsset`까지 들어가 있다.
- 서비스 계층, API, feature 구조는 아직 없다.

## 구현 제약과 해석

- 현재 배포 대상은 Vercel 기반 웹앱이다.
- 서버가 임의의 사용자 로컬 경로를 직접 읽는 구조는 아니다.
- 하지만 브라우저에서는 File System Access API 또는 업로드 기반 방식으로 사용자가 지정한 폴더의 파일을 읽을 수 있다.
- 따라서 `작업 폴더 분석` 요구사항은 유지하고, 1차 구현은 `브라우저가 폴더를 읽고 추출한 정보를 서버 초안 분석에 전달하는 방식`으로 구현한다.

## 구현 판단

- 1차 구현에서도 `작업 폴더 지정`과 `문서 읽기` 흐름을 넣는다.
- 지원 브라우저에서는 File System Access API로 폴더를 선택한다.
- 클라이언트는 파일 메타데이터와 일부 텍스트를 추출해 서버로 전달한다.
- 서버는 전달된 문맥과 도메인 정보를 기반으로 deterministic context draft와 추천 주제를 만든다.
- 실제 동작 MVP는 `프로젝트 생성`, `작업폴더 선택`, `도메인 입력`, `브랜드 컨텍스트 초안`, `사용자 승인`, `추천 주제`, `콘텐츠 스튜디오 UI`, `검수 패널` 중심으로 간다.
- 후속 단계에서 더 정교한 chunking, summarization, 별도 local bridge/runtime 연동으로 확장한다.

## 첫 구현 범위

1. 프로젝트 생성 API
2. 프로젝트/브랜드 프로필/주제 조회 API
3. 폴더 선택 및 파일 추출 UI
4. 기본 서버 서비스 계층
5. MVP 대시보드 UI
6. 컨텍스트 승인/주제 선택/콘텐츠 초안 표시

## 후속 확장

- 고도화된 문서 chunking/summarization
- 외부 도메인 크롤링
- local bridge/runtime 연동
- AI 생성 연동
- 이미지 생성 및 오버레이
