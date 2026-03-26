# 기술 아키텍처 — QA Dock

> 최종 업데이트: 2026-03-26
> 상태: Phase 1 확정 (GitHub Pages + GitHub Actions)

---

## 1. 시스템 구성도

### Phase 1 (현재): GitHub Pages + GitHub Actions

```
┌───────────────────────────────────────────────────────────┐
│                    GitHub Actions (cron)                    │
│                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │ Jira REST API│───→│ 데이터 가공  │───→│ data.json    │  │
│  │  (JQL 조회)  │    │ (집계/매핑)  │    │ (gh-pages)   │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
└───────────────────────────────────────────────────────────┘
                                                  │
                                                  ▼
┌───────────────────────────────────────────────────────────┐
│              GitHub Pages (정적 호스팅)                     │
│              {username}.github.io/qa-dock/                  │
│                                                             │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐     │
│  │  상황판     │  │  통계/분석   │  │  도구 연동    │     │
│  │  (메인)     │  │  차트        │  │  (Phase 3)    │     │
│  └──────┬──────┘  └──────┬───────┘  └───────────────┘     │
│         └────────────────┤                                  │
│                    fetch data.json                           │
└───────────────────────────────────────────────────────────┘
```

### Phase 3~4 (향후): Docker 전환 시

```
[사내 서버 / 클라우드]
  ├── Backend (Jira API 직접 연동 + 캐시 + REST API)
  ├── Frontend (정적 파일 서빙)
  ├── Scheduler (Jira 폴링 크론)
  └── WebSocket (실시간 갱신)
```

---

## 2. 기술 스택 (Phase 1 확정)

| 항목 | 선택 | 비고 |
|------|------|------|
| **프론트엔드** | React 18 + TypeScript | Vite 빌드 |
| **스타일링** | Tailwind CSS | 다크 테마 |
| **차트** | Recharts 또는 Chart.js | 통계 시각화 |
| **데이터** | 정적 JSON (data.json) | GitHub Actions가 생성 |
| **데이터 수집** | GitHub Actions (Node.js 스크립트) | cron 10분 주기 |
| **호스팅** | GitHub Pages | gh-pages 브랜치 |
| **CI/CD** | GitHub Actions | 빌드 + 데이터 갱신 + 배포 자동화 |
| **비밀 관리** | GitHub Secrets | Jira API 토큰 |

---

## 3. 데이터 흐름 (Phase 1)

```
[10분 주기 cron]
GitHub Actions
  │
  ├─ 1. Jira REST API 호출 (GitHub Secrets의 토큰 사용)
  │     └─ JQL 쿼리로 GRIPPE 프로젝트 티켓 조회
  │
  ├─ 2. 데이터 가공 (Node.js 스크립트)
  │     ├─ Jira 상태 → 4단계 카드 매핑
  │     ├─ 통계 집계 (상태별/우선순위별/담당자별)
  │     └─ JSON 파일 생성
  │
  ├─ 3. 빌드된 프론트엔드 + data.json → gh-pages 브랜치 커밋
  │
  └─ 4. GitHub Pages 자동 배포
         └─ {username}.github.io/qa-dock/

[브라우저]
  index.html → fetch("data.json") → 렌더링
```

### 3.1 data.json 구조

```jsonc
{
  "lastUpdated": "2026-03-26T10:30:00+09:00",
  "summary": {
    "total": 42,
    "qa_needed": 8,
    "qa_review": 5,
    "qa_in_progress": 12,
    "qa_done": 17
  },
  "tickets": [
    {
      "key": "GRIPPE-1234",
      "summary": "과제명",
      "domain": "커머스",
      "priority": "Critical",
      "assignee": "담당자",
      "status": "QA중",
      "boardStage": "qa_in_progress",
      "dueDate": "26.04.15",
      "jiraUrl": "https://gripcorp.atlassian.net/browse/GRIPPE-1234",
      "bugCount": 3
    }
  ],
  "stats": {
    "byStatus": { "QA중": 12, "QA대기": 8, ... },
    "byPriority": { "Critical": 5, "Major": 15, ... },
    "byAssignee": { "하루": 8, "은지": 6, ... }
  }
}
```

### 3.2 GitHub Actions 워크플로우

