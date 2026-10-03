# Codex 앱 UI 디테일 격차 감사 — 현재 loop-mobile 대 갭 체크리스트

- **태스크:** `codex-detail-audit` (research, attempt 0)
- **상태:** 조사 완료 (코드 변경 없음)
- **작성일:** 2026-xx
- **대상:** `apps/loop-mobile/src/**` (대화 화면 중심)
- **참조:** `docs/decisions/2026-xx-gui-conversation.md` (D4 렌더링 계약), `docs/design/ui-ux-guidance.md`, `docs/design/design-language.md`, `docs/design/references/awesome-design-md/`(특히 `claude.md`, `opencode.ai.md`, `cursor.md`), `docs/research/gui-session-events.md`
- **제약 준수:** 유료 모델 호출 없음, 코드 변경 없음(본 문서만 작성), 동작 불변(제안은 모두 앱 표현 계층에 한정 — AGENTS.md 경계상 loop-core/loop-bridge 변경 0건)

> **file:line 주의:** `apps/loop-mobile/src/`는 현재 미커밋 작업 트리 상태다. 행 번호는 감사 시점 스냅샷 기준이며, 각 항목에 안정 앵커(심볼명)를 병기해 위임 가능성을 유지한다.

---

## 0. 요약

구조(대화 타임라인·툴 카드·steer 마커·자동 스크롤)는 D4 계약대로 갖춰져 있다. 격차의 대부분은 **정보 밀도와 미세 표현**이다: 어시스턴트 텍스트가 평문 덩어리로 렌더되고, 툴 카드는 접힘 상태에서 인자 요약이 전혀 없으며, 모든 메시지에 시간이 없고, 스크롤 이탈 시 복귀 수단이 없다. 접근성(터치 타깃·동적 타입)은 전면 미착용이다. P0은 "화면을 확대해 볼 때 보이는 정보 디테일", P1은 "손으로 만질 때 느껴지는 인터랙션"으로 나눴다.

우선순위 정의: **P0** = 시각적·정보 디테일(정적 스크린샷에서 드러남, 시연 v8 핵심), **P1** = 인터랙션 디테일(동작 중 느껴짐).

---

## 1. P0 — 시각적·정보 디테일

### G1. 어시스턴트 텍스트 마크다운 렌더 (본문)

