/**
 * persona.ts — persona management extension for the pi coding agent.
 *
 * Features
 * - `/persona` command: no args opens an interactive select; an argument selects directly
 *   (`/persona reviewer security` 처럼 reviewer의 검토 모드까지 지정 가능)
 * - Built-in personas (Korean labels): 구현자 implementer, 코드 리뷰어 reviewer,
 *   디버거 debugger, 아키텍트 architect. reviewer는 모드(security|performance|spec|readability) 지원.
 * - User-defined personas: ~/.pi/agent/personas/*.md (파일명 = 이름, 본문 = 주입 문구).
 *   빌트인 이후에 병합되며, 이름이 겹치면 사용자 정의가 우선한다.
 * - auto mode (첫 실행 시 기본): session_start에서 프로젝트 신호를 보고 시작 페르소나를 고른다.
 * - System prompt injection via `before_agent_start` (pirate.ts 패턴)
 * - Persistence via `pi.appendEntry` — 세션 재시작/브랜치 이동 시 복원 (todo.ts 재구성 패턴)
 * - Footer status via `ctx.ui.setStatus('persona', ...)`
 *
 * Install: copy to ~/.pi/agent/extensions/persona.ts
 */

import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Persona {
	/** Stable id used in `/persona <name>` and persisted state */
	name: string;
	/** Korean display label */
	label: string;
	/** Short description shown in the interactive select */
	description: string;
	/** Optional selectable sub-modes (reviewer only) */
	modes?: readonly string[];
	/** Build the instruction block appended to the system prompt */
	instructions: (mode?: string) => string;
	builtin: boolean;
}

export type ActiveSelection =
	| { kind: 'persona'; name: string; mode?: string }
	| { kind: 'auto' }
	| { kind: 'off' };

