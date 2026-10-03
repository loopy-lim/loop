import { buildSystemPrompt, initialMessages } from "./context";
import { DEFAULT_LANE_CAP, ToolLaneScheduler } from "./lanes";
import type {
  ModelTurnOutput,
  ToolDeclaration,
  ToolRunner,
  TurnLoopEvent,
  TurnLoopFailureReason,
  TurnLoopMessage,
  TurnLoopOptions,
  TurnLoopOutcome,
} from "./types";

export const DEFAULT_MAX_TURNS = 16;

const NO_TOOLS: readonly ToolDeclaration[] = [];

const reportToolUnavailable: ToolRunner = {
  async run(call) {
    return {
      output: `tool ${call.name} is not available to this worker`,
      isError: true,
    };
  },
};

/**
 * Deterministic own-turn loop (M-TL1). Each model turn either ends the run or
 * issues tool calls; issuing appends fixed-shape in-progress slots and starts
 * parallel lanes bounded by the configured cap. Every tool completion
 * substitutes its slot in place and triggers the next model turn through a
 * single wake — the model never waits for the whole batch and never polls.
 * A final message only ends the run once nothing is outstanding; while tools
 * are still in flight the next completion wakes the next turn so the model
 * sees every final. Context growth is append-only plus in-place slot
 * substitution, so the prefix before the earliest open slot never changes at
 * a turn boundary. Tool failures feed back as error results, aborts are
 * prompt at the wait boundary, and every model turn stays atomic.
 *
 * Steering (M-TL2) enters only at turn boundaries: queued steers drain at the
 * top of every iteration and append as user messages before the next model
 * call. A steer never interrupts the turn in flight — the current model call
 * and its tool lanes run to their boundary untouched.
 */
export async function startTurnLoop(options: TurnLoopOptions): Promise<TurnLoopOutcome> {
  const modelClient = options.modelClient;
  const toolRunner = options.toolRunner ?? reportToolUnavailable;
  const tools = options.tools ?? NO_TOOLS;
  const maxTurns = Math.max(1, options.maxTurns ?? DEFAULT_MAX_TURNS);
  const laneCap = Math.max(1, options.laneCap ?? DEFAULT_LANE_CAP);
  const emit = (event: TurnLoopEvent) => options.onEvent?.(event);
  const signal = options.signal;
  const steerInbox = options.steerInbox;

  const messages: TurnLoopMessage[] = initialMessages(options.prompt);
  const system = options.system ?? buildSystemPrompt();
  let turns = 0;
  let toolCallCount = 0;
  const lanes = new ToolLaneScheduler({
    runner: toolRunner,
    tools,
    laneCap,
    messages,
    emit,
    recordInProgress: options.inProgressToolResults !== false,
  });

  try {
    while (turns < maxTurns) {
      if (signal?.aborted) return aborted(messages, turns, toolCallCount);
      // Turn-boundary steering (M-TL2): everything queued since the last
      // boundary enters here, before the next model call. No timed window and
      // no tool/claim wait inside the loop — the inbox is the coalescer.
      for (const text of steerInbox?.drain() ?? []) {
        messages.push({ role: "user", text });
        emit({ type: "steer_applied", text });
      }
      const turn = turns + 1;
      emit({ type: "turn_start", turn });

      let output: ModelTurnOutput;
      try {
        // Snapshot semantics: a request reflects the transcript at request
        // time and stays immutable even though the loop keeps appending and
        // substituting (M-TL1 in-place substitution relies on this).
        output = await modelClient.complete({ system, messages: [...messages], tools });
      } catch (error) {
        return failed(
          "model_client_error",
          error instanceof Error ? error.message : String(error),
          messages,
          turn,
          toolCallCount,
        );
      }
      turns = turn;

      if (output.kind === "message") {
        messages.push({ role: "assistant", text: output.text });
        emit({ type: "assistant_text", text: output.text });
        emit({ type: "turn_end", turn });
        if (!lanes.hasOutstanding) {
          return {
            status: "completed",
            finalText: output.text,
            turns,
            toolCallCount,
            messages: [...messages],
          };
        }
        // A tool is still in flight: its completion wakes the next turn so
        // the model observes the final instead of waiting or polling.
        try {
          await lanes.waitForProgress(signal);
        } catch {
          return aborted(messages, turns, toolCallCount);
        }
        continue;
      }

      if (output.calls.length === 0) {
        return failed(
          "model_client_error",
          "model returned an empty tool_calls list",
          messages,
          turn,
          toolCallCount,
        );
      }

      messages.push({ role: "assistant", toolCalls: output.calls });
      toolCallCount += output.calls.length;
      // Issue appends every in-progress slot synchronously, then starts the
      // lanes; the model turn is over once calls are issued, not once tools
      // finish.
      lanes.issue(output.calls);
      emit({ type: "turn_end", turn });
      try {
        await lanes.waitForProgress(signal);
      } catch {
        return aborted(messages, turns, toolCallCount);
      }
    }
  } finally {
    // Late completions after the outcome must not mutate the returned
    // transcript snapshot.
    lanes.settle();
  }

  return failed(
    "max_turns_exhausted",
    `turn budget exhausted after ${maxTurns} model turns without a final message`,
    messages,
    turns,
    toolCallCount,
  );
}

function failed(
  reason: TurnLoopFailureReason,
  detail: string,
  messages: readonly TurnLoopMessage[],
  turns: number,
  toolCallCount: number,
): TurnLoopOutcome {
  return { status: "failed", reason, detail, turns, toolCallCount, messages: [...messages] };
}

function aborted(
  messages: readonly TurnLoopMessage[],
  turns: number,
  toolCallCount: number,
): TurnLoopOutcome {
  return failed("aborted", "aborted at a turn or lane boundary", messages, turns, toolCallCount);
}
