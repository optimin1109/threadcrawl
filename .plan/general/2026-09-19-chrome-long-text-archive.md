# 2026-09-19 — 크롬 확장 긴 글 보관 보완

- Date: 2026-09-19
- Jira: None
- Status: 0.3 installation/execution reported by user; 0.4 follow-up implemented and locally tested; installed 0.4 reload/E2E pending

## Goal

사용자가 위임한 브라우저 수집 경로를 실행 가능한 확장으로 보완하고 @hongso0921의 알려진 긴 첨부를 실제 원문과 대조한다. 확보한 글은 탭 종료 후에도 남기며, 전체 과거 수집 여부는 별도로 보고한다.

## Non-goals

Meta 검수, 유료 수집기 추가 실행, 비공개 API·쿠키 접근, 전체 과거 이력 보장, 원글/후속글의 추측 결합.

## Context / Constraints

- 원본 저장소 main의 미커밋 46개 상태를 보존하고 origin/main 기반 별도 작업 브랜치를 사용한다.
- 기존 확장 7개 파일을 복사했으며 수정 전 ZIP을 압축 해제해 SHA-256 7개 일치를 확인했다.
- 기존 repo template의 브랜치 금지보다 사용자 작업 합의의 작업 브랜치/커밋/푸시/초안 PR 요구를 따른다.
- 사용자는 방법 선택과 실행을 위임했다. 기존 확장의 제한된 보완 설계를 적용한다.
- 2026-09-19 원문 관찰: 긴 첨부 7,835자가 본문 뒤 형제 요소에 있으며 기존 parser는 66자 소개문만 읽는다.
- 후속 사용자 확인: 0.3을 설치해 실행했으나 약 35개 부근 중단과 프로필에 일부만 보이는 연속글 누락을 보고했다. 0.4는 상세 페이지 탐색과 일시 연결 실패 복구를 보완한다.

## Approach (Checklist)

- [x] **Step 0: Recon** — 기존 소스와 실제 원문 DOM, 이전 수집 실패, Git 상태 확인.
- [x] **Step 1: Implementation** — reader 긴 첨부/순번, 저장소 IndexedDB, ack 뒤 스크롤, 실행 ID, JSON v2/Markdown 내보내기.
- [x] **Step 2a: Tests** — 0.3 당시 56개 통과. 합성 DOM 회귀, 저장소 원자성/복구/중복/오래된 메시지, 실제 원문 첨부 7,835자·62 LF 문자열 일치 확인. 후속 0.4 구현 후 로컬 `npm test` 90개 통과.
- [x] **Step 2b: Browser installation (0.3)** — 도구의 chrome://extensions 접근은 URL 정책에 의해 차단됐으나, 이후 사용자가 직접 설치해 실행을 확인했다. 이 확인은 0.4 실행 증거가 아니다.
- [ ] **Step 2c: 0.4 reload / E2E** — 기존 설치 폴더 `deliverables/threads-text-archive-0.3.0`와 확장 ID를 유지해 갱신 후 재로드해야 한다. 브라우저 재연결 후 실제 상세 페이지 두 곳에서 각 12개 연속글을 확인했다. 0.4 reader와 같은 본문 읽기 로직의 읽기 전용 실행으로 24개 번호·본문을 추출하고, 서비스 배지를 제외한 페이지 문단과 공백·줄바꿈 일치를 확인했다. 설치된 0.4의 전체 실행 검증은 남아 있다.
- [x] **Step 3: Rollout / Rollback** — 압축해제 확장 설치 경로와 결과 기록, 별도 커밋/푸시/[초안 PR #2](https://github.com/optimin1109/threadcrawl/pull/2).

## Validation

- **Commands to run:** npm run test:extension; npm test; git diff --check; 원본 상태 비교.
- **Expected output:** 확인한 첨부·본문 보존, 번호가 붙은 연속글의 상세 탐색 후 프로필 복귀, 복구 후 확정 데이터 유지, 누락 번호·충돌의 명시적 불완전 상태. 전체 이력이나 실사용 12/12 확보를 뜻하지 않는다.
- 현재 activeTab/scripting/storage 권한을 유지한다. 페이지의 보안/로그인 안내 시 중단한다.
- 숨긴 탭은 수집을 기다리며 진행하려면 수집 탭을 앞에 둔다. 일시 연결 실패는 대기하고 탭 복원·활성화 이벤트에서 제한적으로 복구한다. 닫은 탭은 사용자가 다시 열고 시작한다.
- 작성일 최솟값·최댓값은 고정 글을 포함한 관찰 범위이며 사이 글의 확보율이 아니다. 반복 관찰 횟수와 저장된 고유 게시물 수를 구분한다.

## Risks & Rollback

- **Risks:** 페이지 구조 변경, 웹이 제공하는 목록 한계, 숨은 후속글. 상세 페이지에서 프로필로 돌아올 때 저장 위치를 사용하지만, 수동 재시작의 정확한 스크롤 위치 복원과 전체 백업을 보장하지 않는다.
- **Rollback steps:** 갱신 전 JSON을 내보내고 기존 설치 폴더·확장 ID를 유지한다. 0.4는 기존 IndexedDB 자료를 유지하며 DB 스키마를 갱신하므로, 0.3 실행 파일만 복구해 갱신된 DB를 읽는 롤백은 보장하지 않는다. 기존 저장소·이전 chrome.storage 캡처는 수정하지 않는다.
- 새 캡처는 JSON v2다. 기존 데스크톱 v1 importer 호환을 주장하지 않으며 확장에서 Markdown을 직접 제공한다.

## Open Questions

- 0.3 배포 당시 설치 폴더/ZIP의 10개 파일 해시 일치를 확인했다. 0.4 배포 검증은 후속 기록과 구분한다. 설치·재로드 안내는 [확장 README](../../browser-extension/README.md).
- 남은 확인은 설치된 0.4의 시작·상세 탐색·프로필 복귀·중지·다운로드, 숨은 추가 답글, 고정 글을 제외한 과거 도달 범위다. 로컬 시험 통과나 페이지의 12개 글 존재만으로 실제 완전 수집을 주장하지 않는다.
