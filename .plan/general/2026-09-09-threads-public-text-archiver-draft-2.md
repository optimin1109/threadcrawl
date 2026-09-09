# 2026-09-09 — Threads 공개 계정 텍스트 보관 프로그램 실행 가능한 초안

- Date: 2026-09-09
- Jira: None
- Status: Implemented (fixture scope; live collection unavailable)

## Goal
계정 입력부터 Markdown, 상태, 보고서까지 Windows 데스크톱의 최소 수직 기능을 구현한다.

## Non-goals
미확인 DOM/비공개 API 추측, 인증 우회, 브랜치/커밋/PR, 웹 서버.

## Context / Constraints
기존 구현 없음. Git 저장소 아님. Node 24.16.0, Windows PowerShell 사용 가능, .NET SDK 없음.
기존 계획 파일은 보존한다. 이번 실행의 선택은 PowerShell WinForms GUI + Node 22 이상 표준 라이브러리 코어다.
별도 패키지 없이 테스트 가능하고 UI 스레드와 수집 프로세스를 분리할 수 있다. Node 설치가 필요한 점은 배포상 절충이다.

## Approach (Checklist)
- [x] **Step 0: Recon** 요구 문서 전체 및 공식 Meta 자료 확인
- [x] **Step 1: Implementation** 수집 계약, 도메인, 원자적 상태 저장, 보고서, GUI, fixture
- [x] **Step 2: Tests** Node 테스트 26개 통과, GUI 시작/중지/이어받기/최종 상태 smoke 및 스냅샷 확인
- [x] **Step 3: Rollout / Rollback** 설치 안내, 인수 24개 항목별 상태와 미확인 사항 기록

## Validation
- **Commands to run:** `node --test tests/*.test.mjs`, `node src/cli.mjs --account demo_account --output output --source demo`, PowerShell GUI smoke
- **Expected output:** 결정적 테스트 통과, 세 결과 파일 생성, 실서비스 골격은 불완전

## Risks & Rollback
- **Risks:** 실제 Threads 접근 범위 미검증, Windows 정책/Node 설치, 저장 도중 중단
- **Rollback steps:** 추가한 프로그램 파일만 제거. 사용자 출력은 별도 보존.

## Open Questions
공개 API의 과거 범위, 묶음 동시 작성 증거, 리포스트 시점, 긴 첨부 읽기와 로그인별 범위.
