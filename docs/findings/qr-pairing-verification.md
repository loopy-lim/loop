# QR 페어링 최종 검증 — docs/findings/qr-pairing-verification.md

- **태스크:** `qr-final-verification` (kind=verification)
- **일자:** 2026-09-26
- **결론:** **전 수용 기준 PASS** — 유료 모델 호출 0회
- **범위:** 읽기 AGENTS.md / apps / crates / docs / packages, 쓰기 이 파일만

## 수용 기준별 결과

| # | 기준 | 결과 | 증거 |
| --- | --- | --- | --- |
| 1 | `loop pair` 출력이 동일 설정으로 라운드트립 | **PASS** | 실제 CLI 실행 + 유닛 + 라이브 파싱 (아래 §1) |
| 2 | 딥링크 연결 + 재실행 유지 (v10) | **PASS** | `v10/` 스크린샷 3장 + capture.sh 경로 분석 (§2) |
| 3 | QR에 비밀 없음 (페이로드 검사) | **PASS** | 라이브 페이로드 검사 + secret 파라미터 거부 확인 (§3) |
| 4 | 수동 폴백 유지 | **PASS** | ConnectScreen host/port/token 수동 입력 경로 코드 확인 (§4) |
| 5 | 경계 unchanged (아키텍처/codegen) | **PASS** | `test:architecture` 8 pass, `codegen:check` exit 0 (§5) |
| 6 | `bun run check` | **PASS** | codegen → typecheck → architecture → cargo workspace → 553 tests, 0 fail (§6) |

## §1 `loop pair` 라운드트립

실제 CLI 실행(동일 설정: `LOOP_GATEWAY_PORT=18477`, `--host loopy-macbookpro.tail42f248.ts.net`):

```text
loop://connect?host=loopy-macbookpro.tail42f248.ts.net&port=18477
+ ASCII QR (v10/01-cli-pair-qr.png 가 캡처한 것과 동일 출력)
```

라이브 출력 페이로드를 `parsePairUrl`로 재파싱:

```text
round-trip: {"host":"loopy-macbookpro.tail42f248.ts.net","port":18477}
```

유닛(`packages/cli/test/pairing.test.ts`): **16 pass / 0 fail, 985 expect()** —
라운드트립, 포트 경계(1·65535 통과, 0·65536·비정수 거부), 미지 파라미터 무시(호환),
호스트 해석 순서(flag → MagicDNS → env), IP 리터럴 ATS 경고, 골든 매트릭스(데스크톱 공유),
독립 재구현 대조(zigzag 언마스크 추출·BCH(15,5)·이진시프트 GF(256) 리드-솔로몬) 전부 통과.

## §2 딥링크 연결 + 재실행 유지 (v10 증거)

`docs/research/simulator-showcase/v10/` 스크린샷 3장 — MD5 전부 상이, 02는 실측 해상도 1206×2622:

- `01-cli-pair-qr.png` — Terminal 창의 `loop pair` 실출력(§1의 것).
- `02-deeplink-connect-chats.png` — **동일 페이로드**를 콜드 `simctl openurl`로 주입 →
  OS 열기 확인 배너 승인(스크립트 좌표 클릭 1회) → 게이트웨이 연결된 Chats.
- `03-relaunch-stays-connected.png` — 무 launch env 재실행 → 키체인 토큰리스 설정
  (host:port + 모드 마커) 자동 복원 → 연결된 Chats 직행.

자동화 등가성(capture.sh 헤더 + README §v10 명시): `simctl openurl`이 받는 입력은
시스템 카메라 스캔이 전달하는 것과 **동일한 딥링크 페이로드**다. 앱 측 전 과정
(파싱 → 프리필 → 프로브 → 연결 → 저장 → 재실행 복원)은 프로덕션 코드 경로.
스크립트가 앱을 재설치해 배너 발생을 결정적으로 만든다. 실기기 카메라 스캔 UX는
미검증(결정 문서 §4 위험으로 유지).

## §3 QR 페이로드에 비밀 없음

- 라이브 페이로드에 `token`/`secret`/`bearer`/`password`/`api_key` 파라미터 부재 —
  위치(host, port)만 포함. 토큰리스 페어링 전용 표면(pair.ts §D-A).
- 변조 시 거부 실측:

```text
refused: pairing payload must not carry secrets (refused parameter: token)
refused: pairing payload must not carry secrets (refused parameter: apiKey)
```

- 퍼저가 스킴·타깃·호스트 형태·포트 범위를 벗어나는 입력도 전부 거부(유닛 확인).

## §4 수동 폴백 유지

`apps/loop-mobile/src/screens/ConnectScreen.tsx`에 수동 경로 그대로 존재:
host / port / (옵션) bearer token `TextInput` + `createConnectionConfig` 검증 CTA.
딥링크(`src/auth/pairing.ts`)는 이 경로에 프리필·프루브를 얹는 추가 진입점이며
수동 입력을 대체하지 않는다(결정 D-B 폴백 1). 복원 유닛
(`test/restore.test.ts`, `test/tokenless-connect.test.ts` 합계 **25 pass / 0 fail**).

## §5 경계 unchanged

- `bun run test:architecture` — **8 pass / 0 fail** (loop-core 순수성, 계층 방향,
  keychain 참조 confine 포함).
- `bun run codegen:check` — **exit 0** (Rust 브리지 타입 ↔ 생성 TS 동기화).

## §6 전체 검사

`bun run check` = `codegen:check && typecheck && test:architecture && test`:

- `cargo test --workspace` — 전 타깃 `test result: ok` (0 failed; loop-bridge 15,
  loop-store 22 등 합계 98).
- `cargo build -p loop-bridge` — 네이티브 브리지 재빌드 완료(워크트리의 Rust 변경분
  반영), 브리지 의존 패키지 테스트 전부 통과로 적재 확인.
- `bun test packages tests plugins` — **553 pass / 0 fail, 3813 expect()** (64 파일).

## 실행한 명령 요약

```bash
cd packages/cli && bun test test/pairing.test.ts
LOOP_GATEWAY_PORT=18477 bun packages/cli/src/main.ts pair --host loopy-macbookpro.tail42f248.ts.net
bun test apps/loop-mobile/test/pairing.test.ts test/restore.test.ts test/tokenless-connect.test.ts
bun run test:architecture && bun run codegen:check
bun run check
md5 docs/research/simulator-showcase/v10/*.png
```

## 변경 파일

- `docs/findings/qr-pairing-verification.md` (신규 — 이 파일, 유일한 쓰기).

## 미해결 위험

- 실기기 카메라 스캔 UX 미검증 — 자동화는 `simctl openurl`(동일 페이로드) 등가까지.
  결정 문서 §4에 위험으로 기록됨.
- 배너 승인 클릭 좌표는 시뮬레이터 창 크기 비율 기반(60.0%, 56.8%) — OS 버전업으로
  배너 위치가 바뀌면 capture.sh 좌표 상수 갱신 필요.
- 워크트리에 선행 태스크의 미커밋 변경 99건 존재(브리지 Rust 포함). 이 태스크는
  그 위에서 전체 검사를 통과시켰을 뿐, 커밋 분할은 각 선행 태스크 소관.
