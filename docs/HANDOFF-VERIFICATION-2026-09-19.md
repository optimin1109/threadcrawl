# 이동본 재개 검증 — 2026-09-19

## 범위와 결과

검증 대상은 이동본 폴더 `threads-archive-requirements/`의 **이전부터 존재한 미커밋 실행 코드**다. 이 문서 작업 브랜치는 원격 main `1ab3133e08941f73a451f210fc539a000f037799`에서 별도 worktree로 만들었으며 해당 실행 코드를 포함하지 않는다. 이 PR을 체크아웃하면 아래 92개 검사를 그대로 재현할 수 있다고 해석하지 않는다.

| 검사 | 결과 |
|---|---|
| 동봉 Node | v24.21.0 |
| 이동 manifest의 전체 항목 | 1,476개 |
| 실행 파일·소스·문서 등 SHA-256 대조 | 1,337개 일치, 불일치 0 |
| 이번 해시 대조에서 제외한 Git 메타데이터 | 139개; fetch/worktree가 변경할 수 있어 제외 |
| 원본 HEAD | 이동 기록과 일치: `1ab3133e08941f73a451f210fc539a000f037799` |
| 원본 작업 상태 | `TRANSFER-STATE.json`의 46개 status 항목과 차이 없음 |
| 원격 fetch | 성공, 원격 main도 같은 기준 커밋 |
| 전체 로컬 테스트 | 92 passed, 0 failed, 0 skipped, 약 14.73초 |
| 실제 Threads API 호출 | 수행하지 않음 |
| Meta 검수 제출·인증 변경·앱 게시 | 수행하지 않음 |
| 실제 전체 과거 글 보관 | 여전히 미검증 |

## 실행한 검사

이동본 실행 폴더에서 `runtime/node.exe --test --test-concurrency=1 tests/*.test.mjs`를 실행했다. PowerShell 프로세스의 TEMP/TMP를 새 전용 임시 폴더로 지정해 실행 중 수집 잠금과 겹치지 않게 했다. 로그는 이동본 바깥 작업 루트의 `handoff-test-2026-09-19.log`에 남겼으며 GitHub에 업로드하지 않는다.

테스트에는 Windows 실행기와 GUI 중지·재개, 페이지 수집/복구, 토큰 전달, 모의 API 오류·응답 분류 검사가 포함됐다. 실제 자격 증명을 사용하지 않았다. 합성 데이터 및 모의 응답 검증이므로 API 접근 승인이나 실제 수집 누락률·속도를 입증하지 않는다.

`TRANSFER-MANIFEST.json`의 `Path`에서 이동본 최상위 폴더 이름만 제거해 파일을 찾고 SHA-256을 대조했다. `.git/` 아래 139개 항목은 제외했다. 이는 Git 이력과 메타데이터 전체에 대한 완전한 재검증이 아니다. 기존 ZIP·manifest·실제 데이터는 수정하거나 삭제하지 않았다.

## 검토한 소스의 식별값

아래 경로와 줄 번호는 PR 기준 코드가 아니라 이동본의 미커밋 스냅샷 기준이다. 파일 해시로 다른 버전과 구분한다.

| 파일 | SHA-256 |
|---|---|
| `src/paged-gui.ps1` | `f5d1ff37bd853e231c5800af96e1e0bc5fd584065c8529486ef80718b1552435` |
| `src/paged-cli.mjs` | `d93660adc8a59a7572431bc32c317b0e28b30ce4d4818cc70d97648bee96d75f` |
| `src/paged/sources.mjs` | `9e6c9469c659ea5b11fb2c64eac4542c32efd3a9df08f361c7ef98aebbaecc48` |
| `src/paged/engine.mjs` | `a14414beb43653afb247b6b5b82a1efb98c3498977a3098f2629bb37699424ab` |
| `src/paged/store.mjs` | `16279d7df932ba5b0a86847453840dcdc7a57436644c3fd5fc15772274543960` |
| `src/domain.mjs` | `c12925a64509f346bec5ef19d386fd90f8ee6084f66c1ea5768cdfb27a91a703` |
| `tests/paged-sources.test.mjs` | `1b40697bacc5aea91394df4157f645824365a11f5aea6d543f2825ee220fe370` |
| `package.json` | `13a383bc71359d61147a7fb60ecba3419313a72343e2a19d3311ead7b4e5e40e` |

## 준비 자료의 근거가 된 코드 확인

| 확인 항목 | 이동본 위치 | 결론 |
|---|---|---|
| 토큰 입력·전달 | `src/paged-gui.ps1:33-49`, `135-140` | 가린 수동 입력과 API worker 환경 전달; OAuth 화면은 없음 |
| API 요청 필드·정규화 | `src/paged/sources.mjs:7-18`, `164-190` | `owner` 제외; `is_reply` 미요청, 명시적 false 없으면 원글로 추정하지 않음 |
| 분류 회귀 증거 | `tests/paged-sources.test.mjs:56-98` | `is_reply` 없는 응답을 unknown으로 기대 |
| Markdown 제외 | `src/domain.mjs:27-30`, `src/paged/store.mjs:282-285` | 미확정 항목이 Markdown에 없을 수 있음 |
| 원본·미확정 데이터 보존 | `src/paged/store.mjs:28-97`, `166-225`, `300-323` | SQLite와 unresolved JSONL에도 데이터가 남음 |
| 임시 파일 | `src/paged-gui.ps1:265-268`, `src/paged/engine.mjs:121-148` | 진행 파일 경로·내용도 삭제 안내에 포함 필요 |
| 전체 검증 상태 | `src/paged/engine.mjs:82-87`, `137` | 실서비스 목록 끝도 전체 검증 완료로 바뀌지 않음 |

## 문서 변경 검증과 전달 범위

이번 변경은 [검수 준비 자료](APP-REVIEW-PREPARATION-2026-09-19.md), [1차 출처 조사](APP-REVIEW-RESEARCH-2026-09-19.md), 이 검증 기록과 작업 계획이다. 소스·의존성·앱 설정은 변경하지 않았다. 문서 간 상대 링크, whitespace, staged diff와 민감정보 포함 여부를 점검하고 별도 작업 브랜치에서 전달한다. 원본 미커밋 코드, 동봉 런타임, 수집 데이터, 테스트 원본 로그는 이번 업로드 대상이 아니다.

원격 CI와 PR 상태는 실제 게시 후 최종 응답에서 별도로 보고한다. 위 92개 로컬 통과를 원격 CI 통과로 표현하지 않는다.
