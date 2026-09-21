# CLI 출력면과 attention 정책 적용 현황

조사 기준: 2026-09-21 현재 작업 트리. 범위는 `packages/cli/src/main.ts`의 사용자 노출 출력이며, 인접 테스트와 `pi-loop` 구현은 별도 보강 근거로만 사용했다. 아래 인용의 줄 번호는 조사 시점 파일 기준이다. 소스·설정·테스트는 수정하지 않았다.

## 결론

- CLI의 human-readable snapshot 출력은 `LoopConfig.attention`을 받지 않는다. `formatSnapshot`은 `command`와 snapshot만 받고, `configuration()`은 설정을 로드하지만 attention 필드를 전달하지 않는다. [`packages/cli/src/main.ts:207-212`](../../packages/cli/src/main.ts#L207-L212), [`packages/cli/src/main.ts:363-388`](../../packages/cli/src/main.ts#L363-L388)
- `config/policy.toml`의 `status_line_limit = 8`, `attention_line_limit = 6`, `maximum_findings = 5`는 orchestrator config에서 파싱·검증되지만, 현재 저장소 검색에서 이 필드의 실제 소비자는 `packages/orchestrator/src/config.ts` 자체(정의·파싱)뿐이다. CLI 또는 `pi-loop` 렌더러로 전파되는 경로는 확인되지 않았다. [`config/policy.toml:18-21`](../../config/policy.toml#L18-L21), [`packages/orchestrator/src/config.ts:45-49`](../../packages/orchestrator/src/config.ts#L45-L49), [`packages/orchestrator/src/config.ts:112-153`](../../packages/orchestrator/src/config.ts#L112-L153)
- 따라서 `main.ts`의 `checks.slice(0, 7)`은 `maximum_findings = 5` 정책과 불일치한다. 더 직접적으로는 이 slice가 doctor check 출력에만 적용되고, findings 배열을 다루는 코드가 아니다. [`packages/cli/src/main.ts:268-276`](../../packages/cli/src/main.ts#L268-L276)

## `main.ts` 사용자 노출 출력면

| 출력면 | 경로·줄 | 실제 출력/제한 | 정책 연결 여부 |
|---|---|---|---|
| 상태 (`status`) | [`main.ts:70-84`](../../packages/cli/src/main.ts#L70-L84), [`main.ts:380-387`](../../packages/cli/src/main.ts#L380-L387) | human-readable 기본 상태는 Run, State, Tasks, Workers, Attention의 5줄이다. `slice`는 없다. `--json`은 snapshot 전체를 JSON으로 출력한다. | 없음. `statusLineLimit`을 읽지 않는다. |
| 태스크/그래프 (`graph`) | [`main.ts:363-372`](../../packages/cli/src/main.ts#L363-L372) | `snapshot.tasks.slice(0, 8)`로 최대 8개 태스크를 `id · state` 한 줄씩 출력한다. 빈 목록에 대한 대체 문구는 없다. | 없음. 8은 하드코딩이다. |
| 워커 (`workers`) | [`main.ts:363-375`](../../packages/cli/src/main.ts#L363-L375) | `snapshot.activeWorkers.slice(0, 8)`로 최대 8개를 `id · taskId` 한 줄씩 출력하고, 비면 `No active workers`를 출력한다. | 없음. 8은 하드코딩이다. |
| 어텐션 (`attention`) | [`main.ts:363-379`](../../packages/cli/src/main.ts#L363-L379) | `snapshot.openAttentionIds.slice(0, 5)`로 최대 5개 ID를 한 줄씩 출력하고, 비면 `OK`를 출력한다. | 없음. `attentionLineLimit`을 읽지 않는다. |
| 체크 (`doctor`) | [`main.ts:232-276`](../../packages/cli/src/main.ts#L232-L276) | 체크를 수집한 뒤 human-readable 모드에서 `checks.slice(0, 7)`만 출력한다. JSON 모드는 `checks` 전체를 출력한다. 체크 세부 문자열은 `bounded()`로 최대 4,000문자(뒤쪽 기준)로 잘린다. [`main.ts:537-545`](../../packages/cli/src/main.ts#L537-L545), [`main.ts:574-575`](../../packages/cli/src/main.ts#L574-L575) | 없음. `maximumFindings`와 연결되지 않는다. |

참고로 `verify-install` human-readable 출력은 고정된 5개 항목(제목 포함)을 출력하며, 이는 attention/status 정책의 소비로 보이지 않는다. [`main.ts:96-106`](../../packages/cli/src/main.ts#L96-L106)

## 정책 정의·파싱과 실제 소비의 분리

### 정의와 파싱

| 정책 | 정의값 | orchestrator 타입/파싱 위치 |
|---|---:|---|
| `attention.maximum_findings` | 5 | `LoopConfig.attention.maximumFindings`: [`packages/orchestrator/src/config.ts:45-49`](../../packages/orchestrator/src/config.ts#L45-L49); TOML을 positive integer로 변환: [`packages/orchestrator/src/config.ts:146-148`](../../packages/orchestrator/src/config.ts#L146-L148) |
| `attention.status_line_limit` | 8 | `LoopConfig.attention.statusLineLimit`: [`packages/orchestrator/src/config.ts:45-49`](../../packages/orchestrator/src/config.ts#L45-L49); TOML을 positive integer로 변환: [`packages/orchestrator/src/config.ts:147-149`](../../packages/orchestrator/src/config.ts#L147-L149) |
| `attention.attention_line_limit` | 6 | `LoopConfig.attention.attentionLineLimit`: [`packages/orchestrator/src/config.ts:45-49`](../../packages/orchestrator/src/config.ts#L45-L49); TOML을 positive integer로 변환: [`packages/orchestrator/src/config.ts:149-153`](../../packages/orchestrator/src/config.ts#L149-L153) |

로드 흐름은 `loadLoopConfig()`가 policy TOML의 `attention` record를 읽고 위 세 값을 반환 객체에 넣는 것이다. [`packages/orchestrator/src/config.ts:90-115`](../../packages/orchestrator/src/config.ts#L90-L115), [`packages/orchestrator/src/config.ts:128-153`](../../packages/orchestrator/src/config.ts#L128-L153)

### 실제 소비처

현재 소스 검색에서 위 camelCase/snake_case 필드의 참조는 `config.ts`의 인터페이스·파싱과 설정 파일/설정 테스트뿐이었다. 즉 확인된 것은 “설정값을 읽어 `LoopConfig`에 보관”하는 단계이며, 해당 값을 사용해 출력 한도를 계산하는 소비처는 확인되지 않았다.

- CLI는 `configuration()`에서 `LoopConfig`를 로드한다. 그러나 snapshot 렌더러 호출은 `formatSnapshot(parsed.command, snapshot)`이며 attention 설정을 인자로 넘기지 않는다. [`packages/cli/src/main.ts:70-84`](../../packages/cli/src/main.ts#L70-L84), [`packages/cli/src/main.ts:207-212`](../../packages/cli/src/main.ts#L207-L212)
- CLI의 `doctor()`는 `config`를 받지만 provider/lead/auth 확인에만 사용한다. 출력 제한은 별도 상수 `7`이다. [`packages/cli/src/main.ts:232-276`](../../packages/cli/src/main.ts#L232-L276), [`packages/cli/src/main.ts:279-325`](../../packages/cli/src/main.ts#L279-L325)
- 실행 경로의 `LoopRuntime` 생성에도 config는 provider registry, database path, scheduler worker 수로만 분해되어 전달되며 attention 정책은 전달되지 않는다. [`packages/cli/src/main.ts:108-120`](../../packages/cli/src/main.ts#L108-L120)

## `pi-loop`/CLI 전파 여부

전파 경로는 확인되지 않았다. `main.ts`는 interactive lead를 `--provider`와 `--model` 인자로 실행할 뿐 attention 정책을 인자로 전달하지 않는다. [`packages/cli/src/main.ts:214-229`](../../packages/cli/src/main.ts#L214-L229), [`packages/cli/src/main.ts:390-413`](../../packages/cli/src/main.ts#L390-L413)

### 외부 보강 근거: `pi-loop` (main.ts 범위 밖)

다음은 요청 범위 밖의 구현을 정책 전파 여부를 확인하기 위한 보강 근거로만 기록한다.

- `pi-loop` extension의 snapshot 렌더러는 graph와 workers를 각각 7개, attention을 5개로 하드코딩한다. [`packages/pi-loop/src/extension.ts:314-332`](../../packages/pi-loop/src/extension.ts#L314-L332)
- `pi-loop` UI 모듈은 별도의 고정 한도를 가진다: worker 8개, attention 전체 6줄, summary 전체 8줄, status stages 6개 후 전체 8줄. [`packages/pi-loop/src/ui/worker.ts:8-14`](../../packages/pi-loop/src/ui/worker.ts#L8-L14), [`packages/pi-loop/src/ui/attention.ts:8-16`](../../packages/pi-loop/src/ui/attention.ts#L8-L16), [`packages/pi-loop/src/ui/summary.ts:9-24`](../../packages/pi-loop/src/ui/summary.ts#L9-L24), [`packages/pi-loop/src/ui/status.ts:15-31`](../../packages/pi-loop/src/ui/status.ts#L15-L31)
- findings의 5개 제한은 `pi-loop` lead reducer의 `compactFindings()`에 하드코딩되어 있다. 이는 `config.attention.maximumFindings`를 참조하지 않는다. [`packages/pi-loop/src/lead/reduce.ts:8-12`](../../packages/pi-loop/src/lead/reduce.ts#L8-L12)

이 보강 근거를 종합하면 정책 숫자와 일부 우연히 일치하는 값은 있으나, `LoopConfig`에서 CLI/`pi-loop` 렌더러로 값을 전달하는 호출·인자·의존성은 보이지 않는다. 또한 구현 간 숫자도 일관되지 않는다(`main.ts` graph/workers 8, `pi-loop` extension graph/workers 7).

## 불일치와 미확인 사항

1. 사실로 확인된 불일치: `maximum_findings = 5`인데 CLI human-readable doctor 출력은 `checks.slice(0, 7)`이다. 체크는 findings와 타입·데이터 구조가 다르므로, 이는 “findings 정책을 7로 적용했다”기보다 정책을 소비하지 않는 별도 체크 출력 제한이다.
2. 사실로 확인된 미연결: `status_line_limit = 8` 및 `attention_line_limit = 6`은 파싱되지만 `main.ts`의 status/attention renderer에 전달되지 않는다. `main.ts` status는 현재 5개 고정 라인이고 attention ID는 5개로 잘린다.
3. 미확인/범위 밖: 실제 배포된 번들의 별도 빌드 산출물, 외부 `pi` 자체의 출력, 런타임이 config를 다른 프로세스 환경변수나 파일로 간접 전달하는지 여부는 이번 조사에서 검증하지 않았다. 저장소 소스 기준으로는 그런 전달 참조를 찾지 못했다.

## 외부 테스트 보강 근거

테스트는 구현 사실의 보조 확인으로만 사용했다.

- `packages/cli/test/cli.test.ts`는 status JSON, doctor checks JSON, interactive provider/model 인자를 확인하지만 human-readable graph/workers/attention/status 한도는 직접 검증하지 않는다. [`packages/cli/test/cli.test.ts:29-71`](../../packages/cli/test/cli.test.ts#L29-L71), [`packages/cli/test/cli.test.ts:73-105`](../../packages/cli/test/cli.test.ts#L73-L105)
- `packages/pi-loop/test/ui.test.ts`는 status를 8줄 이하, attention을 6줄 이하, findings를 5개로 제한한다는 별도 UI 계약을 검증한다. 이는 `main.ts`의 계약이 아니다. [`packages/pi-loop/test/ui.test.ts:11-60`](../../packages/pi-loop/test/ui.test.ts#L11-L60)
- `packages/orchestrator/test/config.test.ts`의 fixture는 세 정책값을 5/8/6으로 설정한다. 이는 파싱 입력의 보강 근거이지, CLI/`pi-loop` 소비 증거는 아니다. [`packages/orchestrator/test/config.test.ts:99-115`](../../packages/orchestrator/test/config.test.ts#L99-L115)

