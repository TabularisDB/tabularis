# Fieldnotes / Tabularis Neon Lab

An independent Next.js App Router prototype using six real Neon services. Email/password login needs no OAuth registration. All notes, projects, attachments, AI summaries, and Function operations are private to the signed-in user.

## Run locally

Use Node 22 or newer and pnpm. This folder has its own workspace boundary and lockfile; install and run here, not from the Tabularis root.

```sh
cd examples/neon-demo
pnpm install --frozen-lockfile
cp .env.example .env.local
# Fill .env.local from the already-provisioned Neon branch; generate a cookie secret.
pnpm db:migrate
pnpm build
pnpm start
```

The production server listens on `http://127.0.0.1:3008`. `pnpm dev` is available for development. Open the app, create an account, and sign in. The first workspace visit creates two projects and realistic starter notes for that user. Save edits explicitly; a successful save waits for its real live transaction. Summaries and reading insights save outstanding edits first.

For a repeatable local demo account, run `pnpm db:seed` while the app is running. This creates/signs in a real Managed Auth user and idempotently seeds their workspace. Credentials are stored only in ignored `artifacts/demo-user.json` with mode 0600. Set `DEMO_SEED_EMAIL` and `DEMO_SEED_PASSWORD` on its first run to choose credentials.

## Environment

| Variable                      | Required purpose                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | Server-only branch Postgres connection string                                                                    |
| `NEON_AUTH_BASE_URL`          | Managed Neon Auth URL, including `/neondb/auth`                                                                  |
| `NEON_AUTH_COOKIE_SECRET`     | App-generated secret of at least 32 characters                                                                   |
| `NEON_AUTH_JWKS_URL`          | Managed Auth JWKS; used in the deployed Function                                                                 |
| `NEON_REALTIME_URL`           | Live SQL WebSocket endpoint; safely passed as a server prop                                                      |
| `NEON_REALTIME_SECRET`        | Server-only query sealing secret                                                                                 |
| `AWS_ACCESS_KEY_ID`           | Private bucket credential                                                                                        |
| `AWS_SECRET_ACCESS_KEY`       | Private bucket secret                                                                                            |
| `AWS_ENDPOINT_URL_S3`         | Branch S3 endpoint                                                                                               |
| `AWS_REGION`                  | Branch AWS region, `eu-central-1` for the configured project                                                     |
| `NEON_STORAGE_BUCKET`         | Private bucket name; defaults to `assets`                                                                        |
| `NEON_AI_GATEWAY_BASE_URL`    | Branch AI Gateway base URL                                                                                       |
| `NEON_AI_GATEWAY_TOKEN`       | Server-only Gateway credential                                                                                   |
| `NEON_AI_MODEL`               | Model catalog ID; defaults to `claude-haiku-4-5`                                                                 |
| `NEON_FUNCTION_DEMO_BASE_URL` | URL of the separately deployed protected analysis Function                                                       |
| `APP_ORIGIN`                  | Exact app origin without trailing slash; local `http://127.0.0.1:3008`, production `https://YOUR_APP.vercel.app` |

No credential uses a `NEXT_PUBLIC_` prefix. The browser receives its own notes, user identity, the public Realtime URL, and a short-lived encrypted user-scoped live query. The query must not be logged or saved to local storage.

## Neon setup and deployment

This example intentionally does not create a project or deploy shared infrastructure. Use the existing project/branch and merge the following into its existing Neon configuration:

- Managed Auth enabled, with email/password sign-up.
- Private `assets` bucket.
- AI Gateway enabled.
- Realtime enabled, with the exact app origins listed in `allowedOrigins`.
- A Function sourcing `functions/summary.ts`, with `jose` and `pg` installed in the deployment package. The Function verifies Managed Auth EdDSA JWTs against injected `NEON_AUTH_JWKS_URL` and `new URL(NEON_AUTH_BASE_URL).origin`, then queries only the caller's stored note. Neon injects its Postgres and Auth environment. It returns word count and reading time; the separate Next summary endpoint exercises AI Gateway.

