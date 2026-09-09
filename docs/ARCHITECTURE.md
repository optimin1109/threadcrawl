# 구조와 저장 계약

- `src/gui.ps1`: Windows WinForms. 단일 자식 프로세스를 실행하고 임시 JSON 진행 파일을 읽는다. 중지는 별도 신호 파일로 전달한다. 폴더 선택, 계정 입력, 상태와 개수, 최종 실패 이유를 표시한다.
- `src/cli.mjs`: GUI/콘솔 진입점. SIGINT와 중지 파일을 AbortSignal로 전달한다.
- `src/sources.mjs`: 수집 소스 인터페이스, 결정적 fixture, 명시적으로 미지원인 실제 수집 골격.
- `src/domain.mjs`: 분류, 실제 근거에 따른 묶음, 중복 처리 후 투영, Markdown 문자 보존과 날짜 정렬.
- `src/engine.mjs`: 순차 페이지 수집, 최대 3회 시도(1초/2초 지수 지연), 상태와 진행 관리, 완료 조건.
- `src/storage.mjs`: 원자적 파일 교체, 파일 동기화, 동시 수집 잠금, 스키마 검증.

## 정규화 계약

`schemas/item.schema.json`은 **앱 내부 계약**이다. Threads 응답 형식이 아니다. `id`는 논리 후보 식별자이며 단순 리포스트는 원글 식별자가 아닌 대상 계정의 리포스트 행위를 식별해야 한다. `actor`는 대상 계정의 정규화된 계정명, `kind`는 original/quote/repost/bundle/reply/unknown이다.

`timestamp`는 원글·인용의 게시 시점 또는 검증된 리포스트 시점이다. 시간대가 필요하다. 부분은 자체 `id`, `timestamp`, `text`, `label`, `orderEvidence`, `failure`를 갖는다. 원글·인용·리포스트는 부분 하나만 허용한다. 인용은 덧붙인 텍스트, 리포스트는 원글 한 개의 텍스트를 담는다. 긴 첨부는 전문 확인 후 본문과 함께 한 텍스트로 정규화한다.

최초 작성 묶음만 `bundleEvidence`를 넣는다. `label`은 서비스에서 실제 확인한 `1/N` 표현, `orderEvidence`는 그 확인 근거다. 순번이 모두 있을 때만 숫자순 재배열한다. 순번이 없으면 제공된 안정적 순서를 유지하며 `이어지는 글`만 쓴다. 알 수 있는 실패 위치는 text=null, failure=구체적 사유로 표현한다. 전체 개수로 새 부분을 만들어내지 않는다. 부분 누락/순번 충돌은 실패로 보고한다. 답글 판정 자체가 불명확하면 unknown으로 전달하며 조용히 제외하지 않는다.

각 `page`에는 items, next, end, coverageKnown, issues가 모두 필요하다. 스키마 밖의 필드(쿠키 등)는 거부한다. 페이지 전체를 검증한 후에만 커서를 이동한다. 같은 식별자의 같은 내용은 중복 카운트만 증가한다. 내용이 다르면 첫 내용을 보존하고 충돌을 보고한다.

## 파일 스키마

정식 기계 판독 스키마는 `schemas/collection-state.schema.json`, `schemas/collection-report.schema.json`이다. JSON Schema 2020-12의 type, enum, required, properties, additionalProperties, items, minimum 부분집합을 사용한다. 런타임 검증기는 이 프로젝트의 스키마에 쓰인 키워드를 검사한다. 임의의 JSON Schema 전체를 지원하는 라이브러리가 아니다.

state 필수 항목: schemaVersion, account, sourceId, scope, startedAt, runStartedAt, startPosition, lastConfirmedPosition, nextCursor, discoveredIds, records, processed, deduplication, resume, endReached, coverageKnown, issues, status, outputGeneration. null 위치는 소스의 시작/끝 sentinel이며 endReached로 구별한다. processed는 모든 고유 후보의 disposition, deduplication은 완료 여부와 중복 수, resume은 지원 여부와 누적 실행 시도 수다. 부분별 실제 시각은 records.parts에 보존한다.

report 필수 항목: schemaVersion, account, sourceId, scope, startedAt, endedAt, discoveredCount, savedCount, excludedNoTextCount, excludedReplyCount, duplicateCount, failedItems, finalStatus, endReached, coverageKnown, outputGeneration, completionScope. endedAt은 실행 중만 null이다. 보고서의 시작 시각은 이번 이어받기 실행, state.startedAt은 최초 실행이다. 개수는 현재 보관본 전체에 대한 누적 수다.

`진행 중`은 중간 체크포인트용 상태다. 최종 결과는 완료/불완전/중단 중 하나다. 중지 요청과 실패가 함께 있으면 중단을 우선 표시하되 실패 목록은 남는다. 완료는 끝 도달, 알려진 접근 범위, 모든 후보 분류, 중복 제거, 부분 실패 없음, 정렬 및 파일 저장 성공일 때만 가능하다. fixture의 완료가 실제 공개 프로필 탐색을 증명하지 않는다.

## 충돌/종료 복구

상태 파일을 먼저 임시 파일에 쓰고 fsync 후 rename한다. 파생 Markdown/보고서를 저장하고 마지막에 상태를 확정한다. 같은 디렉터리의 파일별 원자적 교체이며 세 파일을 아우르는 트랜잭션은 아니다. 강제 종료 시 상태로부터 출력을 재생성한다. 완료 알림은 세 파일 저장이 성공한 뒤만 보낸다. 상태가 손상되면 자동 덮어쓰기나 추측 복구를 하지 않는다.

단일 파일 전체를 다시 쓰는 단순한 구조다. 1~2년 규모의 초안에는 적합하지만 데이터가 커지면 메모리/저장 비용이 증가한다. DB, 증분 저장, 여러 프로세스의 분산 동기화는 범위 밖이다. 심볼릭 링크를 악의적으로 바꾸거나 결과 디렉터리를 외부 프로세스가 동시에 수정하는 경우까지 보호하는 보안 경계로 설계하지 않았다.
