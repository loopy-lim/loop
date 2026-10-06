# Blocked: simulator attention e2e — 앱 런치 크래시 (소스 결함, 쓰기 범위 밖)

> ## Attempt 2 추가 (2026-10-05, 재시도 결과)
>
> **동일 결함으로 여전히 종단 검증 불가.** 시도-1 보고 이후
> `src/features/spawn-card.tsx` 무변경(mtime 19:24 < 크래시 증거 19:49–52),
> `bunx tsc --noEmit` 동일 1건 — 수정은 이번 시도 쓰기 범위
> (scripts/**, showcase/attention-demo/**) 밖이라 적용하지 않음.
>
> 이번 시도가 남긴 것 (모두 쓰기 범위 내):
>
> 1. **프리플라이트 게이트** — `attention-demo-e2e.sh`가 빌드 전
>    `bunx tsc --noEmit`을 수행. 불량 트리면 수 초 내 exit 1 + 정확한
>    에러 출력 (검증 완료: `src/features/spawn-card.tsx(143,19): error
>    TS2304`). 시도-1의 900s 스톨 경로(망가진 앱으로 15분 빌드 후 런치
>    사망)를 재발 시 구조적으로 차단.
> 2. **게이트웨이 절반 종단 검증 (API 프로브)** — 데모 게이트웨이 기동 →
>    `open:true`·런 프로젝션에 attention 객체 → 앱과 동일 페이로드
>    `{attentionId, resolution}`로 POST resolve → `{resolved:true}` →
>    프로젝션 `"attention":null`, 상태 open:false/resolved:true,
>    JSONL 증거 기록. 남은 미지수는 UI 탭 좌표(calibration)뿐.
>
> 수정 1줄이 반영된 다음 시도 절차 (변경 없음):
>
> ```bash
> # src/features/spawn-card.tsx:32 에 radius 추가 후:
> bash apps/loop-mobile/scripts/attention-demo-e2e.sh
> ```
>
> 위험 1건: 시도-3의 `demo-script` 완료 검사 타임아웃이 900s인데 전체
> Release 빌드가 이 안에 안 들어올 수 있음. 빌드를 미리 실행해 두면
> xcodebuild 인크리멘탈로 단축되지만, 타임아웃 상향이 더 확실함.

---

- 날짜: 2026-10-05
- 태스크: `simulator-attention-demo` (attempt 1, worker stalled 이후 재수행)
- 상태: **태스크 요구의 종단 검증 불가** — 원인이 태스크 읽기/쓰기 범위 밖
  소스 파일의 결함으로 확정됨. 정확한 수정 1줄이 아래에 있으며, 범위 확장
  후 다음 시도에서 스크립트는 그대로 통과 경로로 사용 가능.

## 증상

`build-ios-simulator.sh`로 Release 빌드·설치·런치는 성공하지만 앱이
런치 수 초 내 사망하고 시뮬레이터는 홈 화면으로 복귀한다.
이전 시도의 스크린샷 5장(2026-10-05 19:41)은 전부 동일한 홈 화면(MD5 일치)
이었고, 이번 재현에서도 동일 — 앱 UI에 도달한 적이 없다.

## 근본 원활 (확정)

`apps/loop-mobile/src/features/spawn-card.tsx:143` 이 `radius.pill`을
사용하지만 같은 파일의 tokens import(`ui/tokens`)에 `radius`가 누락됨.

```
src/features/spawn-card.tsx(143,19): error TS2304: Cannot find name 'radius'.
```

- `bunx tsc --noEmit` (apps/loop-mobile) → exit 1, 위 에러 1건.
- 런타임: SubmitScreen(초기 화면)의 import 체인이 spawn-card 모듈 평가 중
  `StyleSheet.create`의 `radius.pill`에서 실패 → Hermes
  `ReferenceError: Property 'radius' doesn't exist` → 이어서
  `Cannot read property 'SpawnSessionCard' of undefined`(모듈 미완결).
  시뮬레이터 로그 19:49/19:50/19:52 세 런치 모두 동일.
- 19:50 크래시 리포트: SIGSEGV — `convertNSExceptionToJSError` 중 Hermes
  내부 손상(2차 증상). 1차 원인은 위 ReferenceError.

수정 (1줄, 쓰기 범위 밖이라 적용하지 않음):

```diff
-import { colors, press, space, type } from "../ui/tokens";
+import { colors, press, radius, space, type } from "../ui/tokens";
```

## 이 외 정적 점검 결과 (수정 후 바로 런치 가능 근거)

- 전체 src에서 토큰(`colors/type/space/radius/press`) import 누락은 이
  파일 1곳뿐 (주석 내 오탐 2곳 제외).
- RunScreen이 참조하는 `glyph.attention/foldClosed`, copy 상수
  (`ATTENTION_RESPONSE_PLACEHOLDER`, `SUBMIT_RESPONSE_LABEL` 등), 토큰 키
  전수 대조 → 모두 존재 (불량 키 0건).

## 이번 시도에서 남긴 것 (쓰기 범위 내)

- `scripts/attention-demo-e2e.sh` 재작성:
  - 런치 생존 확인(pid kill -0) — 크래시 시 최신 .ips 경로 + sim 로그의
    JS 예외를 출력하고 비제로 종료 (이전 시도는 런치 출력을 폐기해
    홈 화면 스크린샷 5장을 "증거"로 남김).
  - 좌표 매핑을 결정적으로: Simulator 창을 Window > Physical Size(1:1)로
    고정, 실측 타이틀바 + 디바이스 포인트로 매핑. 이전 산식은
    창 456x972에서 타이틀바가 음수(-19pt)가 나와 전 좌표가 틀렸음.
  - 모든 네비게이션 탭 후 32x32 그레이스케일 mean-abs-diff로 화면 변화를
    증명(tap_and_prove) — 실패 지점에서 스크린샷 쌍과 함께 즉시 실패.
  - 게이트웨이 JSONL(`release-log.jsonl`)과 `release-confirmation.json`
    를 showcase 디렉터리에 남김.
- 이전 시도의 허위 증거(동일 홈 화면 5장)는 삭제하고 이 보고서로 대체.

## 다음 시도 절차

1. 위 1줄 수정 반영 (src/features/spawn-card.tsx) — `bunx tsc --noEmit` 통과 확인.
2. `bash apps/loop-mobile/scripts/attention-demo-e2e.sh` (900s 예산 내,
   인크리멘탈 빌드 포함).
3. 탭 fraction(0.50/0.065 뒤로가기, 0.32/0.925 Files & reports,
   0.50/0.205 입력, 0.50/0.30 제출)은 마이그레이션 레이아웃 기반 추정치.
   tap_and_prove가 단계별로 실패 지점을 특정하므로, 해당 스크린샷 쌍으로
   fraction만 보정하면 된다.

## 증거 파일 (이 디렉터리)

- `01-launch-crash.png` — 런치 12s 후 홈 화면(앱 사망 재현, 2026-10-05 19:52)
- `gateway-stdout.log` / `release-log.jsonl` — 데모 게이트웨이 상태
