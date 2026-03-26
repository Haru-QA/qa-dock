# QA Dock — QA 팀 대시보드

## 프로젝트 개요
- **목적**: QA팀 전체 현황을 한눈에 파악할 수 있는 통합 대시보드
- **상위 프로젝트**: `improve-productivity-qa` > H. 팀 대시보드
- **시작일**: 2026-03-26
- **담당자**: 하루 QA
- **운영 형태**: GitHub Pages + GitHub Actions (Phase 1)
- **레포 이름**: qa-dock
- **URL**: {username}.github.io/qa-dock/

---

## 디렉토리 구조

```
/
├── CLAUDE.md                        # 프로젝트 규칙 및 컨벤션 (이 파일)
├── README.md                        # 프로젝트 소개
├── .env                             # 환경변수 (git 제외)
│
├── docs/                            # 설계 문서
│   ├── plan.md                      # 요구사항 정의
│   ├── todo-status.md               # 진행 상태 추적
│   ├── architecture.md              # 기술 아키텍처 설계
│   └── api-spec.md                  # API 스펙 (추후)
│
├── output/                          # 산출물 (와이어프레임, 프레젠테이션 등)
│   ├── wireframe/                   # 화면 설계 HTML
│   └── architect/                   # 아키텍처 다이어그램 HTML
│
├── src/                             # 소스 코드
│   ├── frontend/                    # 프론트엔드 (React/Vue 등)
│   ├── backend/                     # 백엔드 API 서버
│   └── shared/                      # 공통 타입, 유틸
│
└── tests/                           # 테스트
```

---

## 대시보드 구성 (페이지/탭)

### 1. QA 상황판 (메인)
- **최상단**: QA Work Flow 간략 표시 (현재 Phase 하이라이트)
- **상황판**: 4단계 카드 (QA 필요 → QA 리뷰 → QA 진행 → QA 완료)
- **하단**: 카드 클릭 시 해당 단계의 상세 리스트 표시

### 2. 통계/분석 대시보드
- 상태별 분포 차트
- 우선순위별 분포
- 담당자별 워크로드
- 기간별 추이 (주간/월간)
- 버그 발견율, 해결율

### 3. 도구 연동
- 정적 분석 결과 연동 (D. PRD 정적분석 봇)
- TC 설계 현황 연동 (E. PRD TC 생성 봇)
- CI/CD 현황 연동 (C. CI/CD 자동화)

---

## 데이터 소스

| 소스 | 용도 | 연동 방식 |
|------|------|----------|
| Jira (GRIPPE) | QA 티켓, 버그, 에픽 상태 | REST API |
| Jira (GRIPPGM) | 고객가치 티켓, 프로덕트 현황 | REST API |
| Confluence | PRD 문서 링크 | REST API |
| Slack | 알림 발송 | Webhook / Bot |
| 정적분석 결과 | 분석 리포트 | 파일 시스템 / API |
| TC 자동화 결과 | TC 설계 리포트 | 파일 시스템 / API |

---

## 설계 원칙

### AI 역할 경계
- 데이터 수집 → Jira/Confluence API가 확정
- 의미 분석(분류, 우선순위 판단, 이상 감지) → AI가 담당
- AI는 "판단"만, "데이터 수집"은 도구가 한다

### Single Source of Truth
- 모든 업무 데이터의 원본은 **Jira**
- 대시보드는 Jira 데이터를 **읽기 전용**으로 시각화
- 상태 변경은 Jira에서 직접 수행 (대시보드에서 Jira 링크 제공)

### HTML 산출물 표준
- 상위 프로젝트의 HTML 리포트 표준 포맷 준수
- 다크 테마, 고정 헤더, accordion, 색상 체계 동일 적용

---

## 파일 수정 규칙

- 상위 프로젝트(`improve-productivity-qa`)의 공통 규칙 준수
- 커밋/푸쉬 시 `docs/` 문서도 함께 동기화
- 상태 변경 시 `docs/todo-status.md` 반영
