# 2026-09-19 — 크롬 확장 긴 글 보관 보완

- Date: 2026-09-19
- Jira: None
- Status: Implementation verified; unpacked installation pending user action

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

## Approach (Checklist)
- [x] **Step 0: Recon** — 기존 소스와 실제 원문 DOM, 이전 수집 실패, Git 상태 확인.
- [x] **Step 1: Implementation** — reader 긴 첨부/순번, 저장소 IndexedDB, ack 뒤 스크롤, 실행 ID, JSON v2/Markdown 내보내기.
- [x] **Step 2a: Tests** — 56개 통과. 합성 DOM 회귀, 저장소 원자성/복구/중복/오래된 메시지, 실제 원문 첨부 7,835자·62 LF 문자열 일치 확인.
- [ ] **Step 2b: Browser installation** — chrome://extensions 접근이 브라우저 도구 URL 정책에 의해 차단. 우회하지 않고 사용자 설치 후 실행 확인 대기.
- [ ] **Step 3: Rollout / Rollback** — 압축해제 확장 설치 경로와 결과 기록, 별도 커밋/푸시/초안 PR.

## Validation
- **Commands to run:** npm run test:extension; npm test; git diff --check; 원본 상태 비교.
- **Expected output:** 첨부 전문 보존, 최근 수집글·후속글 누락 없는 원본 저장, 복구 후 확정 데이터 유지, 명시적 불완전 상태.
- 현재 activeTab/scripting/storage 권한을 유지한다. 페이지의 보안/로그인 안내 시 중단한다.

## Risks & Rollback
- **Risks:** 페이지 구조 변경, 웹이 제공하는 목록 한계, 상세 분류 미확정. 재시작은 저장 ID를 재사용하지만 정확한 스크롤 위치를 복원하지 않는다.
- **Rollback steps:** 새 확장 비활성화 후 검증된 이전 확장 ZIP 복구. 기존 저장소·이전 chrome.storage 캡처는 수정하지 않는다.
- 새 캡처는 JSON v2다. 기존 데스크톱 v1 importer 호환을 주장하지 않으며 확장에서 Markdown을 직접 제공한다.

## Open Questions
- 설치용 폴더/ZIP을 준비하고 압축 해제 후 10개 파일 해시 일치를 확인했다. 설치 안내는 browser-extension/README.md.
- 실제 확장 시작·중지·다운로드 E2E, 숨은 추가 답글, 고정 글을 제외한 과거 도달 범위는 미검증이다. 정확한 스크롤 위치 복원과 전체 백업을 주장하지 않는다.
