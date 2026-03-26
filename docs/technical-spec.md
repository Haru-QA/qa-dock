# 기술 스펙 — QA Dock

> 최종 업데이트: 2026-03-26
> 상태: Phase 1 확정

---

## 1. 기술 스택 (Phase 1)

### 1.1 프론트엔드
| 항목 | 선택 | 비고 |
|------|------|------|
| 프레임워크 | React 18+ (TypeScript) | SPA, 컴포넌트 기반 |
| 스타일링 | Tailwind CSS | 다크 테마, 반응형 |
| 차트 | Recharts 또는 Chart.js | 상태별/우선순위별/담당자별 |
| 상태관리 | React Context 또는 Zustand | 경량 |
| HTTP | fetch | data.json 로드 |
| 빌드 | Vite | 빠른 HMR, 경량 번들 |

### 1.2 데이터 수집 (GitHub Actions)
| 항목 | 선택 | 비고 |
|------|------|------|
| 런타임 | Node.js 20 | GitHub Actions runner |
| Jira 클라이언트 | node-fetch 또는 axios | REST API 호출 |
| 데이터 가공 | TypeScript 스크립트 | 매핑 + 집계 → data.json |
| 스케줄 | cron (10분) | `*/10 * * * *` |
| 배포 | peaceiris/actions-gh-pages | gh-pages 브랜치 |

### 1.3 공통
| 항목 | 선택 | 비고 |
|------|------|------|
| 린터 | ESLint + Prettier | |
| 테스트 | Vitest | |
| 패키지매니저 | npm 또는 pnpm | |

---

## 2. 프로젝트 디렉토리 구조 (Phase 1)

```
qa-dock/
├── .github/
│   └── workflows/
│       └── sync-and-deploy.yml      # Jira 동기화 + 빌드 + 배포
│
├── scripts/                          # GitHub Actions에서 실행하는 데이터 수집
│   ├── fetch-jira.ts                 # Jira API 호출 + data.json 생성
│   ├── config/
│   │   └── status-mapping.json       # Jira 상태 → 4단계 매핑 설정
│   └── tsconfig.json
│
├── src/                              # React 프론트엔드
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx            # 헤더 (타이틀, 업데이트 시간, 총 건수)
│   │   │   └── SummaryCards.tsx       # 요약 카드 (완료/진행/대기)
│   │   ├── workflow/
│   │   │   └── WorkflowSummary.tsx    # QA 워크플로우 6단계 요약
│   │   ├── board/
│   │   │   ├── StatusBoard.tsx        # 4단계 상황판 (카드 그리드)
│   │   │   ├── StatusCard.tsx         # 개별 카드 (QA필요/리뷰/진행/완료)
│   │   │   └── TaskTable.tsx          # 하단 상세 리스트 테이블
│   │   ├── stats/
│   │   │   ├── StatusChart.tsx        # 상태별 현황 (도넛)
│   │   │   ├── PriorityChart.tsx      # 우선순위별 현황 (바)
│   │   │   └── AssigneeChart.tsx      # 담당 QA별 리소스 (스택 바)
│   │   └── common/
│   │       ├── Badge.tsx              # 상태/우선순위 배지
│   │       └── SortableHeader.tsx     # 정렬 가능 테이블 헤더
│   ├── hooks/
│   │   ├── useData.ts                # data.json fetch + 상태 관리
│   │   ├── useStatusBoard.ts         # 4단계 카드 필터링
│   │   └── useSort.ts               # 테이블 정렬
│   ├── types/
│   │   ├── ticket.ts                 # QATicket 타입
│   │   └── stats.ts                  # 통계 타입
│   ├── config/
│   │   ├── colors.ts                 # 상태/우선순위 색상 정의
│   │   └── constants.ts              # 상수
│   ├── utils/
│   │   └── date.ts                   # 날짜 포맷
│   ├── App.tsx
│   └── main.tsx
│
├── public/
│   └── data.json                     # GitHub Actions가 생성 (gitignore)
│
├── docs/                             # 설계 문서
├── index.html
├── tailwind.config.ts
├── tsconfig.json
├── vite.config.ts
├── package.json
└── .gitignore
```

---

