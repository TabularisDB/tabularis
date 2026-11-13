# Windows signing test rollout

The `Windows SignPath test` workflow exercises signing without publishing a
GitHub Release, modifying `latest.json`, or enabling production signing.
It accepts only the `test-signing` policy. Its binaries use a self-signed
certificate and must not be redistributed as public releases.

## Account configuration

Repository secret: `SIGNPATH_API_TOKEN` (the SignPath **CI builds** submitter).
The existing `TAURI_PRIVATE_KEY` and `TAURI_KEY_PASSWORD` sign updater files;
they are not replaced or rotated.

Repository variables:

| Variable | Value |
| --- | --- |
| `SIGNPATH_ORGANIZATION_ID` | `1c7b980a-21f9-4831-b97e-c3a0d20ba7f4` |
| `SIGNPATH_PROJECT_SLUG` | `tabularis` |
| `SIGNPATH_TEST_POLICY_SLUG` | `test-signing` |
| `SIGNPATH_WINDOWS_APP_CONFIG_SLUG` | `windows-app` |
| `SIGNPATH_WINDOWS_INSTALLERS_CONFIG_SLUG` | `windows-installers` |

The test policy is deliberately fixed in the workflow rather than selected
through an input or variable. The production policy variable is not used.
The official SignPath GitHub App is installed for `TabularisDB/tabularis`,
and the project's `GitHub.com` trusted build system is linked.

`test-certificate.pem` is the **public** test certificate downloaded from
SignPath. Its DER SHA-256 fingerprint is
`B5211DE719485064179CCA58EE452E59FF1404BCC9902C3D295B0AD77FCB7B0F`.
It is trusted temporarily in `LocalMachine\Root` only on the disposable Windows
runner, then removed. `certutil -f -addstore` avoids the interactive Security
Warning that a `CurrentUser\Root` import can show in a headless session. The
import has a two-minute timeout and checks that the certificate was installed.
Every signed executable and installer must pass Windows Authenticode
verification with this exact signer and have a timestamp.

The artifact configurations were generated from actual v0.30.0 samples:

- `windows-app`: ZIP containing exactly `tabularis.exe` to sign.
- `windows-installers`: ZIP containing `tabularis_*_x64-setup.exe` and
  `tabularis_*_x64_en-US.msi`, both to sign. The MSI configuration also signs
  `PFiles/tabularis/tabularis.exe` inside it.

The OSS subscription supplies the signature description/watermark itself;
custom `description` and `description-url` attributes are rejected.

## Running and checking the test

During bootstrap, pushes to `ci/signpath-windows-test` affecting this workflow,
its scripts, or `.signpath/` trigger it. Once available on the default branch,
maintainers can dispatch it manually from Actions. The job permits only this
bootstrap branch and `main`, never a fork or arbitrary ref.

The sequence is:

1. Build without bundling; upload the application to Actions and SignPath.
2. Verify and restore exactly one signed executable.
3. Bundle MSI/NSIS around that executable; upload and SignPath-sign installers.
4. Verify final installer signatures, the MSI's extracted payload, a real silent
   NSIS installation, and their packaged Web UI.
5. Sign the final installer bytes with the existing updater key. Verify those
   signatures using the public key from `tauri.conf.json` and the official
   Minisign 0.12 verifier, whose Windows archive SHA-256 is pinned. Confirm the
   verifier rejects a tampered copy of each installer.
6. Package and verify the portable ZIP (signed executable plus `web-ui/`).
   Upload all final files, reports, request URLs, and `SHA256SUMS` as an Actions
   artifact explicitly named `TEST-ONLY`.

The test uses a pinned, test-only Tauri CLI **2.12.4**. The project's CLI 2.11.4
patches the executable for each installer type, invalidating an existing
Authenticode signature. CLI 2.12.4 provides `--no-binary-patching` to preserve
the signature; this also disables per-bundle-type updater identification.
The test checks that bundling leaves the signed executable's hash unchanged.
Release workflows and the project's lockfile are not upgraded by this test.

## Before production

Issue [#636](https://github.com/TabularisDB/tabularis/issues/636) remains open.
At setup time, `release-signing` is invalid because **Release certificate 2026**
is still **CSR PENDING**. SignPath must issue/activate the public certificate.
Keep its required manual approval, trusted-build verification, and origin
verification enabled.

Before signing public downloads:

- Confirm the issued public certificate, its fingerprint, and production policy.
- Agree on permitted protected release origins, tags, prereleases and nightlies;
  validate the reusable workflow chain against SignPath's origin checks.
- Decide how to preserve the MSI/NSIS updater selection when integrating remote
  signing; the test-only `--no-binary-patching` choice needs explicit review.
- Include the separate WinGet-managed binary and installer, and the portable ZIP.
- Split build/sign from final publication. Generate updater signatures and
  `latest.json` only from final signed assets; fail without publishing unsigned
  fallbacks and keep the first signed release in draft for smoke testing.
- Test clean MSI/NSIS installs, upgrade from the previous stable release,
  uninstall, portable launch and an actual updater transition on Windows.
  The automated MSI check here is administrative extraction, not an MSI install
  or upgrade test.

References: [SignPath GitHub integration](https://docs.signpath.io/trusted-build-systems/github),
[Tauri CLI](https://v2.tauri.app/reference/cli/),
[Minisign](https://jedisct1.github.io/minisign/).
