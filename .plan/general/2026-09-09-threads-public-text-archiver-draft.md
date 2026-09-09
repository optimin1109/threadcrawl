# 2026-09-09 — Threads 공개 계정 텍스트 보관 프로그램 초안

- Date: 2026-09-09
- Jira: None
- Status: Draft

## Goal

Windows 비전문가가 더블클릭으로 실행할 수 있는 PowerShell/WinForms 데스크톱 초안을 만들고, fixture 기반 수집부터 분류·중복 제거·정렬·Markdown·상태·보고서·중단/이어받기까지 한 흐름으로 검증한다.

## Non-goals

- 검증되지 않은 Threads DOM 또는 비공개 API를 이용한 실서비스 스크래핑
- CAPTCHA, 로그인 확인, 보안 확인 또는 접근 제한 우회
- 사용자의 기존 Chrome 프로필·쿠키·비밀번호 재사용
- 미디어 다운로드, 다중 계정 병렬 처리, 예약 실행

## Context / Constraints

- 저장소는 요구사항 문서만 있는 초기 상태이며 Git 저장소가 아니다.
- `.agents/docs/project.md`에는 사전 정의된 기술 스택이나 명령이 없다.
- 현재 환경에는 Python, .NET SDK, npm이 없고 Node 실행 파일과 PowerShell 7은 확인되었다.
- Windows 기본 구성과 유지보수성을 위해 외부 런타임 설치가 필요 없는 PowerShell 5.1 호환 코드와 WinForms를 사용한다.
- 공식 Meta Postman 문서에는 OAuth 기반 공개 프로필/게시물 조회가 있으나, 전체 과거 범위 및 요구 도메인 관계를 모두 확정할 근거가 부족하다.

## Approach (Checklist)
- [x] **Step 0: Recon** (요구 문서, 저장소 상태, 실행 환경, 공식 Meta 자료 확인)
- [ ] **Step 1: Implementation** (`src/` 수집 소스 계약·도메인·상태/보고서·GUI, fixture, 스키마, 실행 스크립트)
- [ ] **Step 2: Tests** (네트워크 없는 PowerShell 테스트와 GUI 수동 실행 확인)
- [ ] **Step 3: Rollout / Rollback** (설치/실행·제거 방법, 실제 수집 제한, 인수 대응표 문서화)

## Validation
- **Commands to run:** `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\run-tests.ps1`; PowerShell 구문 검사; GUI 시작 후 계정/폴더/시작/중지/상태 표시 수동 확인
- **Expected output:** 모든 결정적 테스트 통과, fixture 실행 시 계정별 Markdown/state/report 생성, 실제 Threads 모드는 성공을 주장하지 않고 `불완전` 보고

## Risks & Rollback
- **Risks:** Threads 공개 웹/API 동작 변화, PowerShell 실행 정책/Chrome 설치 차이, 실제 DOM 관계 정보 미검증, fixture와 실서비스 간 차이
- **Rollback steps:** 새로 추가한 프로그램 파일과 문서만 제거한다. 기존 요구사항 문서는 보존한다.

## Open Questions

- 공식 `profile_posts`의 과거 보존 범위·페이지네이션 상한과 모든 공개 계정에 대한 사용 조건은 실제 앱 권한/서비스 검증이 필요하다.
- 묶음, 리포스트, 인용, 긴 텍스트의 읽기 필드가 요구 판정에 충분한지는 공식 응답 예시와 실제 계정 표본으로 추가 확인이 필요하다.
