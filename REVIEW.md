# REVIEW.md

Instructions for agents performing code review on Tabularis pull requests.

## Directive

Always follow the **`tabularis-pr-review`** skill when reviewing a PR:
[`.claude/skills/tabularis-pr-review/SKILL.md`](./.claude/skills/tabularis-pr-review/SKILL.md)

If your harness supports skills, invoke `tabularis-pr-review` directly. Otherwise, read the
`SKILL.md` file and follow its workflow step by step.

## Key points

- Judge the diff against the repo's own rules in [`.rules/`](./.rules/) (see [AGENTS.md](./AGENTS.md)).
- Do not trust the PR description: verify every claim against the code.
- Run the PR's tests on the PR branch, not on `main`.
- Deliver a review **plus** a manual test plan with real test data for the human reviewer.