/** Shape of the custom session entry written with pi.appendEntry */
interface PersonaEntryData {
	persona: string | null;
	mode?: string;
	auto?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTRY_TYPE = 'persona-state';
const REVIEWER_MODES = ['security', 'performance', 'spec', 'readability'] as const;
const DEFAULT_REVIEWER_MODE: string = 'security';
const STATUS_KEY = 'persona';
const USER_PERSONA_DIR = path.join(os.homedir(), '.pi', 'agent', 'personas');

// ---------------------------------------------------------------------------
// Built-in persona instruction blocks
// ---------------------------------------------------------------------------

const IMPLEMENTER_INSTRUCTIONS = `## 페르소나: 구현자 (implementer)

지금부터 요구사항을 정확하고 빠르게 구현하는 시니어 개발자로 동작한다.

- 요청된 기능 구현이 최우선이다. 범위 밖 리팩터링, 파일 재구성, 부수적 개선을 하지 않는다.
- 작업 전 기존 코드의 스타일·규칙·구조를 먼저 관찰하고 그대로 따른다.
- 작은 단위로 나누어 구현하고, 각 단계가 컴파일·테스트를 통과하는 검증 가능한 상태를 유지한다.
- 프로젝트에 테스트 관례가 있으면 테스트를 함께 작성하고 실행해 증거를 남긴다.
- 불확실하거나 모호한 요구사항은 구현 전에 모아서 한 번에 확인한다.
- 완료 보고에는 무엇을, 어디에, 어떻게 검증했는지 명시한다.`;

const REVIEWER_BASE_INSTRUCTIONS = `## 페르소나: 코드 리뷰어 (reviewer)

지금부터 코드 변경을 검토하는 리뷰어로 동작한다. 구현을 대신하지 않는다.

- 변경사항을 사실 기반으로 검토하고, 각 지적에 근거(파일·위치·시나리오)를 붙인다.
- 문제를 심각도(차단 / 권장 / 니트픽)로 구분해 보고한다.
- 수정 제안은 최소 변경으로, 가능하면 구체적인 코드 형태로 제시한다.
- 현재 검토 모드의 관점을 최우선으로 하되, 치명적인 다른 영역의 문제는 함께 알린다.`;

const REVIEWER_MODE_INSTRUCTIONS: Record<string, string> = {
	security: `### 검토 모드: security

- 인증·인가 우회, 입력 검증 누락, 경로 순회, 명령·SQL 인젝션, 안전하지 않은 역직렬화를 중심으로 본다.
- 시크릿·자격 증명의 하드코딩, 로그·에러 메시지를 통한 민감정보 유출을 확인한다.
- 외부 입력 경계(파싱, 인코딩, 크기 제한)와 안전하지 않은 기본값을 점검한다.
- 의존성 설치·도구 실행에 주입 가능한 문자열이 전달되는 경로를 추적한다.`,
	performance: `### 검토 모드: performance

- 반복 호출·N+1 조회, 동기 블로킹 I/O, 불필요한 복사와 변환, 비효율적인 자료구조를 찾는다.
- 핫패스 기준으로 측정하거나 추정 가능한 병목만 지적한다. 추측성 최적화는 제안하지 않는다.
- 알고리즘 복잡도와 데이터 크기 증가 시 동작 변화를 평가한다.
- 개선안은 예상 효과와 측정 방법을 함께 제시한다.`,
	spec: `### 검토 모드: spec

- 요구사항·명세(이슈, 태스크 정의, PR 설명)와 구현의 불일치를 찾는다.
- 누락된 요구사항, 범위 밖 과잉 구현, 경계 조건과 오류 처리의 명세 위반을 지적한다.
- 검증 조건(완료 기준)이 실제로 충족되는지 확인 가능한 형태로 대조한다.
- 명세가 모호한 지점을 목록화하고 해석 차이를 질문으로 정리한다.`,
	readability: `### 검토 모드: readability

- 명명, 함수·모듈 크기, 중복, 제어 흐름 복잡도, 주석·문서 품질 위주로 본다.
- 동작 변경 없이 가독성을 높이는 최소 수정만 제안한다.
- 팀 컨벤션·기존 스타일과의 불일치를 지적한다.
- '왜'를 설명하는 주석은 남기고, '무엇'을 반복하는 주석은 제거를 제안한다.`,
};

const DEBUGGER_INSTRUCTIONS = `## 페르소나: 디버거 (debugger)

지금부터 원인 규명에 집중하는 디버깅 전문가로 동작한다.

- 가설 → 최소 재현 → 관찰 → 검증 루프로 진행한다. 근거 없이 수정하지 않는다.
- 수정 전에 원인을 한 문장으로 명시하고, 그 원인을 확인한 증거를 제시한다.
- 증상만 가리는 패치(워크어라운드)가 필요하면 그렇게 표시하고, 근본 원인 수정을 함께 제안한다.
- 재현 절차와 관찰 결과를 기록하고, 수정 후 동일 절차로 재발 여부를 확인한다.
- 원인 후보가 여럿이면 검증 비용이 낮은 것부터 확인한다.`;

const ARCHITECT_INSTRUCTIONS = `## 페르소나: 아키텍트 (architect)

지금부터 시스템 구조와 장기 유지보수성을 책임지는 아키텍트로 동작한다.

- 구현 전에 모듈 경계, 의존성 방향, 데이터 흐름을 먼저 정의한다.
- 계층 위반, 순환 의존, 도메인 로직의 인프라 누수를 경계하고 발견하면 지적한다.
- 트레이드오프는 대안 2개 이상과 함께 제시하고, 결정과 근거를 기록으로 남긴다.
- 현재 요구에 맞는 가장 단순한 구조를 기본으로 삼되, 확장 지점은 비용이 낮을 때만 만든다.
- 변경은 기존 경계를 존중하는 방향으로 설계하고, 경계를 옮겨야 한다면 그 영향 범위를 명시한다.`;

const reviewerInstructions = (mode?: string) => {
	const m = mode && REVIEWER_MODE_INSTRUCTIONS[mode] ? mode : DEFAULT_REVIEWER_MODE;
	return `${REVIEWER_BASE_INSTRUCTIONS}\n\n${REVIEWER_MODE_INSTRUCTIONS[m]}`;
};

// ---------------------------------------------------------------------------
// Built-in personas
// ---------------------------------------------------------------------------

const BUILTIN_PERSONAS: Persona[] = [
	{
		name: 'implementer',
		label: '구현자',
		description: '요구사항을 정확히 구현하는 기본 개발 페르소나',
		instructions: () => IMPLEMENTER_INSTRUCTIONS,
		builtin: true,
	},
	{
		name: 'reviewer',
		label: '코드 리뷰어',
		description: '변경 검토 전문 — 모드: security|performance|spec|readability',
		modes: REVIEWER_MODES,
		instructions: reviewerInstructions,
		builtin: true,
	},
	{
		name: 'debugger',
		label: '디버거',
		description: '가설·재현·검증 루프로 근본 원인을 추적',
		instructions: () => DEBUGGER_INSTRUCTIONS,
		builtin: true,
	},
	{
		name: 'architect',
		label: '아키텍트',
		description: '경계·의존성·트레이드오프 중심의 설계 관점',
		instructions: () => ARCHITECT_INSTRUCTIONS,
		builtin: true,
	},
];

// ---------------------------------------------------------------------------
// Filesystem helpers (all best-effort, never throw)
// ---------------------------------------------------------------------------

function existsSafe(p: string): boolean {
	try {
		return fs.existsSync(p);
	} catch {
		return false;
	}
}

interface ProjectSignals {
	agentsMd: boolean;
	packageJson: boolean;
	git: boolean;
}

function detectProjectSignals(cwd: string): ProjectSignals {
	return {
		agentsMd: existsSafe(path.join(cwd, 'AGENTS.md')),
		packageJson: existsSafe(path.join(cwd, 'package.json')),
		git: existsSafe(path.join(cwd, '.git')),
	};
}

interface AutoResolution {
	persona?: Persona;
	reason: string;
}

/**
 * Auto mode decision:
 * 1. AGENTS.md       → architect  (규칙/컨벤션 문서가 있는 프로젝트는 설계·경계 관점이 유용)
 * 2. package.json    → implementer (패키지 기반 코드 프로젝트의 기본값)
 * 3. .git            → implementer (코드 저장소이지만 다른 신호가 없는 경우)
 * 4. 신호 없음       → 페르소나 미적용 (off)
 */
function resolveAuto(cwd: string): AutoResolution {
	const signals = detectProjectSignals(cwd);
	if (signals.agentsMd) return { persona: BUILTIN_PERSONAS[3], reason: 'AGENTS.md 감지' };
	if (signals.packageJson) return { persona: BUILTIN_PERSONAS[0], reason: 'package.json 감지' };
	if (signals.git) return { persona: BUILTIN_PERSONAS[0], reason: 'git 저장소 감지' };
	return { reason: '프로젝트 신호 없음' };
}

/**
 * Load user-defined personas from ~/.pi/agent/personas/*.md.
 * Filename (minus .md) = name, file content = injected instructions.
 * Absence of the directory or read errors is not a failure — returns [].
 */
function loadUserPersonas(): Persona[] {
	let files: string[];
	try {
		files = fs.readdirSync(USER_PERSONA_DIR);
	} catch {
		return [];
	}
	const personas: Persona[] = [];
	for (const file of files.sort()) {
		if (!file.endsWith('.md')) continue;
		try {
			const content = fs.readFileSync(path.join(USER_PERSONA_DIR, file), 'utf8');
			if (!content.trim()) continue;
			const name = file.slice(0, -'.md'.length);
			personas.push({
				name,
				label: name,
				description: '사용자 정의 페르소나 (~/.pi/agent/personas)',
				instructions: () => content,
				builtin: false,
			});
		} catch {
			// 읽지 못하는 파일은 조용히 무시한다.
		}
	}
	return personas;
}

/** Built-ins merged with user personas (user definitions win on name collision). */
function getAllPersonas(): Persona[] {
	const byName = new Map<string, Persona>();
	for (const p of BUILTIN_PERSONAS) byName.set(p.name, p);
	for (const p of loadUserPersonas()) byName.set(p.name, p);
	return [...byName.values()];
}

// ---------------------------------------------------------------------------
// Pure selection helpers (exported for tests)
// ---------------------------------------------------------------------------

/** 유효 페르소나 해석 (순수). off 또는 알 수 없는 이름이면 undefined. */
export function effectiveSelection(
	selection: ActiveSelection,
	cwd: string,
): { persona: Persona; mode?: string } | undefined {
	if (selection.kind === 'off') return undefined;
	if (selection.kind === 'auto') {
		const resolved = resolveAuto(cwd);
		return resolved.persona ? { persona: resolved.persona } : undefined;
	}
	const persona = getAllPersonas().find((p) => p.name === selection.name);
	if (!persona) return undefined;
	const mode = selection.mode ?? (persona.modes ? DEFAULT_REVIEWER_MODE : undefined);
	return { persona, mode };
}

/** Footer 상태 텍스트 (순수). 페르소나 미적용이면 undefined (setStatus로 지움). */
export function statusTextFor(selection: ActiveSelection, cwd: string): string | undefined {
	const eff = effectiveSelection(selection, cwd);
	if (!eff) return undefined;
	const modeSuffix = eff.mode ? `·${eff.mode}` : '';
	const autoTag = selection.kind === 'auto' ? ' (auto)' : '';
	return `🎭 ${eff.persona.label}${modeSuffix}${autoTag}`;
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

const RUN_START_EVENT = 'loop:run-start';

export default function personaExtension(pi: ExtensionAPI) {
	/** 현재 선택. 첫 실행(저장된 항목이 없을 때)의 기본값은 auto. */
	let selection: ActiveSelection = { kind: 'auto' };

	/** Bus handlers receive no ctx; reuse the latest session ctx (todo-widget과 동일). */
	let latestCtx: ExtensionContext | undefined;

	const findPersona = (name: string): Persona | undefined =>
		getAllPersonas().find((p) => p.name === name);

	/** 유효 페르소나 해석. off 또는 알 수 없는 이름이면 undefined. */
	const effective = (cwd: string) => effectiveSelection(selection, cwd);

	/** Footer 상태 텍스트. 페르소나 미적용이면 undefined (setStatus로 지움). */
	const statusText = (cwd: string) => statusTextFor(selection, cwd);

	const updateStatus = (ctx: ExtensionContext) => {
		ctx.ui.setStatus(STATUS_KEY, statusText(ctx.cwd));
	};

	/** 선택을 세션에 영속화 (재시작·브랜치 이동 후 복원 대상). */
	const persist = (sel: ActiveSelection) => {
		const data: PersonaEntryData =
			sel.kind === 'persona'
				? { persona: sel.name, mode: sel.mode }
				: sel.kind === 'auto'
					? { persona: null, auto: true }
					: { persona: null };
		pi.appendEntry(ENTRY_TYPE, data);
	};

	const notifyAutoResolution = (ctx: ExtensionContext) => {
		const resolved = resolveAuto(ctx.cwd);
		if (resolved.persona) {
			ctx.ui.notify(`페르소나 auto: ${resolved.persona.label} 적용 (${resolved.reason})`, 'info');
		} else {
			ctx.ui.notify(`페르소나 auto: 미적용 (${resolved.reason})`, 'info');
		}
	};

	/** 선택 적용: 상태 갱신 + 알림 + 상태줄 + 영속화 */
	const apply = (ctx: ExtensionContext, sel: ActiveSelection) => {
		selection = sel;
		if (sel.kind === 'auto') {
			notifyAutoResolution(ctx);
		} else if (sel.kind === 'off') {
			ctx.ui.notify('페르소나를 끕니다', 'info');
		} else {
			const persona = findPersona(sel.name);
			const modeSuffix = sel.mode ? ` (${sel.mode})` : '';
			ctx.ui.notify(`페르소나 적용: ${persona?.label ?? sel.name}${modeSuffix}`, 'info');
		}
		updateStatus(ctx);
		persist(sel);
	};

	/**
	 * 세션 브랜치에서 마지막 persona-state 항목을 찾아 상태를 복원한다.
	 * getBranch()를 쓰므로 브랜치 이동(/tree, fork, clone) 시에도 올바른 시점의 상태를 얻는다.
	 */
	const reconstruct = (ctx: ExtensionContext): ActiveSelection => {
		let restored: ActiveSelection | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			const e = entry as { type: string; customType?: string; data?: PersonaEntryData };
			if (e.type !== 'custom' || e.customType !== ENTRY_TYPE || !e.data) continue;
			if (e.data.auto) restored = { kind: 'auto' };
			else if (e.data.persona) restored = { kind: 'persona', name: e.data.persona, mode: e.data.mode };
			else restored = { kind: 'off' };
		}
		return restored ?? { kind: 'auto' };
	};

	// --- 세션 수명 주기: 상태 복원 + auto 해석 + 상태줄 -----------------------

	pi.on('session_start', async (_event, ctx) => {
		latestCtx = ctx;
		selection = reconstruct(ctx);
		if (selection.kind === 'auto') {
			notifyAutoResolution(ctx);
		} else if (selection.kind === 'persona' && !findPersona(selection.name)) {
			ctx.ui.notify(
				`저장된 페르소나 '${selection.name}'을(를) 찾을 수 없습니다. /persona 로 다시 선택하세요`,
				'warning',
			);
		}
		updateStatus(ctx);
	});

	// /tree 등으로 브랜치가 바뀌면 그 시점의 상태로 되돌린다 (알림 없이 상태줄만 갱신).
	pi.on('session_tree', async (_event, ctx) => {
		latestCtx = ctx;
		selection = reconstruct(ctx);
		updateStatus(ctx);
	});

	// --- Loop 실행 시작 시 상태 재단얼 (loop:run-start) ---------------------
	// packages/pi-loop 확장이 run 경계마다 발행하는 이벤트(D5). 페르소나가
	// 활성인 동안 실행 시작 시 상태줄을 다시 선언하고 1회 info 알림을 낸다.
	// Loop 확장이 없는 환경에서는 이벤트가 없으므로 기존과 동일하게 동작한다.
	if (pi.events) {
		pi.events.on(RUN_START_EVENT, () => {
			const ctx = latestCtx;
			if (!ctx) return;
			const text = statusTextFor(selection, ctx.cwd);
			if (!text) return;
			try {
				ctx.ui.setStatus(STATUS_KEY, text);
				ctx.ui.notify(`${text} — Loop 실행 시작`, 'info');
			} catch {
				// 세션 교체로 ctx가 낡았다면 다음 session_start에서 회복된다.
			}
		});
	}

	// --- 시스템 프롬프트 주입 (pirate.ts 패턴) --------------------------------

	pi.on('before_agent_start', async (event, ctx) => {
		const eff = effective(ctx.cwd);
		if (!eff) return undefined;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${eff.persona.instructions(eff.mode)}`,
		};
	});

	// --- /persona 명령 ---------------------------------------------------------

	const selectPersonaInteractively = async (ctx: ExtensionContext) => {
		const personas = getAllPersonas();
		const choices = [
			...personas.map((p) => `${p.label} (${p.name})`),
			'auto — 프로젝트 신호 기반 자동 선택',
			'off — 페르소나 끄기',
		];
		const chosen = await ctx.ui.select('페르소나 선택', choices);
		if (!chosen) return;
		if (chosen.startsWith('auto')) {
			apply(ctx, { kind: 'auto' });
			return;
		}
		if (chosen.startsWith('off')) {
			apply(ctx, { kind: 'off' });
			return;
		}
		const persona = personas.find((p) => chosen.endsWith(`(${p.name})`));
		if (!persona) return;
		if (persona.modes) {
			const mode = await ctx.ui.select(`${persona.label} 검토 모드 선택`, [...persona.modes]);
			if (!mode) return;
			apply(ctx, { kind: 'persona', name: persona.name, mode });
		} else {
			apply(ctx, { kind: 'persona', name: persona.name });
		}
	};

	pi.registerCommand('persona', {
		description: '에이전트 페르소나 선택 (구현자/코드 리뷰어/디버거/아키텍트/off/auto)',
		getArgumentCompletions: (prefix: string) => {
			const tokens = prefix.trim().split(/\s+/).filter(Boolean);
			if (tokens.length <= 1) {
				const head = tokens[0] ?? '';
				const items = [
					...getAllPersonas().map((p) => ({ value: p.name, label: `${p.label} — ${p.description}` })),
					{ value: 'auto', label: '프로젝트 신호 기반 자동 선택' },
					{ value: 'off', label: '페르소나 끄기' },
				].filter((item) => item.value.startsWith(head));
				return items.length > 0 ? items : null;
			}
			if (tokens[0] === 'reviewer') {
				const last = tokens[1] ?? '';
				const items = REVIEWER_MODES.filter((m) => m.startsWith(last)).map((m) => ({
					value: `reviewer ${m}`,
					label: `코드 리뷰어 검토 모드: ${m}`,
				}));
				return items.length > 0 ? items : null;
			}
			return null;
		},
		handler: async (args, ctx) => {
			const trimmed = (args ?? '').trim();
			if (!trimmed) {
				await selectPersonaInteractively(ctx);
				return;
			}

			const [head, ...rest] = trimmed.split(/\s+/);
			const name = head.toLowerCase();

			if (name === 'off') {
				apply(ctx, { kind: 'off' });
				return;
			}
			if (name === 'auto') {
				apply(ctx, { kind: 'auto' });
				return;
			}

			const persona = findPersona(name);
			if (!persona) {
				const available = [...getAllPersonas().map((p) => p.name), 'auto', 'off'].join(', ');
				ctx.ui.notify(`알 수 없는 페르소나: '${head}' (사용 가능: ${available})`, 'error');
				return;
			}

			if (persona.modes) {
				const mode = rest[0]?.toLowerCase();
				if (mode && persona.modes.includes(mode)) {
					apply(ctx, { kind: 'persona', name: persona.name, mode });
					return;
				}
				if (mode) {
					ctx.ui.notify(
						`알 수 없는 검토 모드: '${mode}' (${persona.modes.join('|')} 중에서 선택하세요)`,
						'warning',
					);
				}
				if (!ctx.hasUI) {
					// 대화형 선택이 불가능한 환경이면 기본 모드로 바로 적용한다.
					apply(ctx, { kind: 'persona', name: persona.name, mode: DEFAULT_REVIEWER_MODE });
					return;
				}
				const chosen = await ctx.ui.select(`${persona.label} 검토 모드 선택`, [...persona.modes]);
				if (!chosen) return;
				apply(ctx, { kind: 'persona', name: persona.name, mode: chosen });
				return;
			}

			if (rest.length > 0) {
				ctx.ui.notify(`'${persona.name}' 페르소나에는 추가 인자가 없습니다. 무시함: ${rest.join(' ')}`, 'warning');
			}
			apply(ctx, { kind: 'persona', name: persona.name });
		},
	});
}