```yaml
# .github/workflows/sync-jira.yml
name: Sync Jira Data

on:
  schedule:
    - cron: '*/10 * * * *'     # 10분 주기
  workflow_dispatch:             # 수동 실행

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: node scripts/fetch-jira.js
        env:
          JIRA_BASE_URL: ${{ secrets.JIRA_BASE_URL }}
          JIRA_EMAIL: ${{ secrets.JIRA_EMAIL }}
          JIRA_API_TOKEN: ${{ secrets.JIRA_API_TOKEN }}
      - run: npm run build
      - uses: peaceiris/actions-gh-pages@v4
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

### 3.3 주요 JQL 쿼리

```sql
-- 전체 QA 에픽 (활성)
project = GRIPPE AND issuetype = Epic AND status != "릴리스"
ORDER BY priority DESC, duedate ASC

-- 특정 에픽 하위 버그 수
project = GRIPPE AND issuetype = Bug AND "Epic Link" = GRIPPE-{id}

-- 최근 QA 완료 (2주)
project = GRIPPE AND status changed to "QA완료" after -14d
```

---

## 4. Jira 상태 매핑

### 4.1 매핑 전략
**설정 파일 기반** — `scripts/config/status-mapping.json`

GitHub Actions 스크립트가 이 설정을 읽어 Jira 상태를 4단계 카드로 분류.

### 4.2 매핑 설정 파일

```jsonc
{
  "boardStages": {
    "qa_needed":      { "label": "QA 필요",  "color": "#ef4444", "jiraStatuses": [] },
    "qa_review":      { "label": "QA 리뷰",  "color": "#f97316", "jiraStatuses": [] },
    "qa_in_progress": { "label": "QA 진행",  "color": "#3b82f6", "jiraStatuses": [] },
    "qa_done":        { "label": "QA 완료",  "color": "#22c55e", "jiraStatuses": [] }
  },
  "excluded": [],
  "unmapped": "qa_needed"
}
```

> Jira 실제 상태값 조회 후 `jiraStatuses` 배열 확정 필요

---

## 5. 연동 인터페이스 (Phase 3)

| 도구 | 연동 방식 | Phase 1 대안 |
|------|----------|-------------|
| 정적분석 (D) | REST API → data.json에 포함 | 수동 JSON 업데이트 |
| TC 설계 (E) | REST API → data.json에 포함 | 수동 JSON 업데이트 |
| CI/CD (C) | Webhook → data.json에 포함 | GitHub Actions 상태 연동 |

---

## 6. 보안

| 항목 | Phase 1 방안 |
|------|-------------|
| Jira API 토큰 | GitHub Secrets (서버 사이드, 브라우저 노출 없음) |
| 접근 제어 | GitHub Pages (public) — 민감 데이터 포함 여부 검토 필요 |
| 데이터 범위 | 티켓 요약/상태/담당자만 포함, 상세 설명/첨부파일 제외 |

### 6.1 GitHub Secrets 설정

```
JIRA_BASE_URL    = https://gripcorp.atlassian.net
JIRA_EMAIL       = {사용자 이메일}
JIRA_API_TOKEN   = {Jira API 토큰}
JIRA_PROJECT_KEY = GRIPPE
```

---

## 7. 에러 처리

| 상황 | 처리 |
|------|------|
| Jira API 장애 | GitHub Actions 실패 → 이전 data.json 유지 |
| data.json fetch 실패 | "데이터 로딩 실패" 메시지 + 재시도 버튼 |
| 매핑 안 된 상태 | `unmapped` 기본 단계로 분류 + Actions 로그 경고 |
| Actions cron 지연 | `lastUpdated` 타임스탬프로 데이터 신선도 표시 |

---

## 8. Phase별 전환 계획

| Phase | 호스팅 | 데이터 | 갱신 주기 |
|-------|--------|--------|----------|
| **1 (현재)** | GitHub Pages | data.json (Actions 생성) | 10분 |
| **2** | GitHub Pages | data.json + 통계 확장 | 10분 |
| **3** | Docker (선택) | 백엔드 API 직접 연동 | 5분 (폴링) |
| **4** | Docker | WebSocket 실시간 | 실시간 |