The parent plugin config may point at `../../examples/neon-demo/functions/summary.ts`. Put the deployed Function URL in this app's `NEON_FUNCTION_DEMO_BASE_URL`.

Before testing or sharing an origin, register that exact origin with Managed Auth and Realtime. For the local production server use **`http://127.0.0.1:3008`**. Localhost and 127.0.0.1 are distinct origins.

```sh
neon neon-auth domain add https://YOUR_APP.vercel.app
# Merge into the existing config, preserving other origins:
# preview: { realtime: { allowedOrigins: ["http://127.0.0.1:3008", "https://YOUR_APP.vercel.app"] } }
```

Production origins must include the actual Vercel deployment/custom domain on both allowlists. For previews, register each intended exact origin and set its matching `APP_ORIGIN`; do not broadly allow arbitrary origins. Configure custom SMTP in Neon Auth before production email delivery. The example focuses on sign-up/sign-in/sign-out; password recovery and verification-code screens are not included.

## Vercel

Import the repository with **Root Directory `examples/neon-demo`**, framework Next.js, package manager pnpm, Node 22 or newer. Build command: `pnpm build`. The included `vercel.json` installs with `--ignore-workspace` so this standalone example does not install the parent workspace, and runs in `fra1` near the Neon region. The checked-in standalone `pnpm-lock.yaml` supplies the install lockfile. Set the variables above in the appropriate Vercel environment; use a new stable `NEON_AUTH_COOKIE_SECRET` and set `APP_ORIGIN` to that deployment's exact HTTPS origin. Apply the additive migration once against its target database before opening the app. Do not copy local test credentials to Vercel.

## Schema and authorization

`migrations/001_workspace.sql` only adds `tabularis_demo.projects`, `tabularis_demo.notes`, `tabularis_demo.attachments`, and their indexes. It does not alter existing schemas or remove data. Composite foreign keys bind a note's project and an attachment's note to the same owner.

Every workspace API checks the official server session. Every resource query filters its owner. Mutation APIs reject foreign origins; the browser also submits its page's user ID so stale pages cannot write into a changed session. The live query binds `owner_id` from the verified session rather than request input. Renewals recheck identity. Sign-in and sign-out use full navigation, discarding the old live connection.

Private files are served through an authenticated download endpoint with a forced attachment disposition and `nosniff`. The storage key is generated by the server under `tabularis-demo/{user}/{note}/{uuid}`. Files are limited to 4 MB. File deletion happens before metadata deletion to avoid losing the record if storage is unavailable; a failed multi-file delete can be retried. Project deletion requires deleting its notes first. Database credentials remain privileged server credentials; authorization is enforced in handlers and the sealed live SQL, not Postgres RLS (Realtime does not currently support RLS).

## Real-service verification

With the production server running and all origins registered:

```sh
pnpm db:seed
pnpm test:e2e
```

`tests/e2e.mjs` creates two disposable real Auth users and exercises the app's HTTP endpoints. It verifies sign-up/sign-out/sign-in and wrong password, protected pages/APIs, owner-scoped Postgres CRUD, two real live WebSocket subscriptions with insert/update/delete transactions, private S3 upload/download/delete and access denials, persisted AI summary, and the deployed Function's JWT and ownership checks. It also opens Chrome against the production app, checks session restoration, live status, mobile overflow, browser errors, and sign-out. All six services are required; missing configuration fails the test rather than producing a synthetic pass.

The test writes ignored JSON evidence and desktop/mobile screenshots to `artifacts/`. Chrome defaults to `/usr/bin/google-chrome-stable`; override with `CHROME_PATH`. It removes its created notes/project on success but retains disposable Auth identities. Do not run the test with personal account credentials.

Prototype limits: latest 200 notes per workspace, explicit saves, 4 MB uploads, finite AI request timeouts, no organization sharing, no password recovery screen, and no automatic merging for simultaneous edits. Clean editors adopt incoming live text. When a live edit conflicts with an unsaved draft, the editor preserves the draft and pauses saves and analysis until you choose “Load latest version” or “Keep my edits.” Keeping your edits explicitly permits the next save to replace the incoming version.
