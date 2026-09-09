# 구현 및 검증 기록

## 현재 결과

실행 가능한 Windows 데스크톱 초안과 로컬 수직 기능은 구현했다. **실제 Threads 계정의 완전한 백업은 현재 불가능하다.** 실제 수집기 대신 안전한 미지원 골격이 있으며 실서비스 모드는 불완전 보고서를 생성한다. fixture의 완료는 합성 데이터 범위에 한정된다.

## 변경 파일 요약

- `Start.cmd`, `src/gui.ps1`: 더블클릭 진입점, Windows 화면, 자식 프로세스·중지·이어받기 연결, 전용 Chrome 수동 조사 진입점.
- `src/cli.mjs`, `src/engine.mjs`, `src/sources.mjs`: CLI/GUI 통합 실행, 순차 수집 계약, fixture와 실제 골격, 제한적 재시도와 안전 정지.
- `src/domain.mjs`, `src/storage.mjs`: 도메인 판정, Markdown 투영, KST, 저장/스키마/잠금.
- `fixtures/demo.json`, `fixtures/partial.json`: 출처를 명시한 합성 데이터. 실서비스 HTML/JSON 표본이 아니다.
- `schemas/*.schema.json`: item/page/state/report 계약. `scripts/create-fixtures.mjs`: 재생성 도구.
- `tests/archive.test.mjs`, `package.json`: 표준 Node 테스트 및 확인 가능한 실행 설정.
- `docs/USAGE.md`, `docs/RESEARCH.md`, `docs/ARCHITECTURE.md`, `docs/ACCEPTANCE-STATUS.md`, 이 문서: 사용법·공식 근거·계약·24개 인수 항목·검증 한계.
- `.plan/general/2026-09-09-threads-public-text-archiver-draft-2.md`: 이번 실행의 계획. 기존 계획 파일과 원본 요구 문서를 보존했다.
- `.gitignore`: 실행 결과/임시 산출물 제외 설정. 현재 디렉터리는 Git 저장소가 아니며 브랜치·커밋·PR을 생성하지 않았다.

## 실행 검증

환경 확인: `node --version` → v24.16.0. Windows PowerShell 실행 파일 확인. `dotnet --info` → 런타임만 있고 SDK 없음. `git status --short` → Git 저장소 아님. 기존 실행 명령이 없어 `package.json`에 명령을 정의한 뒤 실행했다.

실행한 명령:

```powershell
node scripts/create-fixtures.mjs
node --test tests/*.test.mjs
node src/cli.mjs --account demo_account --output output --source demo
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File src/gui.ps1 -SmokeTest
```

- fixture/스키마 생성 성공.
- 최종 자동 테스트 **26개 통과, 실패 0, 건너뜀 0**. 누락 의심 지속, 위치 반복, 빈 식별자/메타데이터 거부, 확인된 빈 fixture 완료를 포함한다.
- CLI 데모: 발견 9, 저장 6, 미디어 제외 1, 답글 제외 2, 중복 1, 실패 0, `완료`, `scope=fixture`. 계정별 세 파일 생성.
- WinForms smoke: initialize, start, stop, resume, counters, complete, partial, live scaffold 통과. 최종 상태 재읽기 수정 후 재실행도 종료 코드 0. 실제 자식 프로세스를 사용했다. 실제 Chrome은 실행하지 않았다.

## 수동 확인 내용과 미실행 구분

- 생성된 GUI 스냅샷을 시각적으로 확인했다. 한국어 텍스트, 입력/폴더/모드, 시작/중지 버튼, 발견 9·저장 6, fixture 범위 완료 안내가 표시되었다. 긴 경로는 입력란에서 가로 스크롤되며 전체 경로가 한꺼번에 보이지 않는다.
- 생성된 Markdown 앞부분을 읽어 반복 제목, KST 날짜, 줄바꿈, 이모지, 원문 Markdown 기호의 이스케이프를 확인했다.
- 전체 소스와 계약을 검토했다. 실제 HTTP 호출, DOM 선택자, 비공개 API, 인증정보 읽기 코드가 없다. Chrome 버튼은 빈 전용 프로필과 공개 프로필 URL만 전달한다.
- 사람이 폴더 선택 대화상자를 조작하거나 탐색기에서 더블클릭한 것은 아니다. GUI 자동 smoke와 화면 스냅샷 확인을 사람의 전체 수동 사용 시험으로 보고하지 않는다.
- 실제 Threads 계정, API 앱/권한, Chrome 로그인, CAPTCHA 화면, 과거 글 끝, 긴 첨부 펼치기, 실제 인용/리포스트/묶음은 검증하지 않았다.
- Windows 다른 버전, 높은 DPI, 화면 읽기 도구, 조직 실행 정책, 디스크 전원 차단, 독립 EXE 배포는 미검증이다.

## 남은 위험과 우선순위

1. 공식 API 앱·권한과 실제 응답 표본을 확보하고 공개 과거 목록 종료/누락 조건을 검증한다.
2. 동시 작성 묶음과 나중 답글, 리포스트 행위 시점, 인용 own-text, 긴 첨부의 읽기 계약을 증거로 확정한다. 근거가 없으면 해당 기능을 불완전으로 유지한다.
3. API로 부족한 부분만 전용 Chrome 수집 어댑터로 연결하고 비로그인 → 필요성 안내 → 사용자 직접 로그인 → 재개를 구현한다. 보안/접근 제한 감지를 실서비스로 검증한다.
4. 비전문가를 대상으로 폴더 선택/더블클릭 사용성 및 다양한 DPI를 시험하고 Node 포함 배포/서명된 설치 프로그램을 검토한다.

세 파일 저장은 파일별 원자성만 보장한다. 강제 종료 시 재실행으로 일관성을 복구하며 실행 중 출력은 최종본이 아니다. 손상된 상태 파일을 자동 복구하는 백업 사본, 실패한 부분의 자동 보충, 대용량 데이터베이스는 없다. 현재 대상 규모용 최소 구조를 유지했다.
