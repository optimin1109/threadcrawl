# Threads 앱 검수 준비 자료 — 2026-09-19

## 판단과 다음 행동

**현재 개인 보관 도구를 그대로 제출할 단계는 아니다.** 공식 권한 문서는 `threads_profile_discovery`의 허용 용도를 공개 계정의 경쟁업체 분석으로 설명한다. 개인적인 자료 보관이 허용되는지 확인하지 못했으므로, 경쟁 분석 서비스라고 바꿔 쓰지 않는다. 먼저 아래 용도 적합성 문의 문안을 검토하고, 적합성이 확인된 뒤 OAuth와 심사용 배포물을 구현하는 순서가 타당하다. [공식 권한 참고 자료](https://developers.facebook.com/documentation/development/permissions)

이 문서는 제출할 자료의 **내부 검토 초안**이다. Meta 제출, 비즈니스 연결, 서비스 공개, 인증 API 호출은 수행하지 않았다. 정책의 세부 근거와 접근 범위는 [조사 기록](APP-REVIEW-RESEARCH-2026-09-19.md), 이동본 검사 결과와 소스 식별은 [검증 기록](HANDOFF-VERIFICATION-2026-09-19.md)에 있다.

## 현재 앱에서 직접 확인한 상태

2026-09-19 Chrome으로 현재 앱의 대시보드·인증·앱 검수 화면을 읽었다.

| 항목 | 이번에 관측한 내용 | 의미 |
|---|---|---|
| 앱 상태 | 개발 중, 게시되지 않음 | 공개 서비스로 전환되지 않았다 |
| 인증 | 앱을 관리할 비즈니스 포트폴리오 연결 안내 | 연결·인증 완료 증거가 없다. 사용자가 사업자를 보유하지 않았다는 뜻은 아니다 |
| 앱 검수 | 제출되지 않음, 제출 항목 없음 | 신청·심사·승인 모두 완료로 볼 수 없다 |
| 기존 토큰 | 이번에는 읽거나 재발급하지 않음 | 9월 13일 토큰 유효성을 현재로 연장하지 않는다 |

앱 화면은 계정 접근이 필요한 관측 자료이며 이번 GitHub 문서에는 앱 ID, 연락처, 계정 자격 증명을 포함하지 않는다. 과거 `code 10 / subcode 4279067`은 권한 거부 관측값이며 특정 정책 하나의 전용 오류 코드로 해석하지 않는다.

## 제출 전에 해결할 항목

| 우선순위 | 조건 | 현재 상태 | 완료 증거 |
|---|---|---|---|
| 1 | 개인 보관 용도 적합성 | 공식 허용 용도에 명시되지 않음 | 실제 기능·보존 방식에 대한 Meta의 적용 안내 또는 명확한 공식 근거 |
| 2 | 앱별 비즈니스 인증 | 포트폴리오 연결 안내만 표시 | 실제 대시보드의 요구사항 및 인증 결과 |
| 3 | OAuth와 계정 연결 | 외부 발급 토큰을 입력하는 GUI만 있음 | 요청 권한을 보여주는 로그인·동의·계정 연결의 실제 실행 |
| 4 | 심사자가 실행할 수 있는 배포물 | 이동본은 로컬 실행 가능, 심사용 전달 경로 없음 | Windows 패키지·설치/실행 안내·검수자 접근 경로 재현 |
| 5 | 공개 게시물 검색 시연 | 목표 계정 성공 이력 없음 | 허용된 시험 계정의 실제 API 성공 및 화면/결과 대조 |
| 6 | 읽을 수 있는 보관 결과 | API 응답 분류가 미확정일 수 있음 | 실제 필드로 원글·답글·인용을 검증하고 결과를 표시 |
| 7 | 개인정보·삭제·연락처 | 아래 기술 초안만 작성 | 확정한 운영 주체/연락처, 실제 제공 URL, 데이터 처리 질문과 일치 |

OAuth 시연과 권한 사용 설명은 [권한 참고 자료](https://developers.facebook.com/documentation/development/permissions), 검수자 접근·설정·화면 녹화는 [제출 안내](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review/submission-guide)를 기준으로 정리했다. 앱이 자신만 사용하는 경우의 일반 예외를 `/profile_posts`의 표준 접근 제한을 없애는 근거로 쓰지 않는다.

## 용도 적합성 문의 문안 — 미전송

공식 개발자 지원 채널에서 문의할 때 사용할 사실 설명이다. 자동 발송하거나 신청 양식에 입력하지 않았다.

> I am developing a Windows desktop tool for an individual's private reading and archival of posts from a specified public Threads account. It uses the official profile_posts endpoint, stores API responses and pagination checkpoints locally, and exports text where the post type can be verified. It does not currently provide competitor analysis, publish content, or redistribute the archive as a service. The permissions reference describes competitor analysis as the allowed usage of threads_profile_discovery. Is this private archival use eligible for that permission? If so, what business-verification and desktop-app review requirements apply, and what retention/deletion conditions must this use satisfy?

확인하고 싶은 사항은 개인 보관 허용 여부, 이 앱의 인증 자격, 데스크톱 검수 방식, 보존·삭제 조건이다. 토큰이나 실제 수집한 게시물 전문은 문의에 첨부하지 않는다.

## 앱 설명 초안 — 현재 기능에 한정

**한국어:** 사용자가 지정한 공개 Threads 계정의 글을 개인 PC에서 보관하는 Windows 도구입니다. 공식 API에서 반환된 페이지와 수집 위치를 로컬 데이터베이스에 저장하고 중단한 작업을 이어갑니다. 원글·답글 등의 관계가 확인된 항목을 텍스트 문서로 내보내며, 확인되지 않은 항목은 별도 기록으로 남깁니다. 전체 과거 이력의 누락 없는 수집은 아직 검증하지 못했습니다.

**English:** This Windows desktop tool helps an individual retain posts from a specified public Threads account on their own computer. It stores returned API pages and pagination checkpoints locally so an interrupted collection can resume. Records with verified post classification can be exported as text, while unresolved records remain separately recorded. Complete historical coverage has not been verified.

`threads_profile_discovery`가 필요한 기술적 이유는 연결 사용자 이외의 공개 프로필 게시물 목록 조회다. `threads_basic`은 해당 엔드포인트와 discovery 권한의 기본 요구다. **이 기술적 필요가 허용 용도 충족을 뜻하지 않는다.** 게시·답글 작성·인사이트·원격 게시물 삭제 권한은 현행 읽기 기능에 추가하지 않는다. `threads_basic` 설명에 아직 없는 본인 프로필 표시 기능을 있다고 적지 않는다.

## 심사 시연 대본과 현 구현의 차이

| 순서 | 검수 영상에서 보여줄 내용 | 지금 가능한지 |
|---|---|---|
| 1 | 검수용 Windows 패키지 실행, 앱 목적 설명 | 로컬 이동본 가능; 심사용 배포 경로 미준비 |
| 2 | Threads OAuth 로그인, 두 권한 동의, 계정 연결 | 미구현; 토큰 붙여넣기로 대체했다고 주장하지 않음 |
| 3 | 허용된 공개 계정 입력 및 실제 게시물 검색 | 코드 존재, 실제 성공 미검증 |
| 4 | 요청 결과·원문과 표시 결과 대조 | 원본 보존 경로 존재, 분류·표시 검증 필요 |
| 5 | 중지·재개와 보관 위치 확인 | 합성 데이터로 검증됨; 실제 재개는 별도 확인 |
| 6 | 로컬 데이터 삭제 안내와 연결 권한 관리 설명 | 수동 파일 삭제 안내만 가능; 앱 내 해제 기능 없음 |

한국어 UI는 영어 자막으로 버튼과 동작을 설명한다. 공식 안내의 1080 이상 화면 녹화 및 권한별 실제 사용 장면 요구를 적용한다. 토큰·개인 계정 비밀번호·개인 연락처가 노출되지 않도록 녹화 범위를 정한다. 합성 데모는 저장·복구 기능의 보조 증거이며 API 권한 시연 영상으로 제출하지 않는다.

소스에서는 `is_reply`를 요청하지 않고, 명시적으로 `false`인 응답만 원글 또는 인용으로 분류한다. 따라서 API가 성공해도 `unknown`으로 남아 Markdown 본문이 비어 있을 수 있다. 이는 원글이라고 추정하지 않도록 만든 현재 동작이다. 심사를 위해 임의로 모든 응답을 원글로 처리하지 않는다. 실제 응답과 공식 계약을 확인한 뒤 분류·표시 방식을 별도 설계한다.

## 개인정보·로컬 삭제 안내 기술 초안

아래는 `Start-Paged.cmd`의 공식 API 모드에 대한 기술 설명이다. 운영 주체, 연락처, 적법한 보존 기준과 요청 처리 기한은 아직 확정하지 않았으므로 **그대로 공개할 개인정보처리방침은 아니다.** OAuth나 서버를 추가하면 데이터 흐름을 다시 검토해야 한다.

- **입력과 통신:** 대상 계정명, 출력 위치, 사용자가 발급받은 액세스 토큰을 입력한다. API 요청은 Meta에 전달된다. 토큰은 GUI 메모리와 수집 자식 프로세스 환경에서 사용하며 프로그램이 결과 파일에 의도적으로 기록하지 않는다. 사용자 설정 환경변수가 있다면 그 수명은 사용자가 관리한다.
- **로컬 저장 항목:** 게시물 본문 외에 ID, 계정명, 게시 시각, 링크, 미디어 종류 등 요청 메타데이터, 정제한 페이지 원본, 페이지 커서, 분류 결과, 오류·충돌 기록을 저장한다. 이 API 경로에는 미디어 파일 다운로드 기능이 없다.
- **저장 장소:** 선택한 출력 폴더의 `<account>/paged/<source hash>/` 안에 SQLite, Markdown, `unresolved.jsonl`, `collection-report.json`이 있다. 별도로 `%TEMP%/threads-paged-run-<guid>/`에 진행 정보와 중지 요청 파일이 생성된다. 진행 정보에는 계정명, 커서, 출력 경로, 보고서 일부가 포함될 수 있다.
- **보존과 보호:** 일반 로컬 파일이며 앱 차원의 암호화·자동 보존 기한·자동 삭제는 없다. 사용자가 선택한 폴더가 클라우드 동기화 대상이면 해당 서비스가 복사할 수 있으므로, 모든 사본이 PC에만 있다고 보장하지 않는다.
- **삭제 방법:** 수집을 중지하고 프로그램을 닫은 뒤 삭제하려는 계정·수집 방식의 전체 폴더를 확인한다. 해당 폴더 전체와 그 작업의 임시 폴더를 사용자가 삭제하며 SQLite 동반 파일이 남지 않게 한다. Markdown만 삭제하면 원본은 남는다. 별도로 만든 백업·동기화 사본도 확인한다. 이 문서를 작성하면서 실제 자료를 삭제하지 않았다.
- **권한 해제:** 로컬 파일 삭제와 Meta에서의 앱 권한 철회는 별개다. 현재 프로그램에는 권한 철회 버튼이 없다. 확정 안내에는 해당 앱에 적용되는 Meta의 현행 해제 경로를 추가해야 한다.
- **기존 경로:** 이전 Chrome 확장과 브라우저 캡처 기능까지 배포할 경우 확장 저장소, 내려받은 캡처 JSON, 전용 Chrome 프로필도 포함한 별도 데이터 안내가 필요하다.

## 적합성이 확인된 뒤의 구현 순서

1. 실제 운영 주체와 앱별 인증 요건을 확인한다. 비즈니스가 없는데 있는 것처럼 작성하지 않는다.
2. 검수에 필요한 최소 OAuth 구조를 설계한다. 공식 코드 교환은 앱 비밀값을 요구하므로, 배포하는 Windows 코드에 비밀값을 내장하는 방식을 선택하지 않는다. 안전한 교환 구조와 운영 비용은 구현 전에 검토한다.
3. 지원 필드와 실제 응답에 따라 분류·표시를 검증하고 심사용 실행 패키지를 만든다.
4. 운영 정보가 확정된 개인정보·삭제 안내와 권한별 설명, 재현 가능한 실제 시연 영상을 정리한다.
5. 구체적인 최종 제출물을 검토한 뒤 별도 승인 범위에서 제출한다. 이 문서 PR을 머지해도 Meta 검수가 제출되거나 승인되지는 않는다.

개인 보관 적합성이 확인되지 않으면 공식 API 승인을 해결책으로 확정하지 않는다. 기존 수집/가져오기 경로와 계정 소유자 제공 자료를 비교할 수 있지만, 어느 경로도 아직 완전성을 입증하지 못했다.