- **Codex-like 패턴:** 어시스턴트 응답은 마크다운으로 렌더 — 헤더, 목록, **강조**, `인라인 코드`, 링크, 표. 텍스트가 마크다운 원문 기호(`**`, `##`, `` ` ``) 그대로 보이지 않는다.
- **현재 상태:** 평문 `Text` 하나로 렌더된다. `apps/loop-mobile/src/features/conversation-timeline.tsx:166-175`(`item.kind === "assistant"` 분기, `styles.assistantText`). 프로젝션은 final 텍스트를 유계 문자열로만 보관(`state/conversationProjection.ts:71-72`, `final` 플래그 존재). 마크다운 라이브러리 미도입 — `apps/loop-mobile/package.json` dependencies에 파서 없음.
- **제안 변경:** 표현 계층에 한정된 경량 마크다운 렌더러 도입. 대안 비교:
  - (a) `react-native-markdown-display` 등 순수 JS 라이브러리 — 네이티브 빌드 영향 없음, RN 0.81 호환 확인 필요.
  - (b) 자체 경량 렌더러(코드블록/인라인코드/헤더/불릿/강조 5종만) — 의존성 0, D4의 "유계 텍스트" 성격과 맞고 토큰 통제가 쉬움(ui-ux-guidance §4 강조 예산).
  - **권고 (b)**: 코드블록이 최대 수익 항목이고 나머지 문법은 2차. 적목된 텍스트를 렌더만 하므로 경계 위반 없음(레드액션은 게이트웨이 관문, 앱은 D4 §8대로 추가 적목 안 함).
- **검증 가능 수용 기준:** `**bold**`, `` `code` ``, `- bullet`, `## header`, 코드펜스 5종이 시연 세션 텍스트에서 기호 없이 렌더된다.

### G2. 코드블록 — 전용 표면 + 복사 버튼

- **Codex-like 패턴:** 펜스 코드블록은 본문과 분리된 어두운 카드(모노폰트, 좌상단 언어 라벨, 우상단 복사 버튼), 가로 스크롤 또는 줄바꿈 토글. awesome-design-md `claude.md:492`(code-window-card: 언어 라벨 + 하이라이트 + 액션 버튼), `opencode.ai.md:414-416`(install-snippet: 카드 우측 끝 copy 아이콘)이 동일 패턴의 증거.
- **현재 상태:** 코드펜스가 본문 평문에 그대로 섞여 나온다(G1과 동일 위치 `conversation-timeline.tsx:166-175`). 코드 전용 표면·복사 수단 전무 — 저장소 전체에서 `Clipboard`/`Share` 미사용(grep 0건).
- **제안 변경:** 마크다운 렌더러(G1) 안에서 코드펜스를 `colors.surfaceAlt` 배경 카드(`ui/tokens.ts:22-24` 역할 재사용, `type.mono` + `fontFamily: "Menlo"` — `features/composer.tsx` 스타일 선례 아닌 `conversation-timeline.tsx:253 cardMono`의 토큰)로 렌더하고, 우상단에 `glyph` 어휘에 복사 글리프 1개 추가(`ui/glyphs.ts` — §6 어휘 상수 경유). 복사는 `@react-native-clipboard/clipboard` 또는 RN 코어 폴백. **언어별 하이라이트는 P2로 후퇴**(의존성 대비 수익 낮음, 시연에서는 모노폰트 카드+복사만으로 충분).
- **검증 가능 수용 기준:** 코드펜스가 카드로 분리되고, 복사 탭 후 클립보드에 원문이 들어간다(수동 확인).

### G3. 툴 카드 — 접힘 상태 한 줄 인자 요약

- **Codex-like 패턴:** 접힌 툴 카드에 "무엇을 무엇으로 실행했는지" 한 줄 요약(예: `read src/App.tsx`, `bash bun test`)이 도구명 옆에 붙어, 펼치지 않고도 대화를 훑을 수 있다.
- **현재 상태:** 접힌 헤더는 상태 글리프+도구명+상태어+쉐브론뿐 — `conversation-timeline.tsx:42-52`(`cardHeaderRow`, `cardName` 44-46, `cardState` 47-50). 인자는 펼쳐야만 보인다(55-60). `item.argsJson`은 이미 프로젝션에 존재(`state/conversationProjection.ts:85` 부근, `args_truncated` 포함).
- **제안 변경:** 접힘 헤더에 `cardName` 뒤 한 줄 요약 `Text`( `numberOfLines={1}`, `type.caption`, `colors.inkMute`) 추가. 요약 규칙은 표현 계층 헬퍼 한 곳(예: 첫 문자열 인자 또는 path류 키 추출, 없으면 `argsJson` 선두 N자) — ui-ux-guidance §9-13의 "overflow 안내 단일 팩토리" 원칙 준수.
- **검증 가능 수용 기준:** 접힌 카드에서 도구별로 서로 다른 한 줄 요약이 보인다(시연 스크린샷 1장으로 입증).

### G4. 툴 카드 — 상태 칩의 대비 강화(텍스트 라벨 색)

- **Codex-like 패턴:** running/done/failed 상태가 칩(배경 틴트 또는 글리프+색 텍스트)으로 즉시 구분되고, 실패 카드는 스캔에서 바로 튄다.
- **현재 상태:** 글리프+상태어는 있으나 상태어 텍스트가 무색(`colors.inkMute`)이라 상색 글리프만이 구분자 — `conversation-timeline.tsx:43`(글리프만 `status.color`), `:47-50`(`cardState` 스타일 244: `color: colors.inkMute`). ui-ux-guidance §1 폐쇄 삼합(warn/ok/danger)은 이미 정의돼 있으나 상태어에 적용 안 됨. `interrupted` 접미어도 무색(49).
- **제안 변경:** `cardState` 텍스트에 `status.color`를 동일 적용(글리프와 한 쌍, 표면 채움 금지 원칙 유지 — §1 "큰 면적 채움 금지" 위반 없음). error 상태에서만 `colors.danger` 텍스트로 주목도 상향.
- **검증 가능 수용 기준:** 색 제거 후에도 상태어 문자(running/done/error·interrupted)가 남고(§10), 적용 시 글리프와 상태어가 같은 색으로 읽힌다.

### G5. 툴 카드 — 결과 잘림의 정직한 확장 경로

- **Codex-like 패턴:** 잘린 결과에 `…(truncated)` 마커만이 아니라 "전체 보기" 확장(모달/추가 펼침)을 제공하고, 결과가 빈 카드와 결과 없는 카드를 구분한다.
- **현재 상태:** `…(truncated)` 문자열만 (`conversation-timeline.tsx:58,64`, `:171`). 잘린 본문을 더 볼 수단 없음(게이트웨이가 `MAX_OUTPUT_BYTES` 유계 절단이므로 앱에는 유계 본문만 존재 — D4 §3). `resultText === null`(아직 종료 안 됨)과 빈 문자열 결과의 렌더가 동일(61-66 조건상 null은 숨김 — 수렴).
- **제안 변경:** (a) truncated 마커 문구를 `…(truncated at N KB — wire budget)`처럼 유계 근거를 밝히는 상수로 교체(ui-ux-guidance §7 문구 원칙: 무엇이 잘렸는가). (b) 결과 없는 running 카드에는 상태어만, 종료 카드에 결과가 빈 문자열이면 `(no output)` 한 줄 — 부정 보고 금지(D4 §3)와 정직 표기 정합. 전체 원문 보기는 원천 한계로 제공 불가 — **문서에 명시**(과잉 약속 금지).
- **검증 가능 수용 기준:** truncated 카드와 결과 없는 카드가 시각적으로 구분된다.

### G6. 메시지 타임스탬프·상대 시간

- **Codex-like 패턴:** 각 메시지(또는 버블 하단)에 시간 표기, 목록에서는 상대 시간("2m ago"). 날짜 경계는 섹션 헤더(G8과 연동).
- **현재 상태:** 모든 타임라인 아이템이 `occurredAt`을 **운반만 하고 렌더는 전혀 안 한다** — 프로젝션 3종 아이템 모두 필드 존재(`state/conversationProjection.ts:65,74,87` 부근), 렌더 계층 grep 0건. 유일한 시간 표기는 채팅 목록의 ISO 원문 절단(`features/run-list.tsx:31-33 formatTimestamp` → `YYYY-MM-DD HH:MM:SS`, 83행에서 사용) — 상대 시간 아님.
- **제안 변경:** (a) 타임라인: 사용자 버블/어시스턴트 블록/툴 카드 헤더에 `HH:MM` 캡션(`type.caption`, `colors.inkFaint`) — 아이템별 전부가 아니라 **같은 역할 연속 블록의 첫 행에만**(밀도 예산 §3 유지). (b) 채팅 목록: `formatTimestamp` 옆 상대시간 헬퍼(예: `5m`, `2h`, `3d`, 초과 시 날짜) 추가 — 표현 계층 순수 함수로 `test/` 커버 가능.
- **검증 가능 수용 기준:** 대화 화면에서 시간 경계가 보이고, 목록 행에 상대 시간이 뜬다(둘 다 시연 스크린샷 가능).

### G7. 스트리밍 타이핑 인디케이터(커서)

- **Codex-like 패턴:** 스트리밍 중인 어시스턴트 텍스트 끝에 깜빡이는 커서/블록이 붙고, 스트림 대기 구간(텍스트 도착 전)에는 타이핑 점 애니메이션.
- **현재 상태:** 델타는 버퍼에 붙어 그대로 렌더되지만 스트리밍 중/종료의 시각 구분이 없다 — `conversation-timeline.tsx:166-175`는 `final` 플래그를 소비하지 않음. 프로젝션은 이미 `final: boolean`을 제공(`state/conversationProjection.ts:71-72`, 델타 `final: false` 256행, final 프레임 도착 시 치환 265행 부근). 세션 전체가 "대기" 상태일 때 표현은 헤더 러닝 배지뿐(`screens/ConversationScreen.tsx:300-306`).
- **제안 변경:** (a) `final === false` 아이템 텍스트 뒤 커서 글리프(▍) + 타이머 기반 opacity 토글(표현 계층 컴포넌트 1개, setIntervaled RN `Animated` 불요 — 정적 깜빡임 2프레임으로 충분). (b) 텍스트 버퍼가 비어 있는 스트리밍 중(첫 델타 전) 어시스턴트 자리에 `glyph.busy`( `···`) 행 — 기존 어휘 재사용(ui-ux-guidance §6, §9-3 "새 상태 표현 발명 금지" 준수).
- **검증 가능 수용 기준:** 스트리밍 중 프레임과 종료 후 프레임이 정지 스크린샷에서 구분된다(커서 유무).

### G8. 날짜 섹션 헤더

- **Codex-like 패턴:** 대화 상단 또는 날짜 경계마다 중앙 정렬 날짜 캡션("Today", "Sep 24").
- **현재 상태:** 없음. 타임라인은 아이템 순차 렌더 — `screens/ConversationScreen.tsx:352-376` 부근(`view.items.map`), 날짜 그룹화 로직 0건. 아이템에 `occurredAt`은 있음(G6).
- **제안 변경:** 렌더 전 파생 단계에서 인접 아이템의 `occurredAt` 현지 날짜가 바뀌는 지점에 섹션 헤더 행 삽입 — 아이템 어휘에 추가하지 말 것(D4 §6 "lifecycle은 타임라인 아이템이 아니다" 정신 준수: 날짜 헤더는 **표현 파생 행**이지 프로젝션 상태가 아니다). 세션 단위 화면이므로 보통 1~2개 헤더.
- **검증 가능 수용 기준:** 어제 시작해 오늘까지 이어진 세션에서 날짜 경계선이 보인다(시연용 스크립트 세션으로 재현 가능).

### G9. 빈 상태 화면

- **Codex-like 패턴:** 빈 대화 화면은 한 줄 캡션이 아니라 중앙 정렬 안내(아이콘/글리프 + "무엇이 비었는가 + 다음 행동") — ui-ux-guidance §7 원칙 자체가 이 패턴.
- **현재 상태:** 대화 빈 상태는 상단 캡션 한 줄 — `screens/ConversationScreen.tsx:378-380` "No conversation frames yet."(스타일 430 `notice`). 채팅 목록은 `features/run-list.tsx:137-139`("No runs yet — submit a prompt to create the first one." — 다음 행동 포함, 이건 양호). 대화 쪽은 다음 행동 부재 + 중앙 정렬 아님.
- **제안 변경:** 대화 빈 상태를 타임라인 중앙의 안내 블록으로 — 글리프(`glyph.steer` 또는 statusDot) + 2줄 문구(무엇이 비었나 / 무엇을 하면 프레임이 쌓이는가). 문구는 상수 소유(§7).
- **검증 가능 수용 기준:** 프레임 없는 세션 진입 시 중앙 안내 블록이 보인다.

### G10. 에러/재연결 상태의 위계

- **Codex-like 패턴:** 스트림 끊김은 헤더 부착형 얇은 배너(재시도 중 + 마지막 동기 시각), 제출 실패는 컴포저 인접 인라인 + 재시도 버튼.
- **현재 상태:** 모든 notice(대기/재연결/종료/스트림 에러)가 헤더 아래 동일 캡션 나열 — `screens/ConversationScreen.tsx:273-277`(push), `311-317`(render, `Stream: {streamError}` 원문 덤프 316). 제출 실패는 컴포저 하단 캡션 — `features/composer.tsx:91`(스타일), 재시도 버튼 없음(입력은 보존됨 — draft 미클리어, `screens/ConversationScreen.tsx:236` 부근 확인).
- **제안 변경:** (a) `stale` notice만 톤 상향(`colors.warn` 텍스트 + `glyph.statusRunning`) — §1 흔한 상태는 최소 신호지만 "재연결 중"은 사용자가 원인을 알아야 하는 상태. (b) `streamError`는 기기 시간 등 원문 대신 상태 요약 1줄 + (가능하면) "Retry" 텍스트 버튼(재구독 = 기존 effect 재마운트 경로 재사용). (c) 제출 실패 캡션 옆 "다시 보내기" — `submit` 핸들러 재호출(드래프트 보존은 이미 됨).
- **검증 가능 수용 기준:** stale와 ended가 서로 다르게 보이고, 제출 실패 후 원문 입력이 보존된 채 재시도 한 번에 성공한다.

---

## 2. P1 — 인터랙션 디테일

### G11. 스크롤 이탈 시 "맨 아래로" 버튼

- **Codex-like 패턴:** 위로 스크롤해 자동 스크롤이 해제되면 우하단에 `↓` 플로팅 버튼 — 탭하면 말미로 복귀하고 follow 재개.
- **현재 상태:** follow 상태 머신은 존재(`screens/ConversationScreen.tsx:202-210 onScroll`, `state/paneProjection.ts:14,21-22 AUTOSCROLL_BOTTOM_EPSILON=48`)하지만 `following === false`가 됐을 때 **사용자에게 보이는 수단이 0개** — 그냥 자동 스크롤이 멈출 뿐. 새 메시지가 쌓여도 하단 복귀 경로는 손으로 끝까지 끌기뿐.
- **제안 변경:** `following` 상태를 이미 구독 중(`useState` 83-84 부근)이므로, `!following && mode === "chat"`일 때 타임라인 우하단 오버레이 pill(`glyph.foldClosed` 회전 또는 `↓` 신규 글리프) 표시 → 탭 시 `scrollToEnd({ animated: true })` + follow 재개는 `onScroll`이 자동 처리(엡실론 48pt 재진입).
- **검증 가능 수용 기준:** 스크롤업 → 버튼 등장 → 탭 → 말미 도착 → 새 프레임 시 자동 스크롤 재개, 3단계 모두 수동 확인.

### G12. 자동 스크롤 애니메이션

- **Codex-like 패턴:** 새 메시지 도착 시 부드러운 말미 추적(애니메이션 스크롤), 스트리밍 중에는 콘텐츠 증가분만큼 조용히 밀림.
- **현재 상태:** `scrollToEnd({ animated: false })` — `screens/ConversationScreen.tsx:198`. 프레임마다 즉시 점프라 스트리밍 중 거칠다.
- **제안 변경:** 스트리밍 델타(아이템 수 불변, 텍스트 증가)에는 `animated: true`, 새 아이템 추가 시에도 true — 단, 프레임 병합 간격 ≥250ms(D4 §2)라 애니메이션 도중 중단돼도 수렴. iOS에서 `animated: false`의 순간 점프가 주는 "활동감" 상실이 정확한 개선점.
- **검증 가능 수용 기준:** 스트리밍 중 화면이 부드럽게 말미를 따라붙는다(시연 영상/연속 스크린샷).

### G13. 채팅 목록 pull-to-refresh

- **Codex-like 패턴:** 목록 당겨서 새로고침이 기본 제스처, 명시적 Refresh 버튼은 보조.
- **현재 상태:** Refresh 텍스트 버튼만 — `features/run-list.tsx:132-135`. 저장소 전체 `RefreshControl` 미사용(grep 0건). 대화 화면에는 새로고침 자체가 SSE 재구독으로 대체되므로 **목록에만** 적용이 맞다.
- **제안 변경:** `RunsList`의 목록 `ScrollView`에 `refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} tintColor={colors.inkMute} />}` — `reload`는 이미 `useCallback`(`run-list.tsx:97-113` 부근)이라 그대로 연결. Refresh 버튼은 유지(§9-1 폐쇄 어휘, 이중 수단 허용).
- **검증 가능 수용 기준:** 목록을 당기면 스피너 대신 기존 어휘("loading…")가 뜨고 갱신된다.

### G14. 터치 타깃 44pt

- **Codex-like 패턴:** 모든 인터랙티브 요소의 터치 타깃 ≥ 44×44pt(HIG).
- **현재 상태:** 3건 미달 —
  - 컴포저 전송 버튼 32×32: `features/composer.tsx:80-88`(`width: 32, height: 82`), hitSlop 없음.
  - raw 토글: `screens/ConversationScreen.tsx:307-309` `hitSlop={8}`만 — 캡션 높이 17px(`type.caption`)라 실효 ~33px.
  - 백 버튼: `styles.backButton` `minWidth: 32` + `hitSlop={12}`(`ConversationScreen.tsx:291-294` 부근) — 실효 ~56px로 통과지만 명시적 보장 아님.
  - 툴 카드/목록 행/steer 행은 패딩 합이 44pt 이상이라 통과.
- **제안 변경:** 전송 버튼 44×44 + 내부 글리프 유지(카드 시각 크기 커지는 것이 정답 — 컴포저 우측 여백 재계산). raw 토글 `hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }}`로 실효 45px. 백 버튼 `minWidth: 44, minHeight: 44` 명시. 이 조정만으로 전 화면 통과.
- **검증 가능 수용 기준:** 3개 컨트롤의 실효 터치 영역 ≥44pt(Xcode Accessibility Inspector 또는 스타일 수치로 입증).

### G15. 동적 타입(Dynamic Type) 대응

- **Codex-like 패턴:** iOS 동적 타입 커짐에 텍스트가 함께 커지고 레이아웃이 버틴다(최소한 클리핑 없이).
- **현재 상태:** 모든 토큰이 고정 `fontSize`+`lineHeight` 쌍 — `ui/tokens.ts:47-55`. `allowFontScaling`/`maxFontSizeMultiplier` 사용처 0건(grep). RN 기본 `allowFontScaling=true`라 접근성 커짐 시 **폰트는 커지는데 lineHeight 고정** → 줄 겹침/클리핑 발생(현재 상태가 오히려 최악).
- **제안 변경:** 토큰에서 `lineHeight`를 제거하거나 fontSize 배수로 파생(예: `lineHeight = fontSize * 1.45` 헬퍼) — 호출부 무변경이 목표. 모노폰트 줄바꿈 카드(G2)는 `numberOfLines={0}`이라 자연 대응. 전면 대응이 부담이면 1단계로 `maxFontSizeMultiplier={1.3}` 상한을 Screen 루트에만 적용해 클리핑부터 막는다.
- **검증 가능 수용 기준:** 시뮬레이터 접근성 큰 텍스트(AX3)에서 대화 화면 텍스트가 커지고 줄이 겹치지 않는다.

### G16. 햅틱·미세 전환

- **Codex-like 패턴:** steer 제출·툴 카드 펼침·버튼 탭에 경량 햅틱, 카드 확장은 높이 전환 애니메이션.
- **현재 상태:** 햅틱 0건(`Vibration`/haptic grep 0건 — RN 코어 `Vibration`은 iOS 지원 제약), 툴 카드 확장은 즉시 조건부 렌더(`conversation-timeline.tsx:53-67`), 전환 애니메이션 없음. `activeOpacity`만 사용(41, `composer.tsx:42`).
- **제안 변경:** (a) 햅틱은 의존성 없이 `Vibration.vibrate(10)` 수준의 최소 도입 또는 **보류**(네이티브 의존성 추가는 ios 빌드 파이프라인 영향 — 이 감사는 보류 권고). (b) 카드 확장은 `LayoutAnimation` preset(RN 코어, iOS `LayoutAnimation.configureNext` 1줄 + Info.plist 불요) — 저비용 고수익. (c) 커서 깜빡임(G7)이 활동감의 대부분을 대체.
- **검증 가능 수용 기준:** 툴 카드 펼침/접기가 애니메이션 전환된다.

### G17. 타임라인 가상화(장기 세션 내구성)

- **Codex-like 패턴:** 긴 대화도 스크롤이 부드럽다(가상화 리스트).
- **현재 상태:** 전 아이템을 평천 `ScrollView`로 렌더 — `screens/ConversationScreen.tsx:340-382` 부근. `FlatList`/`SectionList` 미사용(grep 0건). 프레임 병합(≥250ms)과 유계 텍스트로 v1 데스크톱 범위에선 유효하나, 하루 종일 세션이 쌓이면 렌더 트리가 무한 성장.
- **제안 변경:** 이번 사이클은 **변경 없음**(동작 불변 제약 + G8 날짜 헤더와 `inverted` 전환 상호작용 리스크). 대신 문서화: 아이템 상한 관측치(예: 500 아이템)를 넘는 세션에서 스크롤 프레임 드랍이 관측되면 `FlatList`+`inverted` 전환을 후속 결정으로. 지금은 G12의 애니메이션 스크롤만.
- **검증 가능 수용 기준:** 없음(문서화만) — 후속 트리거 조건 명시가 이 항목의 산출.

---

## 3. 범위 밖 확인 사항 (변경 불요)

- **멱등 렌더·키** — D4 §1 준수 확인: 아이템 키가 messageId/toolCallId 기반(`ConversationScreen.tsx` 렌더 map의 key 식). 건드리지 말 것.
- **적목** — 앱은 추가 적목하지 않음(D4 §8) — G1~G5 모두 렌더만 변경, 준수.
- **lifecycle 프레임 미렌더** — D4 §6 준수(러닝 배지로만 소비, `ConversationScreen.tsx:300-306`). 날짜 헤더(G8)는 프레임이 아니라 표현 파생이므로 충돌 없음.
- **레이아웃 토큰 체계** — `ui/tokens.ts` 역할명 참조 규칙(§5) 양호. G2/G4 변경도 역할명 경유로 유지할 것(호출부 hex 금지).

## 4. 시연 v8 촬영 포인트 (후속 태스크용 메모)

P0 항목이 확대 스크린샷에서 드러나도록: (1) 마크다운+코드블록 카드가 포함된 어시스턴트 응답(G1/G2), (2) 접힘 요약이 보이는 툴 카드 3종 상태(G3/G4), (3) 스트리밍 커서(G7), (4) 날짜 헤더+시간 캡션(G6/G8), (5) "맨 아래로" 버튼(G11). 스크립트 세션(유료 호출 없음)으로 위 요소를 포함한 대화를 재생하는 것이 시연 스크립트의 요구사항이 된다.

## 5. 구현 위임 순서 권고

1. **표현 기반(G1→G2→G7):** 마크다운 렌더러가 코드블록 카드와 커서의 자리를 만든다. 같은 컴포넌트 안에서 연쇄 구현이 가장 저렴.
2. **정보 밀도(G3→G4→G5→G6):** 툴 카드와 타임스탬프 — 전부 프로젝션 필드 소비만 추가(신규 상태 0).
3. **구조(G8→G9→G10):** 날짜 파생 행, 빈/에러 상태 문구 상수화.
4. **인터랙션(G11→G13→G14→G12→G15→G16):** 버튼→제스처→타깃/타입→애니메이션 순. G17은 문서화만.

각 항목은 apps/loop-mobile 내부 변경이고 AGENTS.md 경계(loop-core 무관, 브리지 타입 무변경, codegen 불요)를 유지한다. 유일한 신규 의존성 후보는 클립보드(G2)이며, RN 코어 폴백이 확인되면 의존성 0으로도 가능.
