# 외부 DESIGN.md reference corpus 반입 정책

- **Date:** 2026-09-24 (2026-09-25 개정: 아래 [개정 — 외부 값의 제안 lane 후보 반입 허용](#개정--외부-값의-제안-lane-후보-반입-허용-2026-09-25))
- **Status:** decided (amended 2026-09-25)
- **Kind:** decision
- **Read scope:** `docs/decisions/design-md-workflow.md`, `docs/design/design-language.md`, `docs/design/research/2026-09-24-design-md-corpus-shortlist.md`
- **Write scope:** 이 결정 문서 (`docs/decisions/design-reference-corpus.md`)
- **근거:** [`awesome-design-md` 외부 참고 corpus 후보 및 라이선스 검토](../design/research/2026-09-24-design-md-corpus-shortlist.md), [`design.md` 워크플로와 제안 lane 결정](design-md-workflow.md#후속-결정--디자인-논의-진입점과-read-model-편집-프로토콜)

## 배경

Loop의 표면은 CLI/TUI와 텍스트 중심 터미널 환경이다. VoltAgent의 [`awesome-design-md`](https://github.com/VoltAgent/awesome-design-md)는 다양한 제품의 공개 표면을 분석한 `DESIGN.md` 모음이지만, 제품 팀이 발행한 공식 디자인 시스템이 아니며 Loop의 규칙도 아니다. 전량 또는 루트 반입은 검색 편의보다 웹 중심 잡음과 제3의 원천 오인 위험을 크게 만든다.

선행 조사는 고정 commit `f6961238d5cddcf8042a74a70fc400ec67181abb`의 74개 파일을 검토하고 8개 원문을 심층 비교했다. 그 결과 Loop와 관련성이 높은 공개 Markdown 6개를 권고했다. 저장소의 MIT `LICENSE`는 associated documentation의 복제와 재배포를 허용하되 copyright 및 permission notice 보존을 요구한다. 이 확인은 Markdown에 한정하며 상표, 로고, screenshot, mascot, proprietary font와 원 사이트의 trade dress 사용 허가를 뜻하지 않는다. 공개 MIT tree 밖의 유료/private 산출물은 재배포 라이선스가 확인되지 않았다.

## 결정

**선별 반입을 채택한다.** OpenCode, Ollama, VoltAgent, Warp, Cursor, ClickHouse의 Markdown 원문 6개만 고정 commit 기준 외부 reference corpus로 반입한다. 반입 위치는 `docs/design/references/awesome-design-md/`다.

`docs/design/references/`는 재사용 가능한 외부 참고 스냅샷의 경계다. 조사 과정과 판정 근거를 보존하는 `docs/design/research/` 아래에는 두지 않는다. 이 분리는 조사 기록과 반입된 제3자 자료를 같은 종류의 근거로 오인하지 않게 한다. 루트 `DESIGN.md` 또는 Loop의 `docs/design/design-language.md`와 같은 이름·위치로도 두지 않는다.

### 반입 범위와 구조

후속 반입 태스크는 다음만 추가한다.

- 위 6개 `DESIGN.md`의 Markdown 본문
- corpus 최상위 `README.md` 또는 manifest: 비정본 경고, upstream repository와 고정 commit, 파일별 provenance, 분석 대상 공식 사이트 URL
- upstream MIT `LICENSE` 사본과 요구되는 저작권·허가 고지

브랜드 자산, font 파일, 이미지, screenshot 및 공개 MIT tree 밖의 파일은 반입하지 않는다. 후보의 라이선스 또는 출처를 파일 단위로 확인할 수 없으면 그 항목은 **반입에서 제외**하며 추정으로 보완하지 않는다.

### 필수 파일 헤더

각 반입 Markdown은 본문보다 앞에 사람이 즉시 볼 수 있는 다음 헤더를 가져야 한다. 값은 실제 반입 시점과 고정 원문에 맞춰 채우며 빈 값이나 `unknown`은 허용하지 않는다.

```md
> **non-canonical 외부 참고 자료 — Loop UI 규칙으로 소비 금지**
> - 출처 URL: <commit에 고정한 raw 파일 URL>
> - upstream 저장소: https://github.com/VoltAgent/awesome-design-md
> - 분석 대상: <공식 제품 사이트 URL>
> - 라이선스: MIT — <corpus에 포함한 LICENSE 상대 링크>
> - 반입일: YYYY-MM-DD
```

파일명이나 본문에 출처가 있더라도 이 헤더를 생략할 수 없다. 공식 제품 문서가 아니라 VoltAgent가 공개 표면을 분석한 제3자 문서라는 설명은 corpus manifest에도 둔다.

### 사용 정책

이 corpus는 **참고 전용이며 canonical 아님(non-canonical)**이다.

- 에이전트와 사람은 corpus의 색, 글리프, spacing, font, radius, 상태 의미 또는 금기를 Loop UI 생성 규칙으로 직접 소비하지 않는다.
- corpus는 `docs/design/design-language.md`의 canonical 본문, YAML/frontmatter, `docs/design/design.md`, ADR, 코드·테스트·설정을 직접 변경하거나 override하지 않는다.
- 허용되는 인용 지점은 `docs/design/design-language.md`의 격리된 `## Proposals / 제안` lane에 있는 제안 블록의 **`현재 근거` 필드뿐**이다. 그 안에서도 “외부 비교 사례”로 명시하고 Loop 코드·테스트·설정·ADR에서 확인한 현재 근거와 함께 적는다. corpus 인용만으로 필수 현재 근거를 충족하거나 제안을 승인할 수 없다.
- 제안 이후의 흐름은 기존 결정대로 `제안 lane → 분류·Loop 내부 근거 검토 → 필요 시 design.md 요구사항/대안과 decision 태스크 → 승인 및 구현 검증 → integration의 canonical read model 투영`이다.
- corpus가 `design-language.md`의 draft 상태나 D-1·D-3·D-4 등 승인 대기를 해소한 것으로 취급하지 않는다.

따라서 외부 사례는 아이디어를 설명하는 입력까지만 담당한다. 정책 결정과 실행 값은 계속 Loop 내부 승인 흐름과 정본이 소유한다.

### 유지와 삭제 정책

- **추적 방식:** 반입본은 고정 commit의 snapshot이다. upstream 변경을 자동 동기화하거나 정기 추적하지 않는다.
- **갱신 조건:** 실제 제안 또는 비교 조사에 필요한 경우에만 갱신한다. 갱신 시 새 commit에 고정하고 관련성, 파일별 공개 여부, 라이선스, provenance를 다시 확인하며 반입일과 manifest를 함께 바꾼다. upstream diff를 검토하지 않은 일괄 덮어쓰기는 금지한다.
- **삭제 조건:** (a) 라이선스 또는 출처 증거를 더 이상 보존·확인할 수 없음, (b) 필수 고지나 non-canonical 경계를 유지할 수 없음, (c) CLI/TUI·텍스트 환경과의 관련성이 사라져 검색 잡음이 됨, (d) 법적·보안·저장소 정책 위험이 확인됨 중 하나면 해당 문서를 삭제한다.
- **비조건:** 단순 upstream 변경이나 삭제만으로 이미 고정한 snapshot을 자동 삭제하지 않는다. 다만 당시 라이선스 고지와 provenance는 계속 보존해야 한다.
- 후보 추가는 이 ADR의 “선별·확인 후 반입” 정책을 따른 별도 검토로 한다. 공개 tree 존재만으로 자동 편입하지 않는다.

## 대안 검토

### 1. 루트 `DESIGN.md`로 반입

기각. 자동 발견성은 높지만 외부 분석을 Loop의 시각 언어 정본처럼 보이게 한다. 기존 문서 체계에서 변경 설계는 `docs/design/design.md`, 승인된 현재 언어의 read model은 `docs/design/design-language.md`, 영속 정책은 ADR이 소유한다. 루트 동명 파일은 이 경계를 흐리고 제3의 원천을 만든다.

### 2. 공개 corpus 전량 반입

기각. 고정 tree의 74개 중 다수는 자동차·리테일·미디어 등 이미지 및 웹 마케팅 중심이다. Loop에 낮은 관련성의 palette, hero, breakpoint, shadow, proprietary typography가 검색 문맥을 오염시키며 에이전트가 값을 규칙으로 복제할 가능성을 높인다. 전량의 provenance와 향후 라이선스 검토 비용도 선별 6개보다 크다.

### 3. 외부 문서를 전혀 반입하지 않고 링크만 유지

기각. 제3 원천 위험은 가장 낮지만 upstream 변경·삭제 시 검토한 정확한 원문을 재현하기 어렵고, 네트워크 없이 제안 근거를 검토할 수 없다. 고정 snapshot, 명시적 non-canonical 헤더, MIT 고지, 좁은 사용 lane을 결합하면 이 위험을 통제하면서 재현 가능한 참고 가치를 보존할 수 있다.

### 4. `docs/design/research/` 아래에 선별 반입

기각. 해당 디렉터리는 Loop가 수행한 조사 방법·판정·결론의 기록이다. 제3자 원문 snapshot을 같은 위치에 두면 내부 조사 결과와 외부 자료의 저자·증거 수준이 섞인다. `docs/design/references/`라는 별도 경계가 더 명확하다.

### 5. `docs/design/references/awesome-design-md/`에 검증된 6개만 반입

채택. 현재 요구에 필요한 CLI/TUI·텍스트 중심 사례만 보존하고, 위치·헤더·manifest·LICENSE로 외부 자료 경계를 드러낸다. 기존 `design-language.md` 제안 lane을 유일한 소비 경로로 재사용하므로 새 승인 체계나 canonical 원천도 만들지 않는다.

## 영향과 후속 반입 조건

- 코드와 실행 동작은 바뀌지 않는다.
- 후속 반입 태스크는 6개 파일 각각의 필수 헤더, 공통 manifest, MIT `LICENSE`, 고정 SHA 일치를 completion contract로 검사해야 한다.
- 유료/private 산출물 및 공개 MIT tree 밖 자료는 라이선스 미확인으로 계속 제외한다.
- 이 ADR과 corpus 사이에 불일치가 생기면 이 ADR의 경계와 사용 정책이 우선하며, 외부 자료에서 Loop 규칙을 추론하지 않는다.

## 결과

- **선택 대안:** `docs/design/references/awesome-design-md/`에 라이선스와 provenance가 확인된 CLI/TUI 관련 Markdown만 고정 snapshot으로 선별 반입한다.
- **사용 경계:** corpus는 non-canonical 참고 전용이며 `design-language.md` 제안 lane의 `현재 근거`에서 외부 비교 사례로만 인용한다. UI 생성 규칙으로 직접 소비하지 않는다.
- **ADR:** `docs/decisions/design-reference-corpus.md`
- **반입 확정 후보:** **6개** — OpenCode, Ollama, VoltAgent, Warp, Cursor, ClickHouse

## 개정 — 외부 값의 제안 lane 후보 반입 허용 (2026-09-25)

### 배경과 개정 요지

원 결정의 사용 정책은 corpus의 색·글리프 등 값을 Loop 규칙으로 소비하지 않게 하고, corpus 인용 지점을 제안 블록의 `현재 근거` 필드(외부 비교 사례로서)로만 한정했다. 이는 "값 자체"를 Loop 문서로 가져오는 경로가 없다는 뜻이어서, 외부 사례에서 패턴만 남기고 구체 값(hex 팔레트, 글리프 집합 등)은 매번 재발명해야 하는 비용이 확인됐다.

이 ADR은 위 정책을 **부분 개정**한다. corpus의 값(예: hex 팔레트, 글리프 집합)을 canonical에 바로 넣는 것은 여전히 금지하되, `docs/design/design-language.md`의 `## Proposals / 제안` lane에 **후보 값(candidate value)으로 접수하는 것을 허용**한다. 접수된 값은 승인 전까지 canonical이 아니며, 미승인 값은 그 어떤 규칙·테스트·설정으로도 소비할 수 없다.

- **개정되는 조항:** 위 "사용 정책"의 "corpus 인용은 `현재 근거` 필드뿐" 조항. 제안 블록의 `제안` 필드에 후보 값 대안집을 적는 것을 추가로 허용한다.
- **개정되지 않는 조항:** non-canonical 경계, 필수 파일 헤더, 반입 범위·구조, 유지·삭제 정책, "제안 이후 흐름"(제안 lane → 분류 → design/decision 태스크 → 승인·구현 검증 → integration 투영)은 그대로 유지한다. D-3·D-4 등 pending 결정의 선취 금지도 유지된다.

### 후보 값 접수 조건

제안 lane에 후보 값을 접수하려면 다음 조건을 모두 충족해야 한다. 하나라도 빠지면 접수로 인정하지 않는다.

1. **출처 표기 (필수):** 값의 출처 문서 상대 경로(예: `docs/design/references/awesome-design-md/cursor.md`)와 고정 commit(`f6961238d5cddcf8042a74a70fc400ec67181abb`)을 제안 블록 안에 명시한다. MIT 라이선스 snapshot임을 함께 표기한다.
2. **터미널 제약 변환 (필수):** 웹 원천의 hex 값은 그대로 쓸 수 없으므로, 제안 안에 `hex → ANSI 16/256 후보 매핑`을 명시한다. 색 값 제안에는 특히 `NO_COLOR` 환경과 비-TTY(파이프·`--json`·로그 캡처) 출력에서의 폴백(무색 텍스트 계층 유지)을 함께 적는다. 터미널에서 관찰 불가능한 값(예: 24-bit 색만 유효한 값)은 후보에서 제외한다.
3. **Loop 관측 규율 충돌 확인 (필수 확인란):** 제안자는 값이 (a) `config/policy.toml [output]`의 줄 예산(status 8 / attention 6 / findings 5)과 (b) 현재 무색 출력의 존재(`--json`, 파이프, NO_COLOR 경로)와 충돌하지 않는지 확인하고, 확인 결과를 제안 블록에 표기한다.
4. **승인 경로 연결 (필수):** 후보 값은 해당 pending 결정(D-3 불릿/글리프, D-4 색 범위 등)에 연결한다. 해당 결정이 승인되고 구현 검증이 통과하기 전까지 후보 값은 규칙으로 소비할 수 없으며, 승인 시에도 integration 태스크가 정본에서 확인한 값만 canonical에 투영한다.

### 접수 형태와 기존 제안의 관계

- 후보 값 제안은 값 대안집 형태다: 대상 pending 결정당 2개 이상의 대안 값을 나열하고, 제안자는 어느 값도 선별·확정하지 않는다. 확정은 승인 게이트의 몫이다.
- 기존 제안(DP-20260925-1~4 등)이 "값은 도입하지 않고 소유 규칙만 제안"한 것은 그대로 유효하며, 이 개정은 후속 접수에 값 대안집을 허용하는 것이지 기존 제안을 값으로 확장시키는 것이 아니다.

### 기각 대안

1. **canonical 직접 반입 허용 — 기각.** corpus 값을 `design-language.md` canonical 본문이나 코드·config에 바로 넣으면 non-canonical 헤더와 제안 lane 게이트를 우회한다. 원 결정이 막은 "제3의 원천이 Loop 규칙처럼 소비되는" 위험을 그대로 재현하며, D-3·D-4의 승인 게이트가 형해화된다.
2. **값 반입 전면 금지 유지 — 기각.** 정책은 가장 단순하지만, 검토된 6개 문서의 실질 가치(팔레트·글리프 등 구체 값)를 매번 폐기하게 된다. 후보 값을 승인 게이트 뒤에만 두면 제3 원천 위험은 통제하면서 비교 근거의 재현 가능성을 얻으므로, 전면 금지의 안전 이득은 비용 대비 과하다.

### 영향

- 코드·테스트·설정 변경은 없다. 문서 정책 개정이며, `design-language.md` 본문·`design.md` 본문·references 문서 자체는 수정하지 않는다.
- 후속 접수 태스크는 위 4개 조건을 completion contract의 검사 항목으로 삼는다.

### 결과

- **개정 요지:** (1) corpus의 값(hex 팔레트·글리프 집합 등)을 canonical에 바로 넣는 것은 여전히 금지하되, `design-language.md` 제안 lane에 출처·터미널 제약 변환을 명시한 후보 값으로 접수하는 것을 허용한다. (2) 접수된 값은 승인 전까지 canonical이 아니며 D-3·D-4 등 해당 pending 결정의 승인과 구현 검증 전까지 규칙으로 소비할 수 없다.
- **새 섹션 제목:** `개정 — 외부 값의 제안 lane 후보 반입 허용 (2026-09-25)`
