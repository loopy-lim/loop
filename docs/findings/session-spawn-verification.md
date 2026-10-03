# 검증: 앱 원격 스폰 → 호스트 tmux pi 세션 → 앱 라이브 미러 (task `spawn-showcase-verify`)

- **결론:** 수용. 시뮬레이터 앱의 "New TUI session" 탭 한 번으로 `POST /v1/sessions/spawn` → 맥 `loop` tmux 세션에 새 창이 열려 실제 pi TUI가 구동되고, tap 자동 등록을 타고 앱이 세션을 **자동 발견·자동 오픈(~1.2s)** 하여 같은 대화가 라이브 미러된다. 증거는 [`docs/research/simulator-showcase/v13/`](../research/simulator-showcase/v13/) 6컷 + `evidence.md`.
- **검증이 잡아낸 결함 3건(수정 후 데모):** (1) `SubmitScreen.tsx`의 `./spawn-card` import 경로 오류와 (2) `spawn-card.tsx` 주석 종료자 중복 — 둘 다 RN 번들을 깨뜨렸고 `bun test`가 못 잡는(테스트가 react-free 모듈만 로드) 빌드 게이트 공백이다. 각 한 줄 수정. (3) launchd 게이트웨이 PATH에 tmux·node가 없어 첫 실스폰이 `spawn_tmux_unavailable` — 결정론 에러 매핑이 실환에서 의도대로 동작한 것이며, 수술은 저장소 코드가 아닌 기기 plist 설정에서 끝났다(경계 준수).
- **유료 호출:** 운영자 승인 한도 내 소형 2회(`gpt-5.5 • medium`, `$0.038 + 누계 $0.048 상당, sub`) — 프롬프트·응답 전량 `v13/evidence.md` 공개. 스폰·자동발견은 유료 호출 0회로 검증.
- **경계:** 스포너는 게이트웨이 어댑터(`packages/gateway/src/spawn.ts`)에만 존재하고 loop-core 변경 없음. 본 태스크의 저장소 쓰기는 docs와 위 한 줄 수정 2건뿐. 후속: (a) RN 앱 번들 빌드 게이트 부재, (b) 스폰 응답 `pid` null(pane_pid 파싱), (c) 인라인 상태 줄이 ~1.2s 안에 끝나 사실상 관측되지 않는 UX — 각각 후속 태스크 거리.
