# Comparing development agents in Loop

Create a small **clean Git repository** whose test fails before the requested change. Keep the manifest outside that repository. For each trial, Loop clones the same commit, asks one configured provider to make the change, and independently runs the declared checks.

Example manifest (replace the absolute path and provider IDs with your fixture and installed config):

```json
{
  "name": "normalize-label",
  "intent": "Normalize names consistently",
  "sourceDirectory": "/absolute/path/to/clean-fixture",
  "candidateIds": ["pi:zai/glm-5.3-flashx", "pi:openai-codex/gpt-6-luna:low"],
  "iterations": 3,
  "tasks": [{
    "id": "implement", "title": "Normalize names", "kind": "implementation",
    "dependencies": [], "readScope": ["src/normalize.ts", "tests/normalize.test.ts"],
    "writeScope": ["src/normalize.ts"],
    "requirements": ["normalizeLabel trims and title-cases words"],
    "completionChecks": [{
      "id": "normalize-test", "command": "bun", "args": ["test", "tests/normalize.test.ts"],
      "workingDirectory": null, "timeoutMs": 120000
    }],
    "preferredCompute": "fast", "minimumCompute": "fast", "maximumCompute": "fast",
    "routing": {"risk": "low", "required": {"coding": 1, "reasoning": 1, "tools": 1, "vision": 0, "long_context": 0}},
    "maxAttempts": 1
  }],
  "criteria": [{
    "id": "normalization", "taskId": "implement",
    "description": "normalizeLabel trims and title-cases words", "checkIds": ["normalize-test"]
  }]
}
```

Run `loop benchmark agents manifest.json --json --database /absolute/path/to/benchmark.sqlite`. The full JSON includes each trial's workspace, source commit, status, criterion count, scope observations, retries, attention, and time. Each trial can be inspected in its isolated workspace. Actual provider cost is not measured. A passing test proves only the behavior that test exercises; review the fixture and the changed source before generalizing a result.