## 3. 핵심 타입 정의

```typescript
// src/types/ticket.ts
type BoardStage = 'qa_needed' | 'qa_review' | 'qa_in_progress' | 'qa_done';
type Priority = 'Blocker' | 'Critical' | 'Major' | 'Minor' | 'Trivial';

interface QATicket {
  key: string;              // "GRIPPE-1234"
  summary: string;          // 과제명
  domain: string;           // 도메인
  priority: Priority;
  assignee: string;         // 담당 QA
  status: string;           // Jira 원본 상태
  boardStage: BoardStage;   // 매핑된 4단계
  dueDate: string | null;   // "YY.MM.DD"
  jiraUrl: string;          // Jira 링크
  bugCount: number;         // 하위 버그 수
}

// src/types/stats.ts
interface DashboardData {
  lastUpdated: string;      // ISO 8601
  summary: BoardSummary;
  tickets: QATicket[];
  stats: {
    byStatus: Record<string, number>;
    byPriority: Record<Priority, number>;
    byAssignee: Record<string, number>;
  };
}

interface BoardSummary {
  total: number;
  qa_needed: number;
  qa_review: number;
  qa_in_progress: number;
  qa_done: number;
}
```

---

## 4. Jira 데이터 수집 스크립트

### 4.1 fetch-jira.ts 핵심 로직

```typescript
// scripts/fetch-jira.ts (GitHub Actions에서 실행)
async function main() {
  // 1. Jira API로 GRIPPE 에픽 조회
  const epics = await fetchJiraJQL(
    'project = GRIPPE AND issuetype = Epic AND status != "릴리스" ORDER BY priority DESC'
  );

  // 2. 상태 매핑 설정 로드
  const mapping = loadStatusMapping('./config/status-mapping.json');

  // 3. 티켓별 매핑 + 버그 수 조회
  const tickets = await Promise.all(
    epics.map(epic => transformTicket(epic, mapping))
  );

  // 4. 통계 집계
  const stats = aggregateStats(tickets);

  // 5. data.json 생성
  writeDataJson({ lastUpdated: new Date().toISOString(), summary, tickets, stats });
}
```

### 4.2 필요한 Jira 필드

| Jira 필드 | 용도 |
|-----------|------|
| `key` | 티켓 ID |
| `summary` | 과제명 |
| `priority.name` | 우선순위 |
| `assignee.displayName` | 담당 QA |
| `status.name` | 상태 |
| `duedate` | 목표일 |
| `components[].name` | 도메인 |

---

## 5. 다크 테마 디자인 토큰

상위 프로젝트 HTML 리포트 표준과 통일:

```css
:root {
  /* 배경 */
  --bg:       #0f172a;
  --bg2:      #1e293b;
  --bg3:      #334155;

  /* 텍스트 */
  --text:     #e2e8f0;
  --text-dim: #94a3b8;

  /* 상태 카드 */
  --qa-needed:     #ef4444;
  --qa-review:     #f97316;
  --qa-progress:   #3b82f6;
  --qa-done:       #22c55e;

  /* 우선순위 */
  --p-blocker:  #dc2626;
  --p-critical: #ea580c;
  --p-major:    #ca8a04;
  --p-minor:    #65a30d;
  --p-trivial:  #9ca3af;
}
```

---

## 6. 에러 처리

| 상황 | 처리 |
|------|------|
| data.json fetch 실패 | "데이터 로딩 실패" + 재시도 버튼 |
| data.json이 오래됨 (>30분) | "데이터 갱신 지연" 경고 배너 |
| Jira API 장애 (Actions) | Actions 실패 → 이전 data.json 유지 |
| 매핑 안 된 상태 | unmapped 기본 단계 + Actions 로그 경고 |

---

## 7. 보안

| 항목 | 방안 |
|------|------|
| Jira API 토큰 | GitHub Secrets (브라우저 노출 없음) |
| data.json 범위 | 티켓 요약/상태/담당자만, 상세 설명/첨부 제외 |
| 레포 공개 범위 | private repo 권장 (사내 데이터 포함) |
| GitHub Pages 접근 | private repo → GitHub Pro 필요, 또는 public + 민감 정보 제외 |
