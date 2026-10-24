# Independent code review

**Status: policy for the manual V1.** Frontier Intelligence is the permission
gate. A technical code review is a separate layer and must not be confused with
permission.

## Two separate questions

1. **May this action happen?** Frontier Intelligence (Argon by default) answers
   with an exact, one-use packet.
2. **Is this code good enough to keep?** An independent code reviewer answers
   with findings. A permission `allow` is not a code review.

The default optional independent reviewer is **Astra**
(`openai-codex/gpt-6-astra`). **Claude** (`anthropic/claude-opus-5-5`) is
available only through a handoff packet and a fresh Claude CLI session; do not
call it from Pi.

## When independent review is required

Use an independent review for:

- frontier core code and the final integration;
- a security boundary, credential path, or destructive operation;
- a contract, schema, or dependency change;
- a patch whose tests were written by the same model that wrote the code;
- any patch the user or A1 marks high-risk.

A routine grunt card with frontier-authored tests may proceed with the grunt
pair's review plus A1's frontier review. Astra/Claude is optional there.

## Route

```text
Is independent review required?
  no  -> grunt pair review + A1 frontier review; record the reason
  yes -> Is Astra available?
           yes, and no explicit Claude request -> Astra via `ask ASTRA`
           no / exhausted -> deny the code review
                             -> local checkpoint + one degraded round
                                (then stop; leave notes for review)
  human choice between Astra and Claude?
    -> ask, start a 300-second timer
       reply within 5 min -> chosen route
       no reply          -> Astra
       Astra exhausted   -> deny the code review
```

**Deny the code review** means the patch is not review-complete: do not
integrate, merge, or push it. It does not mean "the code is malicious"; it
means the independent review gate did not happen. A local checkpoint may still
be saved for safety (preferred: bundle + tree hash; a local commit only if
Frontier Intelligence approves it).

## Astra

Astra is called through the host in a fresh, no-tool session:

```bash
node factory/host.mjs ask ASTRA tasks/<task>/astra-review-prompt.md \
  tasks/<task>/astra-review.md
```

The prompt is the bounded packet from `templates/independent-review.md`. Astra
returns findings, not edits. If the provider reports usage exhaustion, treat
Astra as unavailable. Do not retry with a different model.

## Claude handoff

Claude is not called from Pi. To use it:

1. Generate the packet from `templates/independent-review.md`.
2. Include the task, tree/commit, contract hash, diff, tests, evidence, and
   exact questions. Do not include the coder's private rationale or secrets.
3. Save it under `tasks/<task>/review-packets/<id>.md` and hash it.
4. Open a **fresh Claude CLI session** (do not continue the coding session) and
   give it the packet. Ask for findings with severity and evidence; it must not
   edit code.
5. Save the response as `review-packets/<id>-claude.md`; hash both files.
6. Record the route and hashes on the board.

If Claude is unavailable, the packet remains for later. Do not mark the review
complete.

## Human choice timeout

When the route needs a human choice between Astra and Claude:

- ask once, with the exact options;
- start a **300-second** timer;
- if there is no reply, choose Astra;
- if Astra is out of usage, deny the code review;
- do not wait longer, and do not silently switch to Claude.

Record the deadline and the default that was used.

## If review cannot be performed

This is the containment path, not a substitute for independent review:

1. **Graceful local save.** Create a local checkpoint (a bundle plus tree hash
   is preferred; a local commit only if Frontier Intelligence approves it). Do
   not push. Record the tree hash.
2. **One degraded round.** Ask the model currently working on the project for
   exactly one review round. Give it the packet, not its own private rationale.
   Mark the result `degraded-not-independent`.
3. **Stop.** Do not run a second degraded round. Do not describe it as an
   independent review.
4. **Leave the notes.** Put the packet, the degraded review, the test evidence,
   and the checkpoint hash in `tasks/<task>/review-packets/`.
5. **Priority 1.** When the user returns to the machine, run the independent
   review before any integration, commit, or push that depends on it.

## Record

Record on the board:

- `review_route: astra | claude | denied | degraded`;
- `review_required: true | false`;
- packet hash and response hash;
- reviewer model and session kind (Pi or Claude CLI);
- if degraded: `review_status: pending-independent`, checkpoint, and priority 1;
- if denied: the reason (for example `astra-exhausted`).

## Failure modes

| Symptom | Cause | Response |
|---|---|---|
| "Tests pass, so review is done" | tests and review conflated | require the independent review artifact |
| Claude called through Pi | plan does not work outside Claude CLI | generate the handoff packet instead |
| Waiting indefinitely for a human | no timeout | 300 s, then Astra; Astra exhausted → deny |
| Degraded review repeated until it passes | review gate replaced by self-review | one round only; leave notes; priority 1 |
| Packet contains the coder's rationale | reviewer anchored | packet contains artifacts and questions only |
| Same model reviews its own code | no independence | use Astra/Claude, or mark degraded |

## Current state

No independent review is pending. The text annotator used B2/F2 reviews; the Super Team
frontier review was not part of that build. This policy applies from
the next review that needs an independent layer.
