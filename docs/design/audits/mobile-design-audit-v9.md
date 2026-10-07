# loop-mobile UI 디자인 감사 — v9 결과 보고서

- **작업:** `implementation` (loop-mobile UI 디자인 감사, 코드 변경 없음)
- **기준 정본:** [`docs/design/design-system.md`](../design-system.md) (canonical, v3) · [`ui-ux-guidance.md`](../ui-ux-guidance.md) §9 체크리스트
- **작성일:** 2026-10-07
- **검사 대상:** `apps/loop-mobile/showcase/v8/**` · `showcase/v7/restyle/**` · `src/ui/tokens.ts` · screens/features · `docs/design/audits/react-doctor-report-v8.txt`

---

## 요약

**종판정: 구조는 정본에 충실하다. 폐쇄 어휘·강조 예산·터치 하한은 기계 테스트와 캡처 증거 양쪽에서 유지되고 있다. 드리프트는 어휘 밖에서가 아니라 어휘의 "틈"(grep이 못 잡는 산술·리터럴·미등록 변형)에서 발견됐고, react-doctor v8의 error 11건은 렌더 품질(스크롤 성능·정리되지 않는 타이머)로 이어지는 실질 결함이다.**

| 축 | 판정 | 요지 |
| --- | --- | --- |
| 노이즈 | 양호 | 상태색이 큰 채움을 만들지 않는다(픽셀 분석: accent ≤0.24%, warn ≤0.24%). 목록 잦은 상태는 도트만(C-4·REMOVE #9 준수) |
| 대비 | 양호 | `contrast.test.ts` 33/33 green — 잉크 4단 AA 4.5:1, accent 텍스트 등급, inkGhost 비텍스트 3:1, 사다리 단차 핀 |
| 터치 인체공학 | 양호 | FAB 56pt·send 44·탭 44·pane 행 ~46·CTA ~54 — 전 표면 44pt 하한 충족. 소형 컨트롤(첨부 remove 20pt)은 hitSlop으로 보정 |
| 강조 예산 | 양호(1건 긴장) | viewport당 흰 CTA 1개 원칙 유지. 단, run 상세에서 `running` 단어+색이 헤더 배지와 status 행에 이중 노출될 수 있음(§F-4) |
| 토큰 드리프트 | 주의 | 게이트가 못 잡는 틈 3건 — 토큰+토큰 간격 산술(=6, 스케일 밖), 원시 `paddingVertical: 4`, 토큰 밖 폰트 상수(§F-3) |
| 정확성(react-doctor v8) | error 11건 | 스크롤 핸들러 setState ×2, 정리 없는 effect ×1, render 중 ref 변경 ×4, 폐기된 RN 모듈 ×1, 미사용 변수 ×3(§F-2) |

**가장 중요한 방법론 한계(먼저 읽을 것):** 이 감사 세션의 모델(zai/glm-5.3-flashx)은 이미지 입력을 지원하지 않아 v8·v7/restyle 스크린샷을 **직접 눈으로 볼 수 없었다.** 화면 근거는 캡처 시점에 수행된 기록 측정 — `v8/evidence.md`·`v8/polish-evidence.md`·`v8/fab-evidence.md`의 토큰 정확 일치 픽셀 분석, macOS Vision OCR 좌표, v7/restyle 전/후 밴드 측정 — 으로 대체했다. 이 문서의 스크린샷 근거는 전부 **2차 증거**이며, §9 체크리스트 중 "눈으로 봐야만 답히는" 항목(시각적 균형·소음 체감)은 vision 가능 세션의 재검토가 남아 있다(§F-1, P1).

---

## 스크린샷 근거 (2차 증거 — 캡처 시점 측정 기록)

아래 근거는 모두 캡처 당시 기록된 정량 측정이다. 이 감사는 해당 PNG를 재열람하지 못했다(상단 한계 참조).

### v8 (`showcase/v8/evidence.md` — Release 빌드, iPhone 17 시뮬레이터, 1206×2622 3x)

| 컷 | 측정 근거 | 감사 판독 |
| --- | --- | --- |
| `01-connect.png` | bg 73.6%·surface 16.9%·cta 5.94% — 유일한 밝은 채움이 Connect CTA | 강조 1개 원칙 확인. 카드는 표면+헤어라인만 |
| `02-runs-list.png` | bg 66.1%·surface 29.1%, accent 0.03%·warn 0.16%, 하단 3탭 바 | 상태색 소면적 유지, 탭 바 accent 선택 상태. CTA 0.29% — 홈은 의도적으로 무강조 화면 |
| `03-run-detail.png` | bg 91.4% — "Connecting to this task's session" 상태만 | 대화 내용 미캡처(데모 세션 부재). 빈 상태가 화면을 지배하는 것이 정상 동작인지 육안 재확인 필요 |
| `05-files-attention.png` / `06-attention-ready.png` | CTA 픽셀 0.80%→5.23% (비활성→입력 후 Submit response 활성) | attention 카드의 강조가 입력 가능해질 때만 켜지는 것 확인 — §4 예산 준수 |
| `fab-01-home-fab.png` | 54pt 원형 surface 채움 + 헤어라인 링 + inkMute 합성톤 `+` 글리프 | FAB 2차 티어(흰 CTA 아님)·뷰포트 1개 — canon v3 §3 준수 |
| `fab-02-run-detail-icons.png` | 전 화면 채도 색 0픽셀 — 이모지 프리젠테이션 부정 | REMOVE #11(SF Symbol/VS15 경로) 실렌더 확인 |
| `polish-01/02` (OCR) | 첫 행 peek 28pt, `Untitled task`/`Unnamed session` 정직 라벨, IN PROGRESS/TODAY/EARLIER 3섹션 | 목록 상태 단어 반복 없음(도트/글리프만) — REMOVE #9 준수 |

### v7/restyle (`showcase/v7/evidence.md` 전/후 측정)

- 비스크롤 거터 붕괴(`x=3..1202` 풀블리드) → `x=48..1157`(16pt 거터) 교정 확인 — 현재 `ui/Screen.tsx` `columnFixed`에 `COLUMN_GUTTER`로 등록돼 유지 중.
- attention 블록이 4–8pt 한 줄기 → 카드 그룹핑 + `Submit response` 흰 CTA 교정 — 현재 `RunScreen.tsx` `attentionCard`/`resolveButton` 어휘로 등록돼 유지 중.
- 교정이 전부 **기존 토큰 재결합**(새 색·스케일 0)으로 수행됐다는 기록 — v9 시점 코드에서도 신규 색/스텝 없음(§F-3의 틈 제외).

### 근거의 공백 (육안 재검토 필요 목록)

1. `03-run-detail.png` 계열 — 실제 대화·툴카드 렌더는 v8 컷에서 미확인(v7 03은 확인됨). 버블/툴카드/mono args의 v2 팔레트 실렌더 재확인.
2. 탭 바 선택 라벨의 accent 실렌더 — fab-evidence가 선택 상태를 `#8B8F95`(합성톤)로 기록. anti-aliasing 합성으로 설명 가능하나 눈 확인 없이 단정 불가.
3. 화면별 시각적 균형·소음 체감, Dynamic Island/status bar 침범 여부 — OCR·픽셀로는 부분 판독만 가능.

---

## 스펙 대조 (design-system.md 조항별)

| 조항 | 코드 근거 | 판정 |
| --- | --- | --- |
| §1 단일 소스 | 호출점 hex/rgba 0건(`design-spec.test.ts` M1 green), 폰트 리터럴 0건 | 통과 (단, 테스트가 못 잡는 틈은 §F-3) |
| §2 팔레트·역할 | 잉크 4단 계약(in run-list `inkFaint` 라벨/`inkMute` 시간/`ink` 제목), inkGhost 장식 전용(탭 비활성 아이콘) | 통과 |
| §3 타입 스케일 | 화면 폰트 전부 `type.*` 경유 | 통과 (PaneScreen `TERMINAL_FONT_SIZE=12` 상수는 mono와 동값이나 스케일 밖 정의 — §F-3) |
| §3 간격 폐쇄 | 대부분 `space.*` | **예외 2건** — `composer.tsx:193` `space.xs + space.xxs`(=6, 허용 집합 밖), `composer.tsx:240` `paddingVertical: 4`(동값이나 토큰 우회) |
| §3 pill 한정 | pill 사용처 = 전송 원형·FAB(50%)·업로드/제거 배지·점프 pill은 radius.m | 통과 — 일반 버튼은 전부 radius.m |
| §3 버튼 위계 | 1차 CTA=흰 필+radius.m(Connect·Submit response), 2차=FAB·scanEntry·chip(surface+hairline), 3차=텍스트(toggle·resend) | 통과 |
| §3 FAB | 56pt 원형·surface+hairline+float·뷰포트 1개·상태 pill 동반·busy 시 "···" 마크 | 통과 |
| §3 탐색 | 3탭 바(활성 accent/비활성 ghost+faint)·상세는 탭 바 숨김+back 셰브론·하단 알약 재도입 0건 | 통과 |
| §3 아이콘 레지스트리 | `ui/glyphs.ts` 역할 폐쇄+VS15 핀+SF Symbol 이중 등록, `icon-registry.test.ts` 게이트 | 통과 (아이콘 **크기** 토큰은 미등록 — §DP-3) |
| §4 강조 예산 | 화이트 CTA viewport당 1개, accent=활성 탭·포커스 링만, accentSoft 미사용 대면적 | 통과 (run 상세 상태 단어 이중 노출 긴장 — §F-4) |
| §5 모션 | `ui/motion.tsx` 단일 소비 경로(AC-S6-2 green), 등록 4종(motion fold/entrance/blink/pulse) | 통과 |
| §6 REMOVE 1–12 | 위 대조 전반 | 12항목 전부 재도입 근거 없음 |
| §7 회귀 감시 | `bun test design-spec tokens contrast` → 33 pass / 0 fail (v9 시점 재실행) | green 유지 |

### ui-ux-guidance §9 체크리스트 (15항목)

1–3 상태(폐쇄 어휘·최소 신호·신규 발명 금지): **통과** — statusMark→MARK_ROLE 단일 조회, 도트만 반복.
4–5 위계(배치 우선·첫 훑기): **통과** — attention 행이 섹션 선두(attentionFirst), warn 엣지.
6–7 밀도: **통과** — 섹션 라벨 1개 규칙, 빈 섹션 미출력.
8 강조 예산: **통과(긴장 1건 — §F-4)**.
9–10 색: **통과** — 상태는 글리프+색 이중 운반, `runStatusColor` 단일 테이블.
11 글리프: **통과** — 레지스트리 경유만, VS15 핀.
12–13 문구: **통과** — 빈 상태 라벨 `ui/copy.ts` 상수 소유(UNTITLED_RUN_LABEL 등).
14–15 일관성: **대체로 통과** — 어휘 모듈 경유. §F-3의 틈과 §DP-1의 테스트 갭이 남는다.

---

## 우선순위 결과

### P1 — 구현 전 반드시 처리

**F-1. 스크린샷 직접 검토 미수행 (감사 방법 한계)**
- 근거: 이 세션 모델은 이미지 입력 불가. 본 보고서의 화면 규정은 전부 캡처 시점 측정 기록(§스크린샷 근거)이다.
- 제안: 개선 런 승인 전에 vision 가능 세션에서 v8 5컷 + fab 2컷 + polish 2컷을 재검토해 본 보고서의 "육안 재검토 필요 목록" 3건을 소거한다. 구현 코드 결함이 아니라 **검증 결함**이므로 개선 런의 선행 조건으로 넣는다.

**F-2. react-doctor v8 error 11건 — 렌더 품질 직결분 우선**
- 근거: `react-doctor-report-v8.txt` (점수 46/100, 11 errors). UI 감사 관점에서 실체감 순:
  1. `setState in onScroll` ×2 — `ConversationScreen.tsx:323`, `PaneScreen.tsx:103`. 대화 타임라인은 최대 빈도 스크롤 표면이다. jump-to-bottom pill 갱신이 프레임마다 리렌더를 유발하면 §5 "표면을 조용히 유지"가 스크롤에서 깨진다(체감 노이즈 1순위).
  2. `effect-needs-cleanup` — `ConversationScreen.tsx:214` (정리되지 않는 구독/타이머).
  3. `no-ref-current-in-render` ×4 — `ConversationScreen.tsx:184`, `ui/BackSwipeZone.tsx:25`, `ui/DrawerMenu.tsx:42`, `ui/SwipeableRow.tsx:44`. 뒤로 스와이프·행 스와이프는 제스처 표면 — render 중 ref 변경은 제스처 상태 불일치의 씨앗.
  4. `rn-no-deprecated-modules` — `features/markdown-view.tsx:8` `Clipboard` (RN core에서 제거됨). 코드 복사 버튼이 환경에 따라 무응답.
  5. `no-unused-vars` ×3 — `ui/DrawerMenu.tsx:115`(DRAWER_PANEL_FRACTION_APPLIED 사본 상수) 등.
- 제안: 위 순서로 수정 런을 구성하고 react-doctor 재실행으로 증명. warning 162건 중 UI 직결분(`no-array-index-as-key` ×12 — markdown-view/file-viewer, `rn-no-scrollview-mapped-list` — ConversationScreen:661)은 차순위로 같은 런에서 묶는다.

### P2 — 다음 정리 런

**F-3. 토큰 드리프트 그립 — 게이트의 틈 3건**
- 근거:
  1. `src/features/composer.tsx:193` — `paddingHorizontal: space.xs + space.xxs` (=6). 허용 집합 {2,4,8,12,16,24,32} 밖. AC-S3-2 grep은 `space.X + 숫자`만 잡고 **토큰+토큰 산술은 놓친다.**
  2. `src/features/composer.tsx:240` — `paddingVertical: 4`. 값은 space.xs와 동일하지만 호출점 리터럴 — 토큰 값 변경 시 무관하게 남는 우회.
  3. `src/ui/terminalLayout.ts:20` — `TERMINAL_FONT_SIZE = 12` 원시 상수를 `PaneScreen.tsx:171` fontSize로 소비. mono와 동값이지만 스케일 정의 밖 복제(REMOVE #4의 변형). `design-spec.test.ts`의 `fontSize:\s*\d` grep은 상수 경유를 못 잡는다.
- 제안: §DP-1 접수(테스트 개정) + composer 2건은 토큰 경유 재결합(동작 변화 0).

**F-4. run 상세 상태 단어 이중 노출 긴장**
- 근거: `RunScreen.tsx`는 헤더(AppHeader `runningBadge` — `running` 단어+ok색 도트)와 본문 statusRow(`run.status` 단어+색)가 같은 viewport에 `running`을 두 번 렌더할 수 있다. REMOVE #9는 "목록의 행마다 반복"만 금지하므로 현재 위반은 아니지만, §4 "강조는 화폐"의 정신에서 반복 상태 단어는 소음이다. v7 03 컷에서 헤더+status 행 동시 노출이 확인된 바 있다.
- 제안: 헤더 배지는 도트만(blink 유지), 단어는 status 행에만 — 코드 1줄급 정리. REMOVE #9의 정의를 "viewport 내 상태 단어 반복"으로 확장할지는 §DP-4로 판단.

**F-5. 비활성 시각 변형의 미등록 3종**
- 근거: 비활성 표현이 `opacity: 0.5`(spawn-fab fabDisabled, run-list rowDisabled)·`opacity: 0.35`(composer attachDisabled)·`ctaDisabled` 채움(버튼류)으로 분산. §8-3(변형은 등록) 관점에서 동일 의미 상태에 세 가지 값이 병존.
- 제안: §DP-2 — `press.disabledOpacity` 1종 등록 또는 "CTA류=ctaDisabled, 그 외=등록 opacity" 규칙 명문화.

### P3 — 기록·문서 정리

**F-6. 문서 드리프트 (코드 무관)**
- `src/ui/AppHeader.tsx` 주석 "logout on chats" — 실제로는 Settings 탭 경로(`App.tsx:429`). 파생 문서가 오도할 수 있어 다음 파일 접촉 시 수정.
- `tokens.ts` 주석의 FAB 문서(canon §3)와 코드 간 불일치 없음 확인(56pt 일치).

---

## DP 제안 (design-language lane 접수 목록)

| ID | 제안 | 내용 | 근거 |
| --- | --- | --- | --- |
| DP-1 | design-spec 테스트 개정 — 간격 산술·리터럴 게이트 확장 | (a) grep을 `space\.[a-z]+\s*[+*]` 전반으로 확장해 토큰+토큰 산술을 차단, (b) padding/margin/gap의 원시 숫자 리터럴을 허용 집합 화이트리스트로 검사, (c) fontSize 소비는 `type.*` 역할 참조 강제(상수 우회 차단) | §F-3. "일관성은 도구다"(guidance §8) — 현재 게이트는 우회 3곳을 놓침. 신규 토큰 0, 검사 강화만 |
| DP-2 | 비활성(disabled) 변형 등록 | `tokens.ts`에 비활성 표현 1종(예: `press.disabledOpacity`)을 등록하고 0.5/0.35 분산을 수렴. §8-3 "변형은 등록, 매몰 금지" | §F-5 |
| DP-3 | 아이콘 크기 역할 검토 | 탭/헤더 아이콘이 `type.title.fontSize`(17) 등 텍스트 역할을 빌려 쓰는 중 — 아이콘 크기 스텝(예: glyph/caption/body 3스텝)의 등록 여부를 판정. 등록하지 않기로 하면 "텍스트 스케일 차용 허용"을 canon에 명기 | §스펙 대조 아이콘 행. 신규 어휘 최소화 원칙과 충돌하므로 폐기 선택지도 유효 |
| DP-4 | REMOVE #9 정의 확장 여부 | "목록 행마다 상태 단어 반복 금지" → "viewport 내 상태 단어 반복 금지"로 확장해 헤더 배지+status 행 이중 표기를 드리프트로 명명. 채택 시 run 헤더 배지는 도트만 | §F-4 |
| DP-5 | vision 재검증 기록 | 개선 런 착수 전 vision 가능 세션에서 v8 컷을 직접 검토하고 그 결과를 이 문서의 "육안 재검토 필요 목록"에 대조·소거 기록 | §F-1 |

---

## 완료 확인 (이 감사의 체크)

- `design-spec`·`tokens`·`contrast` 테스트: **33 pass / 0 fail** (v9 시점 재실행 — green 유지)
- `apps/loop-mobile/src` 변경: **없음** (감사 전문 — 보고서만 작성)
- 본 문서: `docs/design/audits/mobile-design-audit-v9.md` (쓰기 범위 내 유일 변경)
