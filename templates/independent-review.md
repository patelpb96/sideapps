# Independent review packet — <task-id>

Use this packet for Astra (via Pi) or Claude (via a fresh Claude CLI session).
Do not include the coder's private rationale, secrets, credentials, or runtime
data. The reviewer returns findings; it does not edit code.

## Identity

- **Task:**
- **Commit / tree hash:**
- **Contract version / hash:**
- **Test manifest / evidence hash:**
- **Packet hash:** `<computed after writing>`
- **Reviewer route:** Astra | Claude
- **Reviewer session:** fresh Pi no-tools session | fresh Claude CLI session
- **Required?** yes | no — reason:

## Scope

- What this patch is supposed to do:
- Files and interfaces in scope:
- Non-goals / do-not-touch:
- Base revision:

## Diff

```diff
<paste the exact diff here>
```

## Tests

- Command:
- Result:
- Red-first evidence:
- Tests the author did **not** write:

## Evidence

- Test output:
- Screenshots / fixtures:
- Known warnings:

## Questions for the reviewer

1. Does the implementation match the contract and the stated non-goals?
2. Is any behavior changed outside the patch's scope?
3. Are the tests strong enough to catch the failure this patch is meant to fix?
4. Is there a simpler or safer implementation?
5. What would make this patch wrong at 3am?

## Output contract

Return JSON only:

```json
{
  "verdict": "pass | findings | stop",
  "findings": [
    {
      "severity": "critical | high | medium | low",
      "file": "path",
      "evidence": "exact quote or line",
      "why": "why it is wrong",
      "fix": "minimal fix"
    }
  ],
  "test_gaps": ["..."],
  "stop_case": "strongest argument for stopping this patch"
}
```

Do not rewrite the code. Do not approve a patch you did not inspect. If the
packet is incomplete, say so and stop.
