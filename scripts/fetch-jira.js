/**
 * fetch-jira.js
 * GitHub Actions에서 실행되는 Jira 데이터 수집 스크립트
 *
 * 환경변수:
 *   JIRA_BASE_URL   - https://gripcorp.atlassian.net
 *   JIRA_EMAIL       - Jira 계정 이메일
 *   JIRA_API_TOKEN   - Jira API 토큰
 *
 * 출력: public/data.json (프론트엔드가 fetch하는 데이터)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 환경변수 ──
const JIRA_BASE_URL = process.env.JIRA_BASE_URL || 'https://gripcorp.atlassian.net';
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN;
const GRIP_DASHBOARD_API = 'https://script.google.com/macros/s/AKfycbwXheGJqLGfrOjMtdAi9VGXfCppSIuXr8EKTGF-JhcDIGsI90V8QzKhfGZJakHE4Rce/exec';

if (!JIRA_EMAIL || !JIRA_API_TOKEN) {
  console.error('ERROR: JIRA_EMAIL and JIRA_API_TOKEN environment variables are required');
  process.exit(1);
}

const AUTH_HEADER = 'Basic ' + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');

// ── Jira API 호출 ──
async function jiraFetch(endpoint, params = {}) {
  const url = new URL(`${JIRA_BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      'Authorization': AUTH_HEADER,
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira API error ${res.status}: ${text}`);
  }
  return res.json();
}

// ── JQL 검색 (페이지네이션) ──
async function jiraSearch(jql, fields, maxResults = 200) {
  const allIssues = [];
  let startAt = 0;
  const pageSize = 100;

  while (startAt < maxResults) {
    const data = await jiraFetch('/rest/api/3/search', {
      jql,
      fields: fields.join(','),
      startAt: String(startAt),
      maxResults: String(Math.min(pageSize, maxResults - startAt)),
    });

    allIssues.push(...data.issues);
    if (startAt + data.issues.length >= data.total || data.issues.length === 0) break;
    startAt += data.issues.length;
  }

  return allIssues;
}

// ── 이름 추출 (한글 이름만, 또는 displayName 첫 단어) ──
function extractName(displayName) {
  if (!displayName) return '-';
  // "김연화clooney 클루니" → "연화" 패턴 대응: 한글만 추출 후 2글자면 이름
  const korean = displayName.match(/[가-힣]+/g);
  if (korean) {
    // 2~3글자 한글이름이 있으면 사용
    const name = korean.find(k => k.length >= 2 && k.length <= 3);
    if (name) return name;
    // 풀네임(3글자 이상)이면 성 빼고 반환
    const fullName = korean.find(k => k.length >= 2);
    if (fullName && fullName.length > 2) return fullName.slice(1);
    if (fullName) return fullName;
  }
  return displayName.split(/\s/)[0];
}

// ── grip-dashboard API에서 사업 우선순위 가져오기 ──
async function fetchBizPriorities() {
  try {
    const res = await fetch(GRIP_DASHBOARD_API, { redirect: 'follow' });
    if (!res.ok) {
      console.warn('grip-dashboard API 응답 오류:', res.status);
      return {};
    }
    const data = await res.json();
    // {key: GRIPPGM-XXXX, bizPriority: "상"} 형태의 배열 또는 객체 매핑
    const map = {};
    if (Array.isArray(data)) {
      data.forEach(item => {
        if (item.key || item.ticketKey) {
          map[item.key || item.ticketKey] = item.bizPriority || item.priority || '-';
        }
      });
    } else if (data.tickets && Array.isArray(data.tickets)) {
      data.tickets.forEach(item => {
        if (item.key || item.ticketKey) {
          map[item.key || item.ticketKey] = item.bizPriority || item.priority || '-';
        }
      });
    }
    console.log(`grip-dashboard: ${Object.keys(map).length}건 매칭 데이터 로드`);
    return map;
  } catch (e) {
    console.warn('grip-dashboard API 호출 실패:', e.message);
    return {};
  }
}

// ── GRIPPE 프로젝트에서 QA/TC 티켓 조회 ──
async function fetchQATickets() {
  console.log('1. GRIPPE QA/TC 티켓 조회 중...');

  const jql = `project = GRIPPE AND issuetype = Epic AND status != "릴리스" AND created >= "2026-01-01" ORDER BY created DESC`;
  const fields = ['summary', 'status', 'assignee', 'duedate', 'components', 'parent', 'created'];
  const issues = await jiraSearch(jql, fields, 500);

  console.log(`   전체 에픽: ${issues.length}건`);

  // QA - / TC - 프리픽스 필터링 ([QA] 형태 제외)
  const filtered = issues.filter(issue => {
    const summary = issue.fields.summary || '';
    return /^(QA|TC)\s*-\s/.test(summary);
  });

  console.log(`   QA/TC 필터링 후: ${filtered.length}건`);
  return filtered;
}

// ── GRIPPGM 부모 키에서 PM/Dev 정보 조회 ──
async function fetchParentInfo(parentKeys) {
  if (parentKeys.length === 0) return {};

  console.log('2. GRIPPGM 부모 티켓 정보 조회 중...');

  const uniqueKeys = [...new Set(parentKeys)].filter(k => k);
  const map = {};

  // GRIPPGM 티켓에서 담당자(PM) 조회
  for (let i = 0; i < uniqueKeys.length; i += 50) {
    const batch = uniqueKeys.slice(i, i + 50);
    const jql = `key in (${batch.join(',')})`;
    const issues = await jiraSearch(jql, ['assignee', 'summary', 'components'], batch.length);

    issues.forEach(issue => {
      map[issue.key] = {
        pm: extractName(issue.fields.assignee?.displayName),
        summary: issue.fields.summary,
      };
    });
  }

  // GRIPPLAN에서 dev 담당자 조회 (GRIPPGM 하위 도메인 에픽)
  for (let i = 0; i < uniqueKeys.length; i += 50) {
    const batch = uniqueKeys.slice(i, i + 50);
    const jql = `project in (GRIPSVR, GRIPWEB, GRIPAND, GRIPIOS) AND issuetype = Epic AND "Epic Link" in (${batch.join(',')})`;

    try {
      const issues = await jiraSearch(jql, ['assignee', 'parent', 'project'], batch.length * 3);
      issues.forEach(issue => {
        const parentKey = issue.fields.parent?.key;
        if (parentKey && map[parentKey] && !map[parentKey].dev) {
          map[parentKey].dev = extractName(issue.fields.assignee?.displayName);
        }
      });
    } catch (e) {
      console.warn('   도메인 에픽 조회 경고:', e.message);
    }
  }

  console.log(`   부모 정보: ${Object.keys(map).length}건`);
  return map;
}

// ── 에픽별 버그 수 조회 ──
async function fetchBugCounts(ticketKeys) {
  if (ticketKeys.length === 0) return {};

  console.log('3. 에픽별 버그 수 조회 중...');

  const map = {};
  for (let i = 0; i < ticketKeys.length; i += 30) {
    const batch = ticketKeys.slice(i, i + 30);
    const jql = `project = GRIPPE AND issuetype = Bug AND "Epic Link" in (${batch.join(',')})`;

    try {
      const data = await jiraFetch('/rest/api/3/search', {
        jql,
        fields: 'parent',
        maxResults: '0', // count만 필요
      });
      // 개별 에픽별 카운트를 위해 실제 조회 필요
      const bugs = await jiraSearch(jql, ['parent'], 500);
      bugs.forEach(bug => {
        const epicKey = bug.fields.parent?.key;
        if (epicKey) {
          map[epicKey] = (map[epicKey] || 0) + 1;
        }
      });
    } catch (e) {
      console.warn('   버그 수 조회 경고:', e.message);
    }
  }

  return map;
}

// ── 버그 티켓 조회 (최근 90일) ──
async function fetchBugs() {
  console.log('4. 버그 티켓 조회 중 (최근 90일)...');

  const jql = `project in (GRIPSVR, GRIPWEB, GRIPAND, GRIPIOS) AND issuetype = Bug AND created >= -90d ORDER BY created DESC`;
  const fields = ['summary', 'status', 'priority', 'assignee', 'parent', 'project', 'created'];
  const issues = await jiraSearch(jql, fields, 500);

  console.log(`   버그: ${issues.length}건`);
  return issues;
}

// ── 버그의 GRIPPGM 매핑 + QA 담당자 조회 ──
async function enrichBugs(bugs) {
  console.log('5. 버그 GRIPPGM 매핑 및 QA 담당자 조회 중...');

  // 부모 에픽 키 수집
  const epicKeys = [...new Set(bugs.map(b => b.fields.parent?.key).filter(Boolean))];

  // 에픽 → GRIPPGM 매핑
  const epicToGrippgm = {};
  for (let i = 0; i < epicKeys.length; i += 50) {
    const batch = epicKeys.slice(i, i + 50);
    const jql = `key in (${batch.join(',')})`;

    try {
      const issues = await jiraSearch(jql, ['parent', 'summary'], batch.length);
      issues.forEach(issue => {
        if (issue.fields.parent?.key) {
          epicToGrippgm[issue.key] = issue.fields.parent.key;
        }
      });
    } catch (e) {
      console.warn('   에픽 부모 조회 경고:', e.message);
    }
  }

  // GRIPPGM에서 QA 담당자/PM 조회
  const grippgmKeys = [...new Set(Object.values(epicToGrippgm))];
  const grippgmInfo = {};

  for (let i = 0; i < grippgmKeys.length; i += 50) {
    const batch = grippgmKeys.slice(i, i + 50);

    // GRIPPE에서 해당 GRIPPGM의 QA/TC 에픽 찾기
    const jql = `project = GRIPPE AND issuetype = Epic AND "Epic Link" in (${batch.join(',')})`;
    try {
      const issues = await jiraSearch(jql, ['assignee', 'parent'], batch.length * 2);
      issues.forEach(issue => {
        const parentKey = issue.fields.parent?.key;
        if (parentKey && !grippgmInfo[parentKey]) {
          grippgmInfo[parentKey] = {
            qaAssignee: extractName(issue.fields.assignee?.displayName),
          };
        }
      });
    } catch (e) {
      // GRIPPE 에픽 링크가 없을 수 있음
    }

    // GRIPPGM 자체에서 PM 정보
    const jql2 = `key in (${batch.join(',')})`;
    try {
      const issues = await jiraSearch(jql2, ['assignee'], batch.length);
      issues.forEach(issue => {
        if (!grippgmInfo[issue.key]) grippgmInfo[issue.key] = {};
        grippgmInfo[issue.key].pm = extractName(issue.fields.assignee?.displayName);
      });
    } catch (e) {
      console.warn('   GRIPPGM PM 조회 경고:', e.message);
    }
  }

  return { epicToGrippgm, grippgmInfo };
}

// ── 서비스 이름 매핑 ──
function getServiceName(projectKey) {
  const map = {
    'GRIPSVR': '서버',
    'GRIPWEB': '웹',
    'GRIPAND': '안드로이드',
    'GRIPIOS': 'iOS',
  };
  return map[projectKey] || projectKey;
}

// ── 날짜 포맷 ──
function formatDate(dateStr) {
  if (!dateStr) return null;
  // "2026-03-27" → "2026-03-27"
  return dateStr.split('T')[0];
}

// ── 메인 ──
async function main() {
  console.log('=== QA Dock 데이터 수집 시작 ===\n');

  // 1. QA/TC 티켓 조회
  const qaIssues = await fetchQATickets();

  // 부모 GRIPPGM 키 추출
  const parentKeys = qaIssues.map(i => i.fields.parent?.key).filter(Boolean);

  // 2~3. 병렬 처리: 부모 정보 + 사업 우선순위 + 버그 수
  const [parentInfo, bizPriorities] = await Promise.all([
    fetchParentInfo(parentKeys),
    fetchBizPriorities(),
  ]);

  // 티켓 변환
  const tickets = qaIssues.map(issue => {
    const f = issue.fields;
    const summary = f.summary || '';
    const prefixMatch = summary.match(/^(QA|TC)\s*-\s*/);
    const prefix = prefixMatch ? prefixMatch[1] : '-';
    const parentKey = f.parent?.key || '';
    const parent = parentInfo[parentKey] || {};

    return {
      key: issue.key,
      summary,
      prefix,
      status: f.status?.name || '-',
      assignee: extractName(f.assignee?.displayName),
      dueDate: formatDate(f.duedate),
      jiraUrl: `${JIRA_BASE_URL}/browse/${issue.key}`,
      parentKey,
      pm: parent.pm || '-',
      dev: parent.dev || '-',
      bizPriority: bizPriorities[parentKey] || '-',
      bugCount: 0, // 아래에서 업데이트
      created: formatDate(f.created),
    };
  });

  // 버그 수 조회 (GRIPPE 에픽 기준)
  const bugCounts = await fetchBugCounts(tickets.map(t => t.key));
  tickets.forEach(t => {
    t.bugCount = bugCounts[t.key] || 0;
  });

  // 4~5. 버그 티켓 조회 + 보강
  const bugIssues = await fetchBugs();
  const { epicToGrippgm, grippgmInfo } = await enrichBugs(bugIssues);

  const bugs = bugIssues.map(issue => {
    const f = issue.fields;
    const epicKey = f.parent?.key || '';
    const grippgmKey = epicToGrippgm[epicKey] || '';
    const gInfo = grippgmInfo[grippgmKey] || {};

    return {
      key: issue.key,
      summary: f.summary || '',
      status: f.status?.name || '-',
      priority: f.priority?.name || '-',
      assignee: extractName(f.assignee?.displayName),
      parentEpicKey: epicKey,
      jiraUrl: `${JIRA_BASE_URL}/browse/${issue.key}`,
      grippgmKey,
      qaAssignee: gInfo.qaAssignee || '-',
      pm: gInfo.pm || '-',
      service: getServiceName(f.project?.key || ''),
      created: formatDate(f.created),
    };
  });

  // 집계
  const summary = {
    total: tickets.length,
    waiting: tickets.filter(t => t.status === '대기 중').length,
    in_progress: tickets.filter(t => ['QA 중', '진행 중', '리뷰 중'].includes(t.status)).length,
    done: tickets.filter(t => t.status === '완료됨').length,
  };

  // 버그 집계
  const bugByStatus = {};
  const bugByPriority = {};
  let bugOpen = 0, bugInProgress = 0, bugResolved = 0;

  bugs.forEach(b => {
    bugByStatus[b.status] = (bugByStatus[b.status] || 0) + 1;
    bugByPriority[b.priority] = (bugByPriority[b.priority] || 0) + 1;

    if (b.status === '대기 중') bugOpen++;
    else if (['QA 중', '진행 중', '리뷰 중'].includes(b.status)) bugInProgress++;
    else if (b.status === '완료됨') bugResolved++;
  });

  const bugSummary = {
    total: bugs.length,
    open: bugOpen,
    inProgress: bugInProgress,
    resolved: bugResolved,
    byStatus: bugByStatus,
    byPriority: bugByPriority,
  };

  // data.json 생성
  const output = {
    lastUpdated: new Date().toISOString(),
    dataScope: '2026년',
    summary,
    tickets,
    bugSummary,
    bugs,
  };

  const outputPath = path.resolve(__dirname, '..', 'data.json');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

  console.log(`\n=== 완료 ===`);
  console.log(`QA/TC 티켓: ${tickets.length}건`);
  console.log(`버그: ${bugs.length}건`);
  console.log(`출력: ${outputPath}`);
}

main().catch(err => {
  console.error('데이터 수집 실패:', err);
  process.exit(1);
});
