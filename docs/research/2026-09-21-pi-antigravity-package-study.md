# Study: @tian.zuo/pi-antigravity (방식 학습용, 미설치)

- **일자:** 2026-09-21
- **목적:** 패키지 소스를 해부해 pi ↔ agy(Antigravity) 연결 방식을 학습한다. 설치·의존 추가는 하지 않고, 우리 손으로 관리하는 자체 구현을 위한 설계 근거만 채택한다. (사용자 지시: "저걸 보고 방법을 배우되, 저걸로 만들지 말 것")
- **분석 대상:** `@tian.zuo/pi-antigravity@0.11.2` tarball (MIT, github.com/TianZuo555/pi-extensions) — /tmp/pi-agy-study 에 압축만 해제, 실행 없음

## 핵심 메커니즘

### 1. pi 확장으로 커스텀 프로바이더 등록
- `package.json`의 `"pi": { "extensions": ["./index.ts"] }` → pi가 확장 로드
- `pi.registerProvider("antigravity", { name, baseUrl, apiKey, api, models, streamSimple })` (index.ts:728)
- **baseUrl은 가짜 값** `"agy://local-stream-json"`, **apiKey도 플레이스홀더** `"agy-local-session"` — 네트워크·키가 전혀 오가지 않는다. 실제 호출은 `streamSimple` 콜백이 대행한다.

### 2. 영속적 agy 스트림 드라이버 (lib/agy-driver.ts, agy-client.ts)
```
agy --input-format stream-json --output-format stream-json \
    --print-timeout 2147484s --dangerously-skip-permissions \
    --disable-slash-commands \
    [--add-dir <cwd>] [--conversation <id>] [--model <m>] [--effort <e>]
```
- **프로세스 1개를 길게 재사용**(턴 직렬화), 대화·모델 변경 시에만 재생성 — `conversation` id로 agy 네이티브 컨텍스트 유지
- stdin으로 stream-json 요청, stdout의 stream-json 이벤트를 pi 이벤트로 reducer(lib/reducer.ts)가 축약
- `--print-timeout 2147484s`: 만료가 빈 응답으로 SUCCESS를 내는 문제를 피하는 상한치(pi의 per-turn abort가 실제 종료 소유)
- one-shot 변형도 존재: `agy --print <prompt> --output-format stream-json` (← Loop의 기존 AntigravityAdapter가 이미 이 형태)

### 3. 인증 — 키 처리 전무 (보안 설계의 핵심)
- 확장 전체에서 token/api-key/auth 값 처리 **0건** (grep 검증). agy CLI가 자기 네이티브 Google OAuth를 사용
- spawn 실패 유형 중 "auth failure"만 분류(lib/agy-client.ts:158) — 값에는 접근하지 않음
- Loop의 기존 설계(`auth = "native"`, "Loop does not store or forward an AGY key")와 정확히 같은 철학

### 4. 모델 발견과 사용량
- 모델: `agy models` 탭 구분 출력 파싱 + 스냅샷 폴백(lib/models.ts), `/agy-models`로 재발견
- **사용량/쿼터**: `agy --print /usage --output-format json` → 주간/5시간 한도를 구조화 반환, 토큰 소모 0 (README `/agy-usage`)

### 5. 권한·도구 브릿지
- 헤드리스 agy는 권한 프롬프트를 자동 거부 → `--dangerously-skip-permissions`를 항상 켜고, **권한 모델은 pi 쪽이 소유**
- agy 읽기 전용 도구(view_file/grep_search 등)는 pi 내장 도구로 재실행해 네이티브 렌더링; 나머지는 표시 전용 래퍼
- 시스템 프롬프트는 네이티브 역할이 아니라 최소 라벨 유저 프롬프트 스냅샷으로 1회 전달(텍스트 어댑터 한계 명시)

## Loop 채택 설계 (자체 관리)

| 옵션 | 내용 | 비고 |
| --- | --- | --- |
| A. Loop 어댑터 고도화 | 기존 `AntigravityAdapter`(one-shot `agy --print`)를 영속 stream-json 드라이버로 교체. 대화 연속성(`--conversation`), 턴 지연 감소 | 우리 코드 안에서 완결, 사용자가 전적으로 관리 |
| B. Loop용 pi 확장 자작 | 위 표의 registerProvider + 드라이버를 `packages/pi-loop` 확장에 자체 구현. pi UI에서 antigravity 선택 가능 | Lead 경험에 agy 모델 추가. 패키지 코드 복사 없이 방식만 채택 |
| C. 사용량 게이지 | `agy --print /usage --output-format json`을 `/loop status`나 Lead에 표시 | 소형, 독립 가치 |

## 채택 시 유의점
- `--dangerously-skip-permissions`는 헤드리스 한정 의미(프롬프트 자동 거부)이며, 권한 게이트는 호출자 쪽(pi 확장이면 pi, Loop 워커면 completion contract)이 가져야 한다.
- 영속 프로세스의 수명/자식 프로세스 정리(sigterm sweep)를 반드시 자체 구현해야 함 — 패키지의 가장 크고 위험한 부분(lib/agy-children.ts).
- `--print-timeout` 상한 트릭과 빈 SUCCESS 판별은 그대로 배울 만함.

## 결론
방식은 학습 완료: **키 없는 로컬 서브프로세스 RPC**(agy native auth + stream-json)가 전부다. npm 의존 없이 옵션 A(Loop 어댑터 고도화)가 가장 작고 관리 가능한 첫 단계다. 사용자 승인 후 착수.
