# Pre-feature provider downgrade replay

`contexts/ThemeProvider.tsx` and `contexts/ThemeContext.ts` are unchanged source
from commit `d044381c536a3b9e4b576b1ed33fcce39efcf4b1`, captured with `git show`.
LF-normalized SHA-256:

- Provider: `629b003667c130e7a279d85f298aeb6fc099be92c2cf774d44760125cc4b1d9a`
- Context: `9475954040b64b39999cbc6b2e4d2172eb3ae840e4b4de914cffd6639d902c27`

The small sibling modules are explicit test shims to unchanged or golden-checked
legacy/builtin dependencies. Native IPC and window APIs are mocked; no real
profile, filesystem setting or OS appearance is changed. This executes the old
provider's actual hydration/save effects, not a hand-written approximation, but
is not an old packaged application or platform GUI test.

Run from the repository root:

```sh
pnpm exec vitest --config packages/web-ui/vitest.config.ts run packages/web-ui/tests/contexts/ThemeDowngrade.test.tsx
```

## Result and release implication

The old provider cannot find an installed variant or modern personal ID, chooses
its offline fallback, and then its save effect writes that fallback to
`config.theme`. The effect runs after initial hydration despite its old comment.
The tests deliberately assert this **hazard**. A green test is not a successful
downgrade-compatibility claim. The known builtin `monokai` retains its identity.
The new provider's no-write fallback/restore behavior is separately tested in
`packages/web-ui/tests/contexts/ThemeProvider.test.tsx`.

The new standalone snapshot container also fails the old native `Theme` shape,
rather than silently replaying different editor rules. Historical standalone
JSON remains on the old compatibility path.

Before public rollout, either backport safe unavailable-selection handling to
supported older clients, or prevent mixed-client access to the same profile.
A runtime floor or registry kind filter alone does not protect a profile opened
by an already-installed old binary. Keep a stopped-app backup of configuration
and all theme directories, and restore it explicitly before returning to the new
client if the old client overwrote the selection. Never auto-restore a backup
over a user's deliberate choice. Actual first-support release assignment,
old-client mitigation and packaged cross-platform upgrade/downgrade verification
remain maintainer release gates.
