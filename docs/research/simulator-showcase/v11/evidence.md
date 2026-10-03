# showcase v11 — 최소 재설계 전/후 비교 (2026-09-26)

태스크 `showcase-v11` · 결정 [`2026-xx-minimal-design-spec.md`](../../../decisions/2026-xx-minimal-design-spec.md) §5의 비교 증거.

## 이 디렉터리의 증거

- `01-*.png` ~ `06-*.png` — **v8/v9 대표 컷(BEFORE)과 재설계 앱(AFTER)을 나란히 붙인 합성 6장.** 왼쪽 라벨 `BEFORE`, 오른쪽 라벨 `AFTER`. 합성은 [`compose.sh`](compose.sh)(ImageMagick, hairline 보더 · tokens 팔레트 배경만 사용).
- `after-01-*.png` ~ `after-06-*.png` — 합성의 오른쪽 원본(시뮬레이터 실측 1206×2622).

## 쌍 대응표

| 합성 | BEFORE (v8/v9) | AFTER (v11) | 비교 포인트 (스펙 항목) |
| --- | --- | --- | --- |
| `01-chats-list.png` | v9 `04-refreshed-chats.png` | `after-01` | 카드 경계가 hairline 하나(§S5) — 근흑 배경 위 장식 그림자 제거(M3). 상태색은 running 초록뿐(§S1 단일 액센트 예산) |
| `02-conversation-tool-card.png` | v8 `02-tool-card-expanded-running-chip.png` | `after-02` | 툴카드: surfaceAlt + radius + hairline, 상태어 색(done=ok / running…=warn) 유지·정독(§S1 상태 삼합) |
| `03-conversation-streaming-arrival.png` | v8 `03-typing-indicator-streaming.png` | `after-03` | 02 촬영 후 게이트웨이 비트(+8s)로 생긴 busy 행 — 목적 있는 entrance 모션의 도착 상태(§S6). 02→03 차이는 타임라인 신규 행 하나에 국한(v8 절차와 동일) |
| `04-conversation-code.png` | v9 `03-syntax-highlighted-code.png` | `after-04` | 코드펜스 카드(Copy code 포함) — 문법 강조 5종은 코드펜스 한정으로 유지(§S1), 본문 대비 표면 차이만으로 분리(행 구분선 없음, §S5) |
| `05-composer-attach.png` | v9 `01-composer-attach-thumbnails.png` | `after-05` | 컴포저: draft 2줄 + 첨부 썸네일 2장, 전송 CTA가 근백 반전 단일 강조(§S1). v9와 같은 스크립트 첨부 경로 |
| `06-empty-state.png` | v8 `05-empty-state.png` | `after-06` | 빈 상태: 글리프 + 2줄 안내만, 장식 없음(§simple is best) |

## 캡처 성립 조건 (근거)

1. **앱 재빌드 확인:** 설치된 `main.jsbundle`이 소스(20:41 토큰 적용분)보다 오래됨(19:50)을 확인 → `build-ios-simulator.sh`로 Release 재빌드·설치(20:53 번들) 후 캡처. AFTER가 실제 재설계 토큰을 렌더함을 보장.
2. **게이트웨이 확인(캡처 전):** 실제 게이트웨이 `GET /v1/runs` → `100.80.133.120:18477` **200**, `loopy-macbookpro.tail42f248.ts.net:18477` **200**(preflight 기록). 캡처 구동은 demo 게이트웨이(루프백 18589, 가짜 데이터 `demo-*`)이며 스크립트가 **200 하드 게이트** — 미준비면 중단.
3. **스크립트 세션:** `LOOP_SHOWCASE_*` launch env(v8/v9와 동일 훅)로 5회 런치. 첨부는 OS 픽커 "picked" continuation과 동일 지점으로 진입(v9 근거 계승). env는 `env(1)` 경유로 전달(simctl argv 한계 — v8 신뢰성 노트).
4. **무료·무실기기:** demo 게이트웨이 가짜 데이터만 소비. **모델 호출 0회, 유료 비용 0.** 데스크톱 창 캡처 없음(쓰기 범위 밖 — 아래 한계).
5. **구별성:** 12장 전부 MD5 상이. 02→03 after 원본은 busy 행 유무만 다름(모션 도착 상태 대조).

## 스펙 준수 감사 (캡처 시점 코드 기준, 기계 검증)

| 검사 (스펙 AC) | 결과 |
| --- | --- |
| 호출부 hex 0건 — tokens.ts·terminalLayout.ts 제외 grep (AC-S1) | **0건** (terminalLayout.ts 자체도 0 — M1 해소 확인) |
| `elevation.card` 잔존 (M3/S5 REMOVE) | **0건** (`elevation.float`만 등록) |
| tokens 밖 raw `fontSize:` 리터럴 (M2/S2) | **0건** (`type.glyph` 등록 확인) |
| 간격 산술 `space.* ± 숫자` (AC-S3-2 금지 패턴) | **0건** — `space.s + space.xxs` 같은 **토큰+토큰** 조합 5건만 존재(등록 스텝 조합, 리터럴 아님) |
| `bun test apps/loop-mobile/test` (동작 불변 회귀 감시) | **227 pass / 0 fail** |
| `bun run check` 전체 게이트 | 선행 태스크 `design-spec-implementation`에서 통과(이 태스크는 표현 추가 없음) |

## 한계 (정직한 경계)

- **모바일 전/후 차이는 미묘하다.** 스펙 §2-1의 감사 결론 그대로 — 모바일은 폐쇄 어휘로 이미 규율돼 있었고 이번 REMOVE(그림자·hex 복제·마이크로 폰트)의 시각 델타가 작다. 노이즈의 원천이던 데스크톱 패리티 컷(AC-S1-4·AC-S8-2의 데스크톱 스크린샷)은 이 태스크 쓰기 범위 밖이라 미포함 — 데스크톱 캡처 태스크 후속.
- 스트리밍 페이드는 정지 캡처 2장(02→03)으로 도착 상태만 증명하며 프레임 단위 애니메이션은 미증명(정지 캡처 매체의 한계 — AC-S6-3의 "연속 캡처 2장 비교" 소충).
- 합성 PNG의 라벨 바는 ImageMagick이 그린 표기 전용 장식이다(화면 캡처 아님 — 라벨 영역만).

## 재실행

```bash
cd /Users/loopy/dev/ll3/loop
cd apps/loop-mobile && bash scripts/build-ios-simulator.sh && cd ../..   # 앱 변경 시 1회 (AFTER 번들 보장)
bash docs/research/simulator-showcase/v11/capture.sh                     # preflight + demo 게이트웨이 + 6컷
bash docs/research/simulator-showcase/v11/compose.sh                     # BEFORE/AFTER 합성 6장
# 전제: 부팅된 시뮬레이터 1대. 실제 게이트웨이 200은 증거로 기록되며(다운이어도 캡처는 계속),
# 캡처 구동은 demo 게이트웨이 200 하드 게이트. 18589 점유 프로세스는 스크립트가 먼저 정리.
```
