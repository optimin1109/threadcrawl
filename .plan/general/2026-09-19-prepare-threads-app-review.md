# 2026-09-19 — Threads 앱 검수 준비

- Date: 2026-09-19
- Jira: None
- Status: 검토용 자료 작성 완료

## Goal

이동본의 다음 과제인 공식 API 앱 검수 준비를 이어간다. 현행 1차 출처와 실제 코드에 근거해 개인 보관 용도의 적합성, 신청 자료 초안, 시연 순서, 제출 전 해결할 항목을 검토 가능한 문서로 만든다.

## Non-goals

검수 제출, 서비스 공개, 권한 변경, 유료 API 호출, 운영 데이터 수집, 전체 보관 성공 선언. 이전 미커밋 구현의 커밋이나 원본 수정도 이번 문서 작업 범위에 포함하지 않는다.

## Context / Constraints

원격 main의 기준 커밋은 `1ab3133`이다. 같은 커밋 위의 이동본에는 이후 페이지 수집 구현과 진단 문서가 미커밋 상태로 존재한다. 원본은 보존하고 `codex/app-review-preparation-2026-09-19` worktree에서 이번 문서만 관리한다. 인계문서의 과거 Git 게시 금지와 저장소 템플릿의 브랜치 생성 제한은 이번 사용자의 명시적 작업 브랜치·push·draft PR 지시로 대체한다.

## Approach (Checklist)

- [x] **Step 0: Recon** — 인계문서, 프로젝트 규칙, Git 상태, 원격 기준, 이전 권한 진단 확인.
- [x] **Step 1: Implementation** — 공식 검수 요건 조사와 소스 준비도 대조; 신청 설명과 심사 시연 자료 초안 작성.
- [x] **Step 2: Tests** — 이동본 1,337개 해시 일치·92개 로컬 검사 통과. 실제 API 성공은 검증하지 않음.
- **Step 3: Rollout / Rollback** — 이번 문서만 커밋·push·draft PR로 전달한다. 원본의 46개 status 항목 보존을 확인했다. 문서 커밋 revert로 되돌릴 수 있으며 게시 후 원격 상태는 PR과 최종 보고에서 확인한다.

## Validation

- **Commands to run:** 이동본 `runtime/node.exe --test --test-concurrency=1 tests/*.test.mjs` (별도 TEMP/TMP); manifest SHA-256 확인; `git diff --check`; 신규 문서 내부 링크 검사; staged diff 검토; 원격 branch/PR/CI 확인.
- **Expected output:** 로컬 테스트 통과는 인증/API 승인 및 전체 보관 성공과 분리한다. 현재 문서 접근이나 앱 로그인 접근이 실패하면 날짜와 확인 범위를 기록한다.

## Risks & Rollback

- **Risks:** 개인 보관이 허용 용도인지와 앱별 제출 요건이 아직 확인되지 않았다. 이전 앱 화면을 현재 화면으로 오인하지 않는다. 현재 미커밋 실행 코드는 이 문서 PR에 포함되지 않는다.
- **Rollback steps:** 이번 문서 커밋만 revert; 원본 이동본의 이전 변경과 자료는 유지.

## Open Questions

- 현재 앱은 비즈니스 포트폴리오 연결 안내·검수 미제출 상태다. 개인 보관이 공식 허용 용도에 해당하는지, 개인 인증 대체가 가능한지는 미확인이다.
- OAuth·실제 API 표시·검수용 배포·운영 정보가 남았다. 구현 전 [검수 준비 자료](../../docs/APP-REVIEW-PREPARATION-2026-09-19.md)의 문의 문안과 조건을 검토한다.
