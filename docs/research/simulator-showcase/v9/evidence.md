# showcase v9 — 첨부 이미지 플로우 · 코드블록 구문 강조 · 디자인 승격 (2026-09-26)

태스크 `showcase-v9`. v9 승격 3종(컴포저 사진 첨부, 코드블록 구문 강조, 뷰티 패스)을
시뮬레이터 정지 캡처로 증명한다. **모델 호출 0회, 유료 비용 0** — 첨부 데모 이미지는
`demo-gateway.ts` 안에서 코드로 렌더한 PNG 두 장(블루/오렌지 악센트 변형)이고, 전송
라운드 트립은 demo 게이트웨이의 fake 라우트와 주고받는다. 실기기 없음.

## 스크린샷 ↔ 증명 매핑

| # | 스크린샷 (`v9/`) | 증명하는 것 | 화면에서 확인되는 것 |
| --- | --- | --- | --- |
| 01 | `01-composer-attach-thumbnails.png` | 컴포저 첨부 — 썸네일 스트립 | 라이브 v9 세션(`sess_demo_v9_0008`, running bash 카드)의 컴포저에 **서로 다른 로컬 생성 이미지 2장**이 썸네일로 붙어 있다: 미업로드 배지 `···`, 개별 제거(×) 버튼, 프리필된 프롬프트, 첨부 버튼, 활성화된 전송 버튼 |
| 02 | `02-user-image-inline.png` | 첨부 전송 → 관찰된 user_message → 인라인 렌더 | 스크립트 전송이 **프로덕션 경로 전체**(업로드 201 → input 202 → 스트림에 관찰된 `user_message` 프레임 → M2 GET 본문 → 인라인 이미지)를 통과했다. 새 사용자 버블에 보낸 이미지가 인라인으로 렌더되고, 컴포저는 성공 후 비워졌다 |
| 03 | `03-syntax-highlighted-code.png` | 코드블록 구문 강조 | ` ```ts ` 펜스 카드(TS 랭글 칩 + Copy code)에서 `export/const/function/return` 키워드·숫자 리터럴·문자열이 토큰별로 착색. 인라인 코드 칩(`MAX_OUTPUT_BYTES`)과 마크다운 구조(볼드/헤딩/불릿)도 함께 렌더 — 의존성 0 토크나이저(`features/syntax.ts`) |
| 04 | `04-refreshed-chats.png` | 뷰티 패스 — Chats | 대형 타이틀, 프롬프트 카드, 상태 점 배지(green running/gray completed), 카드 elevation, Log out pill — 토큰 체계 정비 후 모습 |
| 05 | `05-refreshed-conversation.png` | 뷰티 패스 — 대화 | 이틀 대화: 날짜 경계 헤더(Sep 26), `HH:MM` 캡션, ✓ done 툴 카드, 꼬리 코너가 하나인 사용자 버블, 고정 컴포저 |

실행 모드: `apps/loop-mobile/scripts/demo-gateway.ts`(루프백 18588, bearer 상수
`demo-token`, fake demo data) + `LOOP_SHOWCASE_*` launch env 훅. 캡처 전 실제
게이트웨이(100.80.133.120:18477) `/v1/runs` 200 확인을 기록했다(캡처 자체는 demo
게이트웨이로 수행 — v8 이래 관례).

## v9 캡처가 잡아낸 결함 2건과 수정

캡처 스크린샷은 의도가 아니라 증거다 — 이번 캡처에서 실제 결함 2건이 잡혔고,
첫 번째는 프로덕션 수정을 낳았다.

1. **RN Blob 생성자가 ArrayBuffer/ArrayBufferView 파트를 거부** (프로덕션 결함).
   첫 02 캡처에서 전송이 실패했고, 컴포저 에러 라인에 `Creating blobs from
   'ArrayBuffer' and 'ArrayBufferView' are not supported`가 찍혔다. 원인:
   `client.uploadSessionAttachment`가 `new Blob([typedArray])`로 본문을 감쌌다.
   부작용으로 C10 Resend 계약(프리필 유지 + 썸네일 유지 + Resend 버튼)이 실기기에서
   그대로 작동하는 것을 확인했다. **수정**(단일 원칙: 바이트는 절대 JS Blob 생성자를
   다시 거치지 않는다): `uploadSessionAttachment`는 런타임이 만든 Blob(`response.blob()`,
   신규 `readPhotoBlob` — file://와 http(s) 모두 지원)을 받고, 첨부 플로우/화면/테스트가
   그 시그니처를 따른다. 스크립트 첨부 훅도 같은 continuation을 쓴다.
   `bun test apps/loop-mobile/test` 203 pass / 0 fail.
2. **demo 게이트웨이 GET attachments가 업로드 본문을 못 꺼내줌** (demo 전용 결함).
   전송 성공 후 02가 `photo unavailable` 플레이스홀더로 찍혔다 — POST로 저장한
   `uploadedBodies`를 GET 라우트가 조회하지 않았다. 수정 후 02는 인라인 이미지를
   렌더한다(실제 게이트웨이의 세션별 asset store 계약과 동일).

## 스크립트 훅 (v9 신규)

| env (SIMCTL_CHILD_ 접두) | initialProps | 의미 |
| --- | --- | --- |
| `LOOP_SHOWCASE_COMPOSER_DRAFT` | `composerDraft` | 대화 컴포저 프리필 |
| `LOOP_SHOWCASE_ATTACH_ASSETS` (콤마 구분) | `attachAssetIds` | M2 본문 id 배열을 데모 첨부 |
| `LOOP_SHOWCASE_ATTACH_DELAY_MS` | `attachDelayMs` | 마운트 후 첨부 지연(기본 3000) |
| `LOOP_SHOWCASE_ATTACH_SEND_DELAY_MS` | `attachSendDelayMs` | 마운트 후 스크립트 Send 지연(미설정 시 미전송) |

정직성 노트: 스크립트 첨부는 OS 포토 픽커(PHPicker)를 대체할 수 없으므로, **픽커의
"picked" continuation과 동일한 지점**(같은 `appendPendingAttachment`, 같은 pending
상태, 같은 정직한 cap 거부)으로 진입하되 본문을 demo 게이트웨이가 로컬 생성한 PNG로
바꾼다. 전송·업로드·렌더는 사람 경로와 완전히 동일한 프로덕션 코드다.

demo 게이트웨이 v9 신규 라우트(실제 게이트웨이 M2/D5 계약 미러): `POST
/v1/sessions/{id}/attachments`(이미지 타입 allow-list, 8MiB 한도, 201
`{attachmentId, mimeType, byteLen}`), `POST /v1/sessions/{id}/input`(refs만 전송 →
0.8s 후 관찰된 `user_message` 프레임 푸시), 세션 `sess_demo_v9_0008`(+run
`run_demo_v9_0008`, live).

## 재실행

```bash
cd /Users/loopy/dev/ll3/loop
cd apps/loop-mobile && bash scripts/build-ios-simulator.sh && cd ../..   # 앱 변경 시 1회
bash docs/research/simulator-showcase/v9/capture.sh
# 게이트웨이를 매 실행 새로 띄우는 것은 의도(input 푸시가 1회성 — 스크립트 헤더 참조).
# 18588 점유 프로세스가 있으면 스크립트가 먼저 정리한다.
```

단계별 수동 재현·타이밍(첨부 t+3s, 전송 t+9s, 캡처 t+7s/t+15s)은 `v9/capture.sh` 본문 참조.

## 한계

- 사람의 포토 라이브러리 탭(PHPicker UI)과 카메라 권한 플로우는 헤드리스 재현 불가 —
  위 훅이 같은 continuation으로 대체한다. `file://` 읽기 경로는 iOS 네트워킹 스택의
  담당이지만 실기기 캡처로는 검증하지 못했다(단위 테스트와 http 경로 실측으로 커버).
- 캡처는 demo 게이트웨이 fake 데이터다. 실제 게이트웨이의 업로드/입력 라우트를 쳐본
  것 아니다(실게이트웨이 기동 확인은 기록만).
- 04의 chats 목록은 fake 인벤토리 순서라 v9 run 행이 화면 아래로 밀려 있다 — v9의
  시연 본체는 01/02다.
- 캡처 5장 MD5 전부 상이(스크립트 마지막 블록이 검증).
