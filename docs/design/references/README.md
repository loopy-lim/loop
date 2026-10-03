# 외부 디자인 참고 자료

> **non-canonical 외부 참고 자료:** 이 디렉터리는 Loop의 디자인 규칙이나 공식 제품 디자인 시스템이 아니라, 공개 표면을 VoltAgent가 분석한 제3자 문서의 고정 snapshot이다.

## 사용 정책

1. **참고 전용:** 이 corpus는 비교와 아이디어 탐색에만 쓰며 Loop의 canonical 원천이 아니다.
2. **규칙 소비 금지:** 색, 글리프, spacing, font, radius, 상태 의미와 금기를 Loop UI 생성 규칙으로 직접 소비하지 않는다.
3. **제안 lane 근거로만 인용:** `docs/design/design-language.md`의 `## Proposals / 제안` lane에 있는 제안 블록의 `현재 근거`에서 “외부 비교 사례”로만 인용하며, Loop 내부 근거를 대체하거나 제안을 승인하지 않는다.

세부 정책과 이후 승인 흐름은 [`design-reference-corpus` ADR](../../decisions/design-reference-corpus.md)을 따른다.

## awesome-design-md snapshot

- **upstream:** [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
- **고정 commit:** [`f6961238d5cddcf8042a74a70fc400ec67181abb`](https://github.com/VoltAgent/awesome-design-md/commit/f6961238d5cddcf8042a74a70fc400ec67181abb)
- **라이선스:** [MIT LICENSE](./awesome-design-md/LICENSE)
- **collection manifest:** [`awesome-design-md.md`](./awesome-design-md.md)
- **반입일:** 2026-09-25 (전량 반입 확장 포함)

### 반입 현황

고정 commit tree의 `design-md/**/DESIGN.md` **74개 전량**을 `./awesome-design-md/` 아래에 반입했다. 심층 검토로 먼저 반입한 8건(OpenCode, Ollama, VoltAgent, Warp, Cursor, ClickHouse, Notion, Slack)을 유지하고, 2026-09-25에 나머지 66건을 추가했다.

- **성공:** 66건 (fetch 실패 0, 형식 이상 0)
- **미반입:** 0건
- **헤더:** 모든 문서에 `non-canonical` 필수 헤더(출처 raw URL · MIT 라이선스 · 반입일)가 있다. 헤더가 없는 문서는 이 corpus로 취급하지 않는다.
- **브랜드 자산:** 로고, screenshot, mascot, font 파일 등은 반입하지 않는다. Markdown 본문만 반입했다.

---

## 선택 카탈로그

사용자가 “X 기반” 제안의 출처를 고르기 위한 목차다. 각 행은 문서 링크 · 한 줄 요약 · Loop 적합도 · 추천도를 제공한다.

### Loop 적합도 기준

아래 세 기준으로 높음/중간/낮음을 판정한다. 세 기준 모두 Loop 표면(CLI/TUI, 텍스트 중심 터미널)에서 관찰 가능한 것만 가치가 있다.

| 기준 | 의미 |
| --- | --- |
| **터미널/텍스트 중심 출력** | 문서가 설명하는 표면이 텍스트·monospace·문서 밀도 중심이고, 이미지·사진·hero 비주얼에 의존하지 않는가 |
| **상태·밀도 규율의 명시성** | 상태(활성/오류/비활성 등)와 정보 밀도의 규율이 명시적이고 재현 가능한가 |
| **색 규율의 ANSI 전환 가능성** | 색 사용이 소수의 semantic accent 중심이라 hex → ANSI 16/256 후보 매핑으로 변환 여지가 있는가 |

**추천도:** `상` = 제안 lane 근거로 우선 검토, `중` = 필요 시 보조 비교, `하` = 참고 가치 낮음(브랜드/웹 마케팅 중심).

### AI/LLM·코딩 에이전트

| 문서 | 한 줄 요약 | Loop 적합도 | 추천도 |
| --- | --- | --- | --- |
| [OpenCode](./awesome-design-md/opencode.ai.md) | 전면 monospace와 ASCII 어휘의 terminal-native 코딩 플랫폼 | 높음 — 텍스트 글리프와 semantic 색 범위가 TUI와 직접 대응 | 상 |
| [Cursor](./awesome-design-md/cursor.md) | agent action 단계와 일반 semantic 상태를 분리한 코드 에디터 | 높음 — 상태색 namespace 분리가 상태 규율에 직접 대응 | 상 |
| [Ollama](./awesome-design-md/ollama.md) | README처럼 읽히는 문서형 최소주의 로컬 LLM 러너 | 높음 — 관찰 불가 상태를 발명하지 않는 known-gap 규율 | 상 |
| [VoltAgent](./awesome-design-md/voltagent.md) | void-black 표면과 희소 accent의 에이전트 프레임워크 | 높음 — accent를 상태·행동 신호로 제한하는 예산 규율 | 상 |
| [Warp](./awesome-design-md/warp.md) | warm neutral·hairline·mono 중심 터미널 제품 | 높음 — hierarchy와 surface contrast만으로 우선순위 형성 | 상 |
| [Claude](./awesome-design-md/claude.md) | warm terracotta accent와 editorial 레이아웃의 AI 어시스턴트 | 높음 — 단일 accent와 텍스트 중심 구성, 색 예산이 작음 | 상 |
| [Replicate](./awesome-design-md/replicate.md) | 백색 캔버스와 code-forward 구성의 ML API 플랫폼 | 높음 — 절제된 강조와 코드 중심 밀도 | 상 |
| [Together AI](./awesome-design-md/together.ai.md) | blueprint-style 기술 문서 어휘의 오픈 AI 인프라 | 높음 — 텍스트 밀도 중심, 장식 최소 | 상 |
| [Mistral AI](./awesome-design-md/mistral.ai.md) | French-engineered 미니멀, purple 톤의 LLM 제공자 | 중간 — 텍스트 중심이지만 purple 마케팅 표면 혼재 | 중 |
| [Cohere](./awesome-design-md/cohere.md) | vibrant gradient와 데이터 중심 대시보드의 엔터프라이즈 AI | 중간 — 데이터 밀도 어휘만 참고, gradient는 웹 중심 | 중 |
| [xAI](./awesome-design-md/x.ai.md) | stark monochrome, 미래주의 미니멀의 AI 연구소 | 중간 — 무색 계층과 호환이나 정보 밀도 규율 정보가 희박 | 중 |
| [ElevenLabs](./awesome-design-md/elevenlabs.md) | dark cinematic UI, 오디오 파형 미학의 음성 AI | 중간 — dark 표면 참고, 오디오 상태 어휘는 TUI 전환 어려움 | 하 |
| [Expo](./awesome-design-md/expo.md) | dark 테마와 code-centric 구성의 React Native 플랫폼 | 중간 — 코드 중심 구성 참고, letter-spacing 등 웹 속성 혼재 | 중 |
| [Lovable](./awesome-design-md/lovable.md) | playful gradient의 AI 풀스택 빌더 | 낮음 — gradient 마케팅 중심, 상태·밀도 규율 정보 희박 | 하 |
| [Minimax](./awesome-design-md/minimax.md) | neon accent의 다크 인터페이스 AI 모델 제공자 | 낮음 — neon 강조는 ANSI 전환과 색 예산 규율 모두에 부적합 | 하 |
| [Runway](./awesome-design-md/runwayml.md) | cinematic dark hero와 editorial 미학의 영상 생성 AI | 낮음 — proprietary typography와 hero 비주얼 중심 | 하 |
| [NVIDIA](./awesome-design-md/nvidia.md) | green 브랜드의 하드웨어·AI 플랫폼 표면 | 낮음 — 하드웨어 마케팅 중심, 문서 밀도가 표면에 희박 | 하 |

### 개발자 플랫폼·데이터 인프라

| 문서 | 한 줄 요약 | Loop 적합도 | 추천도 |
| --- | --- | --- | --- |
| [Vercel](./awesome-design-md/vercel.md) | 흑백 precision과 Geist role 분리의 배포 플랫폼 | 높음 — 색 예산 최소와 역할 분리가 무색 폴백 설계와 호환 | 상 |
| [ClickHouse](./awesome-design-md/clickhouse.md) | 고밀도 code-first 구성과 단일 yellow accent의 분석 DB | 높음 — primary action에 한정된 강조 예산 | 상 |
| [Supabase](./awesome-design-md/supabase.md) | green 브랜드와 개발자 문서 중심의 오픈 소스 BaaS | 중간 — 문서 밀도 참고, illustration과 dark web 표면 혼재 | 중 |
| [Sentry](./awesome-design-md/sentry.md) | dark 개발자 UI와 semantic 오류 상태색의 모니터링 | 중간 — 오류/경고 상태색 참고, 마케팅 표면 혼재 | 중 |
| [PostHog](./awesome-design-md/posthog.md) | playful 브랜드의 개발자 친화 dark UI 분석 도구 | 중간 — dark 개발자 UI 참고, playful 잡음 있음 | 중 |
| [MongoDB](./awesome-design-md/mongodb.md) | green leaf 브랜드와 문서 중심 구성의 데이터베이스 | 중간 — 문서 구성 참고, 브랜드 마케팅 비중 큼 | 중 |
| [HashiCorp](./awesome-design-md/hashicorp.md) | enterprise-clean 흑백 규율의 인프라 자동화 | 중간 — 모노톤 규율 참고, 밀도 정보는 문서 표면에 한정 | 중 |
| [Mintlify](./awesome-design-md/mintlify.md) | 문서 표면 구성 중심의 문서화 플랫폼 | 중간 — 문서 표면 구조 참고, product 마케팅 혼재 | 중 |
| [Sanity](./awesome-design-md/sanity.md) | structural editing 어휘의 콘텐츠 플랫폼 | 중간 — 구조 어휘 참고, 웹 표면 잡음 있음 | 중 |
| [Composio](./awesome-design-md/composio.md) | colorful integration 아이콘 중심의 도구 통합 플랫폼 | 낮음 — 다색 아이콘 중심, 색 예산 규율과 충돌 | 하 |
| [Resend](./awesome-design-md/resend.md) | editorial typography와 glow 중심의 이메일 API | 낮음 — 웹 브랜드 표현 중심(선행 조사 판정과 동일) | 하 |
| [Framer](./awesome-design-md/framer.md) | motion과 hero 중심의 웹 디자인 도구 | 낮음 — 웹 모션·비주얼 중심 | 하 |
| [Webflow](./awesome-design-md/webflow.md) | 템플릿 마케팅 중심의 노코드 웹 빌더 | 낮음 — 마케팅 표면 중심 | 하 |

### 생산성·협업 SaaS

| 문서 | 한 줄 요약 | Loop 적합도 | 추천도 |
| --- | --- | --- | --- |
| [Linear](./awesome-design-md/linear.app.md) | keyboard-first 밀도와 절제 accent의 이슈 트래커 | 중간 — 밀도·키보드 어휘 참고, 웹 표면 혼재 | 중 |
| [Raycast](./awesome-design-md/raycast.md) | launcher 밀도와 단축키 어휘 중심의 생산성 도구 | 중간 — launcher 상호작용 어휘가 TUI와 유사, gradient 마케팅 혼재 | 중 |
| [Notion](./awesome-design-md/notion.md) | pastel feature card와 purple CTA의 workspace | 중간 — 문서·데이터 구성 참고, pastel tint는 ANSI 전환 부담 | 중 |
| [Slack](./awesome-design-md/slack.md) | aubergine primary와 pill CTA의 메신저 | 중간 — 텍스트 내 상태 어휘(링크·멘션) 분리 참고 | 중 |
| [Cal](./awesome-design-md/cal.md) | 단순 스케줄 표면의 오픈 소스 스케줄러 | 중간 — 강조 예산이 작은 단순 표면 | 중 |
| [Superhuman](./awesome-design-md/superhuman.md) | keyboard-first, purple glow의 프리미엄 메일 | 중간 — keyboard-first 참고, glow는 웹 표현 | 하 |
| [Airtable](./awesome-design-md/airtable.md) | 컬러 필드 중심의 스프레드시트·DB 하이브리드 | 낮음 — 다색 필드 중심 표면 | 하 |
| [Miro](./awesome-design-md/miro.md) | 캔버스·포인터 중심의 협업 화이트보드 | 낮음 — 캔버스 GUI, 텍스트 중심성 낮음 | 하 |
| [Figma](./awesome-design-md/figma.md) | 디자인 도구 캔버스 표면 분석 | 낮음 — 캔버스 GUI 중심 | 하 |
| [Intercom](./awesome-design-md/intercom.md) | 메신저 위젯 마케팅 중심의 고객 커뮤니케이션 | 낮음 — 위젯 마케팅 표면 | 하 |
| [Zapier](./awesome-design-md/zapier.md) | 오렌지 브랜드 중심의 자동화 플랫폼 | 낮음 — 마케팅 색 중심 | 하 |
| [Clay](./awesome-design-md/clay.md) | GTM 데이터 플랫폼의 마케팅 표면 | 낮음 — 영업 마케팅 표면 | 하 |

### 금융·커머스·마켓플레이스

| 문서 | 한 줄 요약 | Loop 적합도 | 추천도 |
| --- | --- | --- | --- |
| [Stripe](./awesome-design-md/stripe.md) | API 문서 밀도와 semantic 상태 규율의 결제 인프라 | 중간 — 문서·API 표면의 밀도와 상태 참고, gradient 마케팅 혼재 | 중 |
| [Airbnb](./awesome-design-md/airbnb.md) | 사진·여백 중심의 소비자 마켓플레이스, 단일 Rausch accent | 낮음 — 사진 중심, 단일 accent 예산만 참고 | 하 |
| [Coinbase](./awesome-design-md/coinbase.md) | 소비자 앱 표면의 암호화폐 거래소 | 낮음 — 소비자 앱 중심 | 하 |
| [Kraken](./awesome-design-md/kraken.md) | purple 브랜드의 암호화폐 거래소 | 낮음 — 소비자 표면 중심 | 하 |
| [Binance](./awesome-design-md/binance.md) | yellow 브랜드의 암호화폐 거래소 | 낮음 — 소비자 표면 중심 | 하 |
| [Revolut](./awesome-design-md/revolut.md) | 소비자 핀테크 마케팅 표면 | 낮음 — 마케팅 중심 | 하 |
| [Wise](./awesome-design-md/wise.md) | bright green 브랜드의 송금 서비스 | 낮음 — 소비자 브랜드 중심 | 하 |
| [Mastercard](./awesome-design-md/mastercard.md) | 로고·브랜드 시스템 중심의 결제 네트워크 | 낮음 — 브랜드 아이덴티티 중심 | 하 |
| [Shopify](./awesome-design-md/shopify.md) | 커머스 플랫폼 마케팅 표면 | 낮음 — 커머스 마케팅 중심 | 하 |

### 미디어·커뮤니티 콘텐츠

| 문서 | 한 줄 요약 | Loop 적합도 | 추천도 |
| --- | --- | --- | --- |
| [The Verge](./awesome-design-md/theverge.md) | 편집 디자인 실험이 강한 테크 미디어 | 낮음 — 에디토리얼 실험 중심 | 하 |
| [Wired](./awesome-design-md/wired.md) | 에디토리얼 잡지 표면 | 낮음 — 잡지 레이아웃 중심 | 하 |
| [Pinterest](./awesome-design-md/pinterest.md) | 이미지 그리드 중심의 시각 탐색 서비스 | 낮음 — 이미지 그리드 중심 | 하 |
| [Spotify](./awesome-design-md/spotify.md) | 커버 아트 중심의 음악 스트리밍 | 낮음 — 커버 아트 중심 | 하 |

### 소비재·모빌리티·하드웨어 브랜드

| 문서 | 한 줄 요약 | Loop 적합도 | 추천도 |
| --- | --- | --- | --- |
| [IBM](./awesome-design-md/ibm.md) | 그리드·모노톤 규율의 엔터프라이즈 표면 | 중간 — 그리드 규율 참고 가능, 기업 마케팅 혼재 | 하 |
| [Apple](./awesome-design-md/apple.md) | 제품 사진·여백 중심의 하드웨어 브랜드 | 낮음 — 사진 중심 | 하 |
| [HP](./awesome-design-md/hp.md) | 하드웨어 기업 마케팅 표면 | 낮음 — 마케팅 중심 | 하 |
| [Dell (1996)](./awesome-design-md/dell-1996.md) | 1996년식 웹 표면의 레트로 snapshot | 낮음 — 시대 기록 가치만 있음 | 하 |
| [Meta](./awesome-design-md/meta.md) | 소비자 플랫폼 브랜드 표면 | 낮음 — 브랜드 마케팅 중심 | 하 |
| [Uber](./awesome-design-md/uber.md) | 모빌리티 앱 브랜드 표면 | 낮음 — 소비자 앱 중심 | 하 |
| [Tesla](./awesome-design-md/tesla.md) | 미니멀 제품 표면의 전기차 브랜드 | 낮음 — 제품 비주얼 중심 | 하 |
| [BMW](./awesome-design-md/bmw.md) | 자동차 브랜드 마케팅 표면 | 낮음 — 비주얼 마케팅 중심 | 하 |
| [BMW M](./awesome-design-md/bmw-m.md) | 모터스포츠 서브 브랜드 표면 | 낮음 — 비주얼 마케팅 중심 | 하 |
| [Bugatti](./awesome-design-md/bugatti.md) | 초고급 자동차 브랜드 표면 | 낮음 — 비주얼 마케팅 중심 | 하 |
| [Ferrari](./awesome-design-md/ferrari.md) | 자동차 브랜드 마케팅 표면 | 낮음 — 비주얼 마케팅 중심 | 하 |
| [Lamborghini](./awesome-design-md/lamborghini.md) | 자동차 브랜드 마케팅 표면 | 낮음 — 비주얼 마케팅 중심 | 하 |
| [Renault](./awesome-design-md/renault.md) | 자동차 브랜드 마케팅 표면 | 낮음 — 비주얼 마케팅 중심 | 하 |
| [SpaceX](./awesome-design-md/spacex.md) | 미니멀한 우주 기업 표면 | 낮음 — 이미지 중심 | 하 |
| [Vodafone](./awesome-design-md/vodafone.md) | 통신사 브랜드 표면 | 낮음 — 브랜드 마케팅 중심 | 하 |
| [Nike](./awesome-design-md/nike.md) | 스포츠웨어 브랜드 표면 | 낮음 — 이미지 중심 | 하 |
| [Starbucks](./awesome-design-md/starbucks.md) | 소비자 브랜드 표면 | 낮음 — 브랜드 마케팅 중심 | 하 |
| [Nintendo (2001)](./awesome-design-md/nintendo-2001.md) | 2001년식 웹 표면의 레트로 snapshot | 낮음 — 시대 기록 가치만 있음 | 하 |
| [PlayStation](./awesome-design-md/playstation.md) | 콘솔 게임 브랜드 표면 | 낮음 — 비주얼 마케팅 중심 | 하 |

### 추천 상위 5

1. **OpenCode** — terminal-native monospace·ASCII 어휘의 가장 직접적인 선례
2. **Cursor** — agent 단계색과 task 상태 namespace 분리가 Loop 상태 규율과 직접 대응
3. **Warp** — 색 없이 hierarchy와 surface contrast만으로 우선순위를 만드는 사례
4. **Ollama** — 관찰 불가능한 상태를 발명하지 않는 known-gap 규율
5. **Vercel** — 최소 색 예산과 role 분리가 NO_COLOR·무색 폴백 설계와 호환

(차상위: VoltAgent, ClickHouse, Claude, Together AI, Replicate)

---

## 심층 검토 반입 8건 상세

초기 선별 반입(2026-09-25)에서 심층 비교한 8건의 상세 행이다.

| 문서 | 한 줄 요약 | 출처 | Loop 참고 포인트 |
| --- | --- | --- | --- |
| [OpenCode](./awesome-design-md/opencode.ai.md) | 전면 monospace와 ASCII 어휘를 사용하는 terminal-native 분석 | [고정 원문](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/opencode.ai/DESIGN.md) | 복사·로그 가능한 텍스트 글리프와 semantic 색 범위 비교 |
| [Ollama](./awesome-design-md/ollama.md) | README처럼 읽히는 문서형 최소주의 분석 | [고정 원문](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/ollama/DESIGN.md) | 관찰되지 않은 상태 palette를 발명하지 않는 known-gap 규율 |
| [VoltAgent](./awesome-design-md/voltagent.md) | dark developer surface와 희소한 accent 사용 분석 | [고정 원문](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/voltagent/DESIGN.md) | accent의 상태·행동 신호 제한과 sans/mono 역할 분리 비교 |
| [Warp](./awesome-design-md/warp.md) | 터미널 제품의 warm neutral·hairline·mono 중심 마케팅 표면 분석 | [고정 원문](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/warp/DESIGN.md) | text hierarchy와 surface contrast만으로 우선순위를 만드는 사례 |
| [Cursor](./awesome-design-md/cursor.md) | agent action 단계와 일반 semantic 상태를 분리한 분석 | [고정 원문](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/cursor/DESIGN.md) | task 상태와 agent 단계색 namespace 분리의 비교점 |
| [ClickHouse](./awesome-design-md/clickhouse.md) | 고밀도 code-first 구성과 단일 accent 분석 | [고정 원문](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/clickhouse/DESIGN.md) | primary action·핵심 수치에 한정된 강조 예산 비교 |
| [Notion](./awesome-design-md/notion.md) | pastel feature card와 단일 purple CTA 중심 workspace 표면 분석 | [고정 원문](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/notion/DESIGN.md) | 문서·데이터 중심 표면에서 속성 상태를 pastel tint로 구분하는 비교 |
| [Slack](./awesome-design-md/slack.md) | aubergine primary와 pill CTA 중심 메신저 표면 분석 | [고정 원문](https://raw.githubusercontent.com/VoltAgent/awesome-design-md/f6961238d5cddcf8042a74a70fc400ec67181abb/design-md/slack/DESIGN.md) | 커뮤니케이션 표면에서 inline link·멘션 등 텍스트 내 상태 어휘 분리 비교 |

---

## 사용자 선택 방법

카탈로그에서 출처 하나를 고르고, 다음처럼 요청한다.

```text
<문서명> 기반으로 제안해줘
예: "OpenCode 기반으로 제안해줘" / "Linear 기반으로 색 후보 제안해줘"
```

요청을 받으면 다음 절차로 진행한다.

1. **출처 확인:** 선택한 문서의 `./awesome-design-md/<문서>.md`와 헤더의 고정 raw URL을 확인한다.
2. **제안 lane 접수:** `docs/design/design-language.md`의 `## Proposals / 제안` lane에 **신규 제안 그룹**(DP-YYYYMMDD-N)으로 접수한다. 기존 제안 그룹을 수정하지 않는다.
3. **후보 값 조건(색·글리프 값을 다룰 때):** ADR 개정의 4개 조건을 모두 충족한다 —
   - 출처 표기: 문서 상대 경로 + 고정 commit `f6961238d5cddcf8042a74a70fc400ec67181abb` + MIT 표기
   - 터미널 제약 변환: `hex → ANSI 16/256 후보 매핑`과 NO_COLOR·파이프·`--json` 무색 폴백 명시
   - Loop 관측 규율 충돌 확인: status 8 / attention 6 / findings 5 줄 예산과 무색 출력 경로와의 충돌 확인란
   - 승인 경로 연결: 해당 pending 결정(D-3 불릿/글리프, D-4 색 범위 등)에 연결
4. **경계 유지:** 접수된 제안은 승인 전까지 canonical이 아니며, 이 디렉터리의 어떤 값도 Loop 규칙으로 직접 소비되지 않는다.

추천이 필요하면 위 [추천 상위 5](#추천-상위-5)부터 고르는 것을 권한다.

---

원문에 포함된 hex, font, radius, spacing과 브랜드 표현은 Loop 값이 아니다. 로고, screenshot, mascot, font 파일 등 브랜드 자산은 반입하지 않았다.
