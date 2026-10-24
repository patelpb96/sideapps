# Program brief

A brief requests a program; it is not an approval to change files, commit, or push.

## Goal

- What should the program do?
- What problem does it solve?
- What is the smallest useful result?

## Users and workflow

- Who uses it?
- What do they do before and after?
- What does success look like from their side?

## Inputs and outputs

- Input formats and examples:
- Output formats and examples:
- Size, rate, and latency expectations:
- Empty, malformed, and partial-input behavior:

## Backend needs

- Resources, endpoints, or commands the UI needs:
- Data shapes and error semantics:
- Auth or permission requirements:
- State that must survive a restart:
- What the backend will **not** provide:

## Frontend needs

- Screens or flows:
- UI states: loading, empty, error, partial, retry, cancel:
- Accessibility and keyboard requirements:
- Fixtures or sample data needed:

## Acceptance

- Observable behavior a test can check:
- Contract tests:
- Integration tests:
- What counts as a failure:

## Constraints and non-goals

- Languages, runtimes, dependencies:
- Platforms and browsers:
- Data that must not leave the machine:
- Secrets (names or purpose only, never values):
- Explicitly out of scope:

## Stop conditions

- What would make the team stop and ask the user?
- What is irreversible?
- What must never happen?
