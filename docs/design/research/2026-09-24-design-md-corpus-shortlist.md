# awesome-design-md 외부 참고 corpus 후보 및 라이선스 검토

- **조사일:** 2026-09-24
- **조사 대상 고정점:** VoltAgent/awesome-design-md `f6961238d5cddcf8042a74a70fc400ec67181abb` ([commit](https://github.com/VoltAgent/awesome-design-md/commit/f6961238d5cddcf8042a74a70fc400ec67181abb))
- **목적:** Loop의 CLI/TUI·텍스트 중심 시각 언어에 참고할 공개 `DESIGN.md`를 선별하고, 후속 반입 태스크의 라이선스·출처 조건을 정한다.
- **범위:** 문서와 참고자료만 다룬다. 코드, 디자인 토큰, 실행 규칙은 변경하지 않는다.

> **비정본 경고:** 여기서 검토하거나 이후 반입하는 문서는 모두 **외부 참고 corpus**일 뿐 Loop의 canonical 디자인 규칙이 아니다. `docs/design/design-language.md`는 승인된 정본을 투영하는 read model이고, 현재 규칙의 소유자는 ADR·코드/테스트·설정이다. 외부 사례는 이들과 나란한 제3의 원천으로 소비하면 안 된다.

## 조사 방법과 판정 기준

GitHub REST API의 [저장소 메타데이터](https://api.github.com/repos/VoltAgent/awesome-design-md)와 commit에 고정한 [recursive tree](https://api.github.com/repos/VoltAgent/awesome-design-md/git/trees/f6961238d5cddcf8042a74a70fc400ec67181abb?recursive=1)를 `curl`로 조회하고, `design-md/**/DESIGN.md` 경로를 전부 수집했다. tree 응답은 `truncated: false`였으며 실제 파일은 **74개**다. 저장소 README 배지는 73개라고 표시하므로 현재 tree와 1개 차이가 있다([README 원문](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/README.md)). 이 문서는 배지 대신 고정 commit의 tree를 모집단으로 삼는다.

1. 74개 전체를 제품 범주와 README 설명으로 1차 분류했다.
2. 터미널/CLI, 개발자 도구, 텍스트 중심, 모노톤, 색·글리프·밀도 규칙의 명시성을 우선해 8개 원문을 직접 읽었다.
3. Loop에 전이 가능한 규칙과 웹 마케팅에 묶여 전이하면 안 되는 규칙을 분리했다.
4. 저장소 라이선스, 각 문서의 출처 표기, getdesign.md의 공개 corpus와 유료 요청 결과를 대조했다.

평가에서 **구조 완성도**는 색/타이포/간격/톤/금기가 모두 명시됐는지를 본다. **적용 상위**는 Loop에 원리 수준으로 전이할 수 있는 부분, **적용 하위**는 웹 전용이라 복사하지 말아야 할 부분이다. 값 자체를 복제하는 평가는 아니다.

## 전체 목록 수집 결과

고정 tree에서 수집한 74개 경로의 제품 slug는 다음과 같다([API tree](https://api.github.com/repos/VoltAgent/awesome-design-md/git/trees/f6961238d5cddcf8042a74a70fc400ec67181abb?recursive=1)).

`airbnb`, `airtable`, `apple`, `binance`, `bmw-m`, `bmw`, `bugatti`, `cal`, `claude`, `clay`, `clickhouse`, `cohere`, `coinbase`, `composio`, `cursor`, `dell-1996`, `elevenlabs`, `expo`, `ferrari`, `figma`, `framer`, `hashicorp`, `hp`, `ibm`, `intercom`, `kraken`, `lamborghini`, `linear.app`, `lovable`, `mastercard`, `meta`, `minimax`, `mintlify`, `miro`, `mistral.ai`, `mongodb`, `nike`, `nintendo-2001`, `notion`, `nvidia`, `ollama`, `opencode.ai`, `pinterest`, `playstation`, `posthog`, `raycast`, `renault`, `replicate`, `resend`, `revolut`, `runwayml`, `sanity`, `sentry`, `shopify`, `slack`, `spacex`, `spotify`, `starbucks`, `stripe`, `supabase`, `superhuman`, `tesla`, `theverge`, `together.ai`, `uber`, `vercel`, `vodafone`, `voltagent`, `warp`, `webflow`, `wired`, `wise`, `x.ai`, `zapier`.

우선군은 Ollama·OpenCode·VoltAgent, 터미널 제품인 Warp, 개발자 도구인 Cursor·ClickHouse·Vercel·Resend였다. 이 8개 원문을 fetch했고, 아래 7개를 최종 shortlist로 남겼다. Resend는 완성도는 높지만 편집용 serif·대형 웹 타이포와 atmospheric glow 비중이 커 Loop 관련성이 상대적으로 낮아 비권고군으로 내렸다.

## 후보 평가

### 1. OpenCode — terminal-native 텍스트 어휘

- **원문:** [고정 raw](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/opencode.ai/DESIGN.md)
- **구조 완성도:** **매우 높음.** warm monochrome palette와 semantic ramp, 전면 monospace 계층, 8px 기반 간격, manpage 톤, `[+]`/`[-]`/`[x]`를 포함한 Do/Don't가 모두 구체적이다. `Known Gaps`가 실제 TUI 미포함과 추론된 모바일 동작을 명시해 관찰과 추론도 구분한다.
- **적용 상위:** 글리프를 아이콘이 아닌 복사·로그 가능한 텍스트 어휘로 취급하고, 기술 표면의 semantic 색과 마케팅 무채색을 분리하는 원리가 Loop의 D-3·D-4 검토에 직접 유용하다.
- **적용 하위:** Berkeley Mono, 96px 웹 section rhythm, hero TUI mockup 값은 터미널 런타임 규칙이 아니며 Loop로 복사하면 안 된다.
- **라이선스 상태:** **무료 반입 가능(조건부).** 공개 MIT 저장소의 파일이다. MIT 고지와 출처 manifest를 함께 보존하고 상표·폰트·브랜드 자산은 반입하지 않는다.

### 2. Ollama — 문서형 최소주의와 known-gap 규율

- **원문:** [고정 raw](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/ollama/DESIGN.md)
- **구조 완성도:** **매우 높음.** 흑백/중립 색 역할, system sans+mono, 간격과 단일 컬럼, “README처럼 읽히는” 톤, gradient·shadow·추가 브랜드색 금기를 모두 명시한다. 공개 표면에 없는 error/success/warning palette를 억지로 만들지 않고 gap으로 남긴다.
- **적용 상위:** 관찰되지 않은 상태색을 발명하지 않는 태도, code/command를 1급 컴포넌트로 다루는 방식, 최소 장식 원리가 Loop의 현재 무색 텍스트 표면과 잘 맞는다.
- **적용 하위:** pill geometry, mascot, 88px 웹 간격, macOS traffic-light 색은 CLI/TUI 표현 규칙으로 전이할 이유가 없다.
- **라이선스 상태:** **무료 반입 가능(조건부).** 공개 MIT 파일이며 문서 안에 source pages `/`, `/pricing`이 표시된다. 절대 원출처 URL은 별도 manifest에서 `https://ollama.com/`로 보강해야 한다.

### 3. VoltAgent — dark developer surface와 색의 희소성

- **원문:** [고정 raw](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/voltagent/DESIGN.md)
- **구조 완성도:** **높음.** 단일 green accent, Inter/SF Mono 역할 분리, 4px 간격, hairline 중심 깊이, CTA에만 accent를 쓰는 금기가 명료하다. 다만 별도 `Known Gaps` 절과 개별 source pages 표기가 없다.
- **적용 상위:** accent를 상태/행동 신호에 제한하고 mono를 명령·수치에 한정하는 원리는 D-4의 최소 색 범위와 정보 밀도 설계에 유용하다.
- **적용 하위:** dark-only canvas, green 브랜드색, card/glow/radius 값은 VoltAgent 브랜드의 웹 규칙이므로 Loop 값으로 채택하지 않는다.
- **라이선스 상태:** **무료 반입 가능(조건부).** 저장소 MIT 범위에는 포함되나 파일 내부 provenance가 약하다. 반입 시 repo 경로·commit·`https://voltagent.dev/` 분석임을 manifest에 명시한다.

### 4. Warp — 실제 터미널 제품의 절제된 neutral 체계

- **원문:** [고정 raw](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/warp/DESIGN.md)
- **구조 완성도:** **높음.** warm dark neutral, Inter/DM Mono 역할, 4px 간격, surface contrast+hairline, chromatic accent 금지가 일관된다. 그러나 분석 대상은 Warp 앱 자체보다 마케팅 사이트이고 `Known Gaps`/source pages 표기가 없다.
- **적용 상위:** 채도 높은 색 없이 text hierarchy·surface contrast로 우선순위를 만드는 원리와 terminal mockup의 mono 역할 분리는 Loop TUI 비교 자료로 유용하다.
- **적용 하위:** hero, portrait, partner-logo, download tile과 96px section padding은 웹 마케팅 전용이다. 실제 Warp terminal UI 규칙으로 오인하면 안 된다.
- **라이선스 상태:** **무료 반입 가능(조건부).** 공개 MIT 파일이다. 반입 시 `https://www.warp.dev/`의 공개 표면을 VoltAgent가 분석한 2차 문서임을 명시한다.

### 5. Cursor — agent action과 semantic 상태의 분리 사례

- **원문:** [고정 raw](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/cursor/DESIGN.md)
- **구조 완성도:** **높음.** cream/ink/orange 체계, CursorGothic/JetBrains Mono, 4px 간격, hairline-only depth, timeline 색을 action stage에만 쓰라는 금기가 강하다. `Known Gaps`는 실제 in-app 표면이 마케팅 mockup으로만 부분 관찰됐음을 밝힌다.
- **적용 상위:** agent 단계색을 success/error 같은 일반 semantic 색과 별도 namespace로 제한하는 사례는 Loop task 상태→색 역할을 설계할 때 유용한 반례/비교점이다.
- **적용 하위:** pastel timeline 5색과 Cursor Orange를 Loop task 상태에 그대로 매핑하면 브랜드 복제이자 D-4 선취가 된다.
- **라이선스 상태:** **무료 반입 가능(조건부).** 공개 MIT 파일이다. CursorGothic 등 라이선스된 폰트와 로고·색 자산은 corpus 반입 범위에서 제외한다.

### 6. ClickHouse — 고밀도 개발자 정보와 단일 accent

- **원문:** [고정 raw](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/clickhouse/DESIGN.md)
- **구조 완성도:** **높음.** black/yellow와 semantic 보조색, Inter/JetBrains Mono, 비교적 조밀한 간격, code-first 톤, yellow 사용 제한이 명확하다. `Known Gaps`는 yellow가 screenshot sampling이라는 불확실성까지 기록한다.
- **적용 상위:** 단일 accent를 primary action·핵심 수치로 제한하고 code를 추상 일러스트보다 우선하는 규칙은 텍스트 중심 Loop의 강조 예산을 검토할 때 유용하다.
- **적용 하위:** yellow full-bleed band, 대형 stat, 72px headline은 TUI에 부적합하며, 단일 accent를 모든 상태 의미로 재사용해서도 안 된다.
- **라이선스 상태:** **무료 반입 가능(조건부).** 공개 MIT 파일이다. 파일 내부 source pages가 없으므로 `https://clickhouse.com/` 및 고정 repo 원문을 함께 표기해야 한다.

### 7. Vercel — 토큰 구조의 완성도 비교군

- **원문:** [고정 raw](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/vercel/DESIGN.md)
- **구조 완성도:** **매우 높음.** gray/semantic scale, Geist/Geist Mono 역할, 4px spacing, stacked elevation, 상세 금기가 가장 촘촘한 축에 든다. 반면 mesh gradient, 다양한 card/elevation과 웹 breakpoint 비중도 크고 별도 `Known Gaps`/source pages 표기가 없다.
- **적용 상위:** narrative sans와 technical mono의 역할 경계, closed semantic scale, 작은 기술 라벨을 mono로 제한하는 구조는 토큰 명명 대안 비교 자료로 가치가 있다.
- **적용 하위:** mesh gradient, stacked shadow, 100px pill, 192px section spacing은 Loop CLI/TUI와 무관하다. 구조 참고 이상으로 반입 우선순위를 높일 이유가 없다.
- **라이선스 상태:** **무료 반입 가능(조건부).** 공개 MIT 파일이다. Geist/브랜드 자산을 함께 가져오지 않고 `https://vercel.com/` 분석이라는 provenance를 보강한다.

## 라이선스·출처·유무료 경계

### 저장소 수준

- GitHub API는 저장소 라이선스를 `MIT`로 식별하고, [LICENSE 원문](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/LICENSE)은 software와 associated documentation의 사용·복제·수정·재배포를 허용한다. 조건은 copyright notice와 permission notice를 복제물 또는 substantial portions에 포함하는 것이다.
- [README의 License 절](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/README.md)은 모든 `DESIGN.md`를 공개 웹사이트에서 추출한 문서로 설명하고 “as is”, 무보증, 사이트의 visual identity 소유권을 주장하지 않는다고 밝힌다.
- [CONTRIBUTING](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/CONTRIBUTING.md)은 기여물이 저장소 라이선스 조건으로 제공된다고 명시한다.

따라서 위 공개 repo의 Markdown을 **텍스트 참고 corpus로 복제**하는 것은 MIT 근거가 확인된다. 다만 이 결론은 제품 상표, 로고, 스크린샷, proprietary font 파일 또는 원 사이트의 trade dress 사용 허가를 뜻하지 않는다. 후속 반입은 Markdown만 대상으로 하고, MIT LICENSE 사본/고지와 파일별 provenance를 함께 두어야 한다. 이는 법률 자문이 아니라 저장소에 게시된 라이선스 증거의 공학적 검토다.

### 개별 문서의 출처 표기 품질

- 각 파일은 frontmatter의 `name: <Product>-design-analysis`, 저장소 경로, 제품명으로 분석 대상을 식별한다.
- Ollama와 OpenCode는 본문 `Source pages`에 `/`, `/pricing` 또는 `/zen`, `/enterprise`를 적지만 절대 URL·캡처일은 없다.
- 나머지 검토 파일은 별도 source-pages 필드가 없다. README의 getdesign.md 제품 링크와 파일명으로 원 사이트를 추론할 수 있을 뿐, 파일 자체 provenance는 완전하지 않다.

그러므로 반입 manifest는 최소한 `(a) VoltAgent repo URL, (b) 고정 commit SHA, (c) raw 파일 URL, (d) 분석 대상 공식 사이트 URL, (e) MIT 고지, (f) “공식 제품 디자인 시스템이 아닌 제3자 분석” 경고`를 가져야 한다. 원문에 없는 세부 관찰 출처나 공식성은 추정해 채우지 않는다.

### 무료 공개 문서와 요청형 유료 문서

- GitHub README는 이 repo를 공개 collection으로 제공하고 각 파일을 바로 복사하는 사용법을 제시한다. 위 7개는 모두 공개 tree와 raw URL에서 인증 없이 내려받을 수 있으므로 **무료 공개 corpus**다.
- 같은 README의 “Request a DESIGN.md”는 [getdesign.md/request](https://getdesign.md/request)로 연결한다. 요청 페이지는 “A private DESIGN.md for one website. One-time payment”와 단건 가격 `$39`(표시상 이전 `$59`)를 명시하고, 상위 private 서비스도 별도 가격으로 판다.
- 따라서 **유료 요청으로 이메일/비공개 전달된 문서, private Discord 산출물, 공개 repo에 없는 문서는 이번 반입 대상이 아니다.** 구매 사실만으로 재배포 라이선스가 생긴다고 볼 근거가 없으므로 별도 명시 라이선스가 없다면 `라이선스 미확인`으로 표기하고 제외해야 한다.
- 반대로 getdesign.md에 제품 페이지가 있다는 사실만으로 유료 문서라는 뜻은 아니다. 이번 판정의 무료 기준은 해당 파일이 MIT GitHub tree에 실제 존재하는지다.

## 워크플로 연결과 경계

외부 corpus는 `docs/design/design-language.md`의 canonical 본문을 직접 바꾸는 입력이 아니다. 이전 결정인 [`design-md-workflow.md` 후속 결정](../../decisions/design-md-workflow.md#후속-결정--디자인-논의-진입점과-read-model-편집-프로토콜)에 따라 흐름을 유지한다.

```text
외부 참고 corpus(비정본, provenance+MIT 고지)
  → design-language.md의 격리된 DP 제안 lane에서 원리/관찰을 제안
  → 분류·Loop 내부 근거 검토
  → 필요 시 design.md 요구사항/대안 + decision 태스크
  → 승인 및 구현 completion check
  → integration이 정본에서 design-language.md canonical 본문으로 투영
```

- corpus의 hex, font, radius, spacing, glyph를 곧바로 Loop 값으로 복사하지 않는다.
- corpus 인용은 제안 lane의 **외부 근거**일 수 있지만 필수인 **현재 근거**(Loop 코드·테스트·설정·ADR)를 대체하지 않는다.
- `design-language.md`의 draft 상태, D-1·D-3·D-4 승인 대기를 corpus가 해소한 것으로 취급하지 않는다.
- 후속 반입 디렉터리에는 `README` 또는 manifest로 “참고용/비정본/공식 제품 문서 아님”을 가장 먼저 표시해야 한다.

## 결론

### 반입 권고 순위

| 순위 | 문서 | 권고 이유 | 라이선스 상태 |
| ---: | --- | --- | --- |
| 1 | OpenCode | ASCII 글리프, 전면 mono, TUI semantic 색 범위가 Loop 쟁점과 가장 직접적 | 무료 반입 가능(조건부, MIT 고지·provenance 필수) |
| 2 | Ollama | 문서형 최소주의와 “관찰되지 않은 palette를 gap으로 보존”하는 규율 | 무료 반입 가능(조건부, MIT 고지·provenance 필수) |
| 3 | VoltAgent | dark developer surface, accent 희소성, sans/mono 역할 분리가 명료 | 무료 반입 가능(조건부, 파일별 출처 보강) |
| 4 | Warp | 실제 terminal 제품 맥락의 warm neutral·hairline·mono 사례 | 무료 반입 가능(조건부, 마케팅 분석임을 명시) |
| 5 | Cursor | agent action 색과 일반 semantic 상태를 분리한 비교 사례 | 무료 반입 가능(조건부, 폰트·브랜드 자산 제외) |
| 6 | ClickHouse | 고밀도 code-first 구성과 단일 accent의 강조 예산 사례 | 무료 반입 가능(조건부, sampled 값의 불확실성 유지) |

**권고:** 1–6위의 Markdown 원문만, commit에 고정한 별도 external-reference corpus로 반입한다. 각 파일을 Loop의 `DESIGN.md`로 이름 바꾸거나 루트에 두지 말고, 공통 MIT LICENSE와 파일별 provenance manifest를 함께 둔다. Vercel은 구조 비교에는 좋지만 웹 전용 장식 비중이 커 1차 반입에서는 보류한다.

### 반입 비권고

- **Vercel:** 토큰 구조 참고 가치는 있으나 mesh gradient·shadow·pill·대형 spacing이 주를 이뤄 6개 권고안과 비교해 Loop 관련 정보 밀도가 낮다. 필요 시 D-1 명명 연구에서 원문 링크로만 참조한다.
- **Resend:** 구조는 완성됐지만 proprietary editorial typography, 96px hero, atmospheric glow 등 웹 브랜드 표현이 중심이다. CLI/TUI corpus의 초점을 흐린다([검토 원문](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/resend/DESIGN.md)).
- **나머지 66개:** 전체 경로는 확인했지만 이번 관련성 기준으로 원문 심층 검토 우선군이 아니다. 자동차·리테일·미디어 등 이미지/웹 마케팅 중심 문서를 일괄 반입하면 검색 잡음과 제3 원천 오인 위험이 이득보다 크다.
- **getdesign.md 유료/private 요청 산출물:** 공개 MIT tree에 없는 한 `라이선스 미확인`; 반입 제외.
- **브랜드 자산 전부:** 로고, screenshot, mascot, proprietary font 파일, 상표 사용권은 repo의 Markdown MIT 판정과 별개이므로 반입 제외.

### 후속 태스크 입력 요약

- **전체 목록 검토:** 74개 경로 수집·범주 검토, 8개 원문 심층 검토
- **최종 반입 후보:** 6개 — OpenCode, Ollama, VoltAgent, Warp, Cursor, ClickHouse
- **라이선스 확인:** 6개 모두 공개 repo MIT에 포함되어 무료 반입 가능(고지·출처·비정본 경고 조건부). 유료/private 및 공개 tree 밖 문서는 `라이선스 미확인`으로 제외
- **결정 입력:** corpus는 canonical이 아니며 `design-language.md` 제안 lane → `design.md`/decision → 승인·검증 → integration 투영 흐름만 사용
- **작성 파일:** `docs/design/research/2026-09-24-design-md-corpus-shortlist.md`
