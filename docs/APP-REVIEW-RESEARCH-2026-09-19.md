# Threads 앱 검수 준비 조사 — 2026-09-19

## 결론

**현재 개인용 공개 글 보관 도구가 `threads_profile_discovery`의 허용 용도에 맞는지부터 해결해야 한다.** Meta의 현행 권한 문서는 이 권한을 공개 프로필·게시물을 통한 **경쟁사 분석** 용도로 설명한다. 사용자의 목적은 공개 계정 글을 빠짐없이 개인 PC에 보관하는 것이다. 이 목적의 허용 여부는 공식 문서에서 확인하지 못했다. 실제로 제공하지 않는 경쟁사 분석을 신청서에 적어서는 안 된다. 이는 승인 불가의 확정 판정이 아니라 현재 목적과 명시된 허용 용도 사이의 차이다. [Meta — Permissions](https://developers.facebook.com/documentation/development/permissions)

오늘 실제 앱은 개발 중·미게시, App Review 미제출이며 제출 항목이 비어 있다. 인증 패널에는 앱을 관리할 비즈니스 포트폴리오 연결 요청이 표시되며, 연결된 인증 완료 비즈니스는 표시되지 않았다. 현재 프로그램에는 검수 영상에 필요한 앱 내부 OAuth 흐름도 없다. 자료 초안을 준비하는 것과 제출 가능한 상태가 되는 것은 다르다.

## 확인 방법과 범위

기준일은 2026-09-19이다. 공식 문서·Meta 공식 Postman 자료만 정책 및 API 근거로 사용했다. 주 작업 에이전트의 **당일 브라우저 직접 관측**과 조사 에이전트의 웹·로컬 파일 확인을 합쳤다. 문서 표시 갱신일은 당일 관측일과 구별한다.

| 1차 출처 | 이번 확인 방법·문서 표시 갱신일 | 확인 범위 |
|---|---|---|
| [Permissions](https://developers.facebook.com/documentation/development/permissions) | 주 작업 에이전트 브라우저, 2025-12-05 | 허용 용도·권한 의존성·영상·일반 검수 조건 |
| [Business Verification](https://developers.facebook.com/documentation/development/release/business-verification) | 주 작업 에이전트 브라우저, 2023-07-07 | Advanced Access와 인증된 비즈니스 연결 |
| [Retrieve Posts](https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts) | 주 작업 에이전트 브라우저, 2026-04-14 | 공개 계정 조회의 접근·팔로워·요청 제한·필드 |
| [App Review Submission Guide](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review/submission-guide) | 주 작업 에이전트 브라우저, 2026-06-30 | 실행·테스트 지침·앱 자료·권한별 호출 및 영상 |
| [Meta 공식 Postman](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api) | 조사 에이전트 웹 도구 | OAuth와 endpoint 예제 |
| 실제 앱의 검수·인증 패널 | 주 작업 에이전트 당일 브라우저, 읽기만 수행 | 개발 중·미게시·미제출·비즈니스 연결 요청 |

웹 도구에서는 Meta 개발자 문서 일부가 HTTP 429 또는 접근 불가였다. 이를 문서 삭제·정책 부재로 해석하지 않았고, 위 항목은 주 작업 에이전트의 공식 사이트 브라우저 확인으로 보완했다. 검색에 잡힌 제3자 복사본은 근거에서 제외했다. 이번 조사에서 실제 토큰, 토큰과 앱 ID 일치, 목표 계정 현재 조건, 실제 API 성공은 확인하지 않았다. 인증 호출·권한 변경·검수 제출·외부 게시도 수행하지 않았다.

## 권한과 접근 조건

현재 조회 기능의 최소 신청 후보는 `threads_basic`과 `threads_profile_discovery`다. 후자는 전자를 의존성으로 요구한다. 발행·답글 작성·관리·분석 지표·키워드 검색·원본 삭제 권한을 추가할 근거는 현재 기능에 없다. 두 권한만 신청하면 승인된다는 의미는 아니다. [Meta — Permissions](https://developers.facebook.com/documentation/development/permissions)

공식 Postman의 scope 변수는 컬렉션 전체 기능을 위한 예제이므로 그대로 복사하지 않는다. 로컬 보관 파일을 지우는 기능과 Threads 원본 게시물을 지우는 기능도 구분한다. [Meta 공식 Postman — 예제 scope](https://www.postman.com/meta/threads/request/k46c8l0/get-app-scoped-user-s-profile-information)

오늘 다시 읽은 `/profile_posts` 문서의 조건은 다음과 같다. [Meta — Retrieve Posts](https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts)

- Standard Access로 조회 가능한 대상은 `@meta`, `@threads`, `@instagram`, `@facebook` 등 일부 Meta 공식 계정이다.
- 공개 프로필의 팔로워는 100명 이상이어야 한다.
- 사용자는 연속 24시간 기준 최대 1,000회 요청할 수 있다.
- 앱 연결 사용자 목록과 같은 필드를 지원하되 `owner`는 제외한다.

토큰에 scope가 있는 것, 앱의 권한 접근 수준, 대상 계정 조건, 실제 성공은 별개다. 일반 문서의 앱 역할 사용자 관련 예외를 공개 계정 endpoint의 Standard 제한을 없애는 근거로 사용하지 않는다. [Meta — Business Verification](https://developers.facebook.com/documentation/development/release/business-verification), [Meta — Retrieve Posts](https://developers.facebook.com/documentation/threads/retrieve-and-discover-posts/retrieve-posts)

9월 13일의 실제 실패는 `code 10 / subcode 4279067`, 0개·0페이지였다. 당시 사용자 디버거 화면에서는 토큰 유효성과 두 scope를 확인했으나, 토큰과 앱 ID 일치는 미검증이었다. 세부 코드 4279067을 검수 미승인 전용 코드로 정의하는 공식 근거는 찾지 못했다. 이 기록은 오늘의 토큰 상태나 수정 후 API 성공을 입증하지 않는다. 근거는 이동본의 미커밋 `docs/API-PERMISSIONS-2026-09-13.md`, `docs/API-DIAGNOSTICS-2026-09-13.md`이며 이번 문서 PR에는 포함하지 않는다. [이동본 범위](HANDOFF-VERIFICATION-2026-09-19.md)

## 사업자 인증과 개인 개발자

현행 권한 안내는 Advanced Access 신청에 Business Verification을 요구하며, 인증 안내는 앱과 인증된 비즈니스의 연결을 설명한다. 따라서 개인용 도구라는 이유만으로 생략 가능하다고 안내할 수 없다. [Meta — Permissions](https://developers.facebook.com/documentation/development/permissions), [Meta — Business Verification](https://developers.facebook.com/documentation/development/release/business-verification)

반대로 모든 개인 개발자가 신청 불가하다는 결론도 내리지 않는다. 개인 인증이 이 Threads 권한에서 대체 경로인지, 등록된 개인사업자의 어떤 증빙이 필요한지, Tech Provider/Access Verification까지 적용되는지는 아직 확인되지 않았다. 실제 앱 패널은 비즈니스 포트폴리오 연결을 요청하지만 개인 인증 대체 경로를 확인한 증거는 없다. 다른 API의 과거 개인 인증 사례를 일반화하지 않는다.

목적의 허용 여부를 먼저 확인하고 실제 앱에 요구되는 인증 종류를 읽어야 한다. 이 조사만으로 사업자 등록·유료 서비스·도메인 구입을 권하지 않는다.

## OAuth와 심사 자료

권한별 영상은 앱에서의 전체 Threads OAuth 동의, 계정 연결 및 요청 권한, 공개 프로필 또는 게시물 검색을 보여 줘야 한다. 수동 토큰 입력과 저장 결과만으로는 이 요구가 충족되지 않는다. [Meta — Permissions](https://developers.facebook.com/documentation/development/permissions)

Meta 공식 Postman은 사용자 승인과 authorization code 교환을 안내하며 `client_id`, `client_secret`, `code`, 동일한 `redirect_uri`를 사용한다. 이를 배포용 데스크톱 도구에 추가하려면 callback과 비밀값 취급까지 설계해야 한다. **앱 비밀값을 배포 파일에 넣는 방식으로 해결해서는 안 된다는 것은 이 구조에서의 보안 설계 판단**이다. 특정 네이티브 OAuth 방식이 Meta에서 승인된 것으로 확인한 것은 아니다. [Meta 공식 Postman — Authorization](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api)

현재 이동본은 GUI의 가려진 입력칸 또는 환경변수로 토큰을 받아 자식 프로세스에 전달한다. 인증 발급 화면은 구현하지 않았다. 따라서 OAuth 구현·시연은 남은 작업이다. [소스 확인 및 버전 식별](HANDOFF-VERIFICATION-2026-09-19.md)

오늘 읽은 제출 안내에서 이 도구에 관련되는 준비 항목은 다음과 같다. [Meta — App Review Submission Guide](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review/submission-guide)

| 항목 | 제출 전 준비 내용 |
|---|---|
| 심사자 접근 | 실제 앱을 실행·시험할 수 있는 경로와 구체적인 단계별 안내 |
| 앱 정보 | 연락처, 개인정보 처리방침 URL, 1024×1024 아이콘 |
| 권한별 증거 | 실제 권한 사용 설명·시연과 성공한 API 호출 기록. 호출 기록 반영에는 지연이 있을 수 있음 |
| 영상 | 실제 OAuth 및 요청 권한을 포함하는 1080p 이상 녹화. 한국어 화면은 영어 자막을 준비하며 음성은 필수 아님 |
| 시험 자료 | 개인 계정 로그인 자격 증명을 제출 자료에 노출하지 않는 심사자 테스트 경로 |

웹앱 전환이 반드시 필요하다거나 Windows ZIP과 영상만으로 충분하다고 단정하지 않는다. 현재 프로그램을 심사자가 실행할 구체적인 경로가 아직 없으며, 실제 제출 양식과 대조해야 한다. 합성 데모는 저장·재개 시험 자료로 사용할 수 있으나 실제 API 성공 증거를 대신하지 않는다.

## 개인정보·삭제와 보관 범위

개인정보 안내는 실제 데이터 흐름과 일치해야 한다. 조회 필드, 로컬 SQLite와 내보내기 파일, 인증·API 통신, 운영자의 데이터 수신 여부, 보관 기간, 연락처를 명시할 수 있는 초안부터 준비한다. “서버에 저장하지 않음”과 “어디에도 저장하지 않음”은 다르다. [현재 데이터 흐름 초안](APP-REVIEW-PREPARATION-2026-09-19.md), [Meta — 개인정보 URL 제출 항목](https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review/submission-guide)

로컬 자료·내보낸 복사본의 삭제 방법, 원저자나 플랫폼의 삭제 요구 처리도 설계해야 한다. 삭제된 글을 영구 보존해도 된다고 가정하지 않는다. 다만 이번 조사에서는 [Meta Platform Terms](https://developers.facebook.com/terms/) 본문을 직접 읽지 못했다. 따라서 특정 삭제 기한, 공개 삭제 URL 또는 callback의 의무를 확정하지 않는다. 운영자·주소가 비어 있는 초안은 제출용 최종 개인정보 문서가 아니다.

## 전체 이력 검증의 한계와 다음 순서

공식 Postman에는 공개 프로필 `/profile_lookup`, 공개 글 `/profile_posts`, 별도 앱 연결 사용자 목록 `/me/threads`가 있다. 마지막 endpoint의 “all” 설명을 임의 공개 계정의 평생 전체 글 보장으로 옮겨 해석하지 않는다. 컬렉션은 최신 기능을 모두 반영하지 않을 수 있다고 자체 안내한다. [Meta 공식 Postman — 공개 프로필·글 조회](https://www.postman.com/meta/threads/documentation/dht3nzz/threads-api?entity=request-34203612-116161fc-75af-4a09-a972-66d6f64ddb10)

현재 공급자는 응답의 `paging.next`를 따라가며 `allPublicPostsVerified: false`를 유지한다. 관계를 확정하지 못한 글은 원본을 보존해도 Markdown에서 제외할 수 있다. 페이지 끝 도달, 원본 저장, Markdown 생성, 전체 무누락 검증은 서로 다른 상태다. [소스 확인 및 버전 식별](HANDOFF-VERIFICATION-2026-09-19.md)

다음 순서는 **실제 목적의 허용 여부 확인 → 앱별 인증 조건 확인 → OAuth·심사자 실행·삭제 구조 결정 → 제출물 완성 → 승인받은 제출·게시 → 실제 전체 이력 시험**이다. 승인 후에는 오래된 원문 표본, 최초·최종 시각, 종료 이유, 누락·중복, 답글·연속글·긴 첨부·리포스트, 중지·재개를 별도로 검사해야 한다. 표본 일치만으로 전체 무누락을 선언하지 않는다.

현재 차단 요인은 반복 토큰 발급이 아니라 **용도 적합성, 앱의 인증·검수 조건, OAuth와 실제 시연 부재**다. 이 보고서는 검수 제출·승인·수집 성공을 의미하지 않는다.
