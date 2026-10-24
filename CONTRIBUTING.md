<!-- omit in toc -->

# Contributing to tabularis

First off, thanks for taking the time to contribute! ❤️

All types of contributions are encouraged and valued. See the [Table of Contents](#table-of-contents) for different ways to help and details about how this project handles them. Please make sure to read the relevant section before making your contribution. It will make it a lot easier for us maintainers and smooth out the experience for all involved. The community looks forward to your contributions. 🎉

> And if you like the project, but just don't have time to contribute, that's fine. There are other easy ways to support the project and show your appreciation, which we would also be very happy about:
>
> - Star the project
> - Tweet about it
> - Refer this project in your project's readme
> - Mention the project at local meetups and tell your friends/colleagues

<!-- omit in toc -->

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [I Have a Question](#i-have-a-question)
  - [I Want To Contribute](#i-want-to-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Your First Code Contribution](#your-first-code-contribution)
  - [Testing a Pull Request Build](#testing-a-pull-request-build)
  - [Improving The Documentation](#improving-the-documentation)
- [Styleguides](#styleguides)
  - [Commit Messages](#commit-messages)
- [Join The Project Team](#join-the-project-team)

## Code of Conduct

This project and everyone participating in it is governed by the
[tabularis Code of Conduct](https://github.com/TabularisDB/tabularis/blob/main/.github/CODE_OF_CONDUCT.md).
By participating, you are expected to uphold this code. Please report unacceptable behavior
to <andrea@debbaweb.it>.

## I Have a Question

> If you want to ask a question, we assume that you have read the available [Documentation](https://tabularis.dev/).

Before you ask a question, it is best to search for existing [Issues](https://github.com/TabularisDB/tabularis/issues) that might help you. In case you have found a suitable issue and still need clarification, you can write your question in this issue. It is also advisable to search the internet for answers first.

If you then still feel the need to ask a question and need clarification, we recommend the following:

- Join our [Discord server](https://discord.com/invite/K2hmhfHRSt) and ask in the support channel. This is the fastest way to get help.
- Open an [Issue](https://github.com/TabularisDB/tabularis/issues/new).
- Provide as much context as you can about what you're running into.
- Provide project and platform versions (nodejs, npm, etc), depending on what seems relevant.

We will then take care of the issue as soon as possible.

<!--
You might want to create a separate issue tag for questions and include it in this description. People should then tag their issues accordingly.

Depending on how large the project is, you may want to outsource the questioning, e.g. to Stack Overflow or Gitter. You may add additional contact and information possibilities:
- IRC
- Slack
- Gitter
- Stack Overflow tag
- Blog
- FAQ
- Roadmap
- E-Mail List
- Forum
-->

## I Want To Contribute

> ### Legal Notice <!-- omit in toc -->
>
> When contributing to this project, you must agree that you have authored 100% of the content, that you have the necessary rights to the content and that the content you contribute may be provided under the project licence.

### Reporting Bugs

<!-- omit in toc -->

#### Before Submitting a Bug Report

A good bug report shouldn't leave others needing to chase you up for more information. Therefore, we ask you to investigate carefully, collect information and describe the issue in detail in your report. Please complete the following steps in advance to help us fix any potential bug as fast as possible.

- Make sure that you are using the latest version.
- Determine if your bug is really a bug and not an error on your side e.g. using incompatible environment components/versions (Make sure that you have read the [documentation](https://tabularis.dev/). If you are looking for support, you might want to check [this section](#i-have-a-question)).
- To see if other users have experienced (and potentially already solved) the same issue you are having, check if there is not already a bug report existing for your bug or error in the [bug tracker](https://github.com/TabularisDB/tabularis/issues?q=label%3Abug).
- Also make sure to search the internet (including Stack Overflow) to see if users outside of the GitHub community have discussed the issue.
- Collect information about the bug:
  - Stack trace (Traceback)
  - OS, Platform and Version (Windows, Linux, macOS, x86, ARM)
  - Version of the interpreter, compiler, SDK, runtime environment, package manager, depending on what seems relevant.
  - Possibly your input and the output
  - Can you reliably reproduce the issue? And can you also reproduce it with older versions?

<!-- omit in toc -->

#### How Do I Submit a Good Bug Report?

> You must never report security related issues, vulnerabilities or bugs including sensitive information to the issue tracker, or elsewhere in public. Instead sensitive bugs must be sent by email to <andrea@debbaweb.it>.

<!-- You may add a PGP key to allow the messages to be sent encrypted as well. -->

We use GitHub issues to track bugs and errors. If you run into an issue with the project:

- Open an [Issue](https://github.com/TabularisDB/tabularis/issues/new). (Since we can't be sure at this point whether it is a bug or not, we ask you not to talk about a bug yet and not to label the issue.)
- Explain the behavior you would expect and the actual behavior.
- Please provide as much context as possible and describe the _reproduction steps_ that someone else can follow to recreate the issue on their own. This usually includes your code. For good bug reports you should isolate the problem and create a reduced test case.
- Provide the information you collected in the previous section.

Once it's filed:

- The project team will label the issue accordingly.
- A team member will try to reproduce the issue with your provided steps. If there are no reproduction steps or no obvious way to reproduce the issue, the team will ask you for those steps and mark the issue as `needs-repro`. Bugs with the `needs-repro` tag will not be addressed until they are reproduced.
- If the team is able to reproduce the issue, it will be marked `needs-fix`, as well as possibly other tags (such as `critical`), and the issue will be left to be [implemented by someone](#your-first-code-contribution).

<!-- You might want to create an issue template for bugs and errors that can be used as a guide and that defines the structure of the information to be included. If you do so, reference it here in the description. -->

### Suggesting Enhancements

This section guides you through submitting an enhancement suggestion for tabularis, **including completely new features and minor improvements to existing functionality**. Following these guidelines will help maintainers and the community to understand your suggestion and find related suggestions.

<!-- omit in toc -->

#### Before Submitting an Enhancement

- Make sure that you are using the latest version.
- Read the [documentation](https://tabularis.dev/wiki) carefully and find out if the functionality is already covered, maybe by an individual configuration.
- Perform a [search](https://github.com/TabularisDB/tabularis/issues) to see if the enhancement has already been suggested. If it has, add a comment to the existing issue instead of opening a new one.
- Find out whether your idea fits with the scope and aims of the project. It's up to you to make a strong case to convince the project's developers of the merits of this feature. Keep in mind that we want features that will be useful to the majority of our users and not just a small subset. If you're just targeting a minority of users, consider writing an add-on/plugin library.

<!-- omit in toc -->

#### How Do I Submit a Good Enhancement Suggestion?

Enhancement suggestions are tracked as [GitHub issues](https://github.com/TabularisDB/tabularis/issues).

- Use a **clear and descriptive title** for the issue to identify the suggestion.
- Provide a **step-by-step description of the suggested enhancement** in as many details as possible.
- **Describe the current behavior** and **explain which behavior you expected to see instead** and why. At this point you can also tell which alternatives do not work for you.
- You may want to **include screenshots or screen recordings** which help you demonstrate the steps or point out the part which the suggestion is related to. You can use [LICEcap](https://www.cockos.com/licecap/) to record GIFs on macOS and Windows, and the built-in [screen recorder in GNOME](https://help.gnome.org/users/gnome-help/stable/screen-shot-record.html.en) or [SimpleScreenRecorder](https://github.com/MaartenBaert/ssr) on Linux. <!-- this should only be included if the project has a GUI -->
- **Explain why this enhancement would be useful** to most tabularis users. You may also want to point out the other projects that solved it better and which could serve as inspiration.

<!-- You might want to create an issue template for enhancement suggestions that can be used as a guide and that defines the structure of the information to be included. If you do so, reference it here in the description. -->

### Your First Code Contribution

Unsure where to begin? Browse our open issues labeled with [good first issue](https://github.com/TabularisDB/tabularis/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) for well-scoped starter tasks. If you are interested in database drivers, check the [Plugin Bounty Board](https://tabularis.dev/plugins/bounties) and our [Driver Contribution Hub (#1145)](https://github.com/TabularisDB/tabularis/issues/1145).

#### 1. Prerequisites

Before cloning and building, ensure you have the following installed:

- **Node.js**: `18.17+` (v20 LTS recommended). Verify with `node --version`.
- **pnpm**: `9+` (package manager). Enable with `corepack enable pnpm` or install with `npm install -g pnpm`.
- **Rust Toolchain**: `stable` (required for desktop Tauri builds, `src-tauri` backend, and Rust-based plugins). Install via [rustup](https://rustup.rs/): `rustc --version` and `cargo --version`.
- **Platform Dependencies (Tauri v2)**:
  - **Linux**: Standard GTK, WebKit, and build libraries (e.g. on Debian/Ubuntu: `sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev`).
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`).
  - **Windows**: Microsoft Visual Studio C++ Build Tools and WebView2.

#### 2. Repository Source Map

Understanding the codebase layout will help you navigate directly to the relevant files:

```
tabularis/
├── src/                      # Frontend application (React 19, TypeScript, Tailwind CSS, Monaco editor)
│   ├── components/           # UI components (modals, data grid, query editor, explorer)
│   ├── i18n/locales/         # i18n translation catalogs (en, it, zh, etc.)
│   ├── theme/                # Theme tokens and CSS rules (see tokens.css)
│   └── utils/                # Pure frontend helper and calculation utilities
├── tests/                    # Frontend tests (Vitest)
│   └── utils/                # Unit tests matching src/utils/
├── src-tauri/                # Native desktop backend (Rust, Tauri v2 shell, native SQLite/MySQL/PostgreSQL engines)
├── plugins/                  # Plugin documentation, JSON schemas (manifest.schema.json), and reference guides
├── packages/
│   ├── create-plugin/        # Official CLI scaffolder (@tabularis/create-plugin)
│   ├── plugin-api/           # Plugin TypeScript SDK and protocol contracts
│   └── explain/              # Visual query plan renderer package
└── .rules/                   # Architectural, accessibility, and design guidelines (see AGENTS.md)
```

#### 3. Choosing Your Contribution Workflow

Tabularis contributions typically fall into one of three distinct categories. Pick the workflow matching your task:

##### Workflow A: Frontend Utility or Component Task (Web-only, Fast)

If your task touches pure frontend helpers in `src/utils/`, data transformations, formatting, or UI components:

1. **Install dependencies:**
   ```bash
   pnpm install
   ```
2. **Start the Vite web dev server:**
   ```bash
   pnpm dev
   ```
   Open `http://localhost:5173` in your browser. This mode offers instant Hot Module Replacement (HMR) without compiling Rust or the Tauri desktop shell.
3. **Run targeted tests:**
   ```bash
   pnpm test tests/utils/themeContrast.test.ts
   # or run vitest in watch mode:
   pnpm test
   ```
4. **Validate code formatting, theme tokens, and types:**
   ```bash
   pnpm lint          # ESLint + Prettier check + design token usage
   pnpm format        # Apply Prettier to the whole repository
   pnpm exec tsc -b   # TypeScript typecheck across workspaces
   ```

##### Workflow B: Desktop UI Verification & Rust Backend (Full Tauri App)

If your changes involve native desktop behaviors (Tauri IPC commands, filesystem access, native file dialogs, system notifications, or changes inside `src-tauri`):

> [!NOTE]
> In web-only mode (`pnpm dev`), native Tauri APIs (`@tauri-apps/api`, `@tauri-apps/plugin-*`) are unavailable or stubbed. Desktop features must be verified within the Tauri container.

1. **Launch Tabularis in development mode:**
   ```bash
   pnpm tauri dev
   ```
   This compiles the Rust backend, starts the Vite frontend server, and launches the native desktop window with devtools enabled.
2. **Run Rust backend tests:**
   ```bash
   pnpm test:rust
   # or directly in the Rust crate:
   cd src-tauri && cargo test
   ```

##### Workflow C: Standalone Driver Work (Plugins)

> [!IMPORTANT]
> **Do not add new database drivers directly to Tabularis core!**
> Tabularis uses a decoupled, multi-language plugin architecture (JSON-RPC 2.0 over stdio). All new database and cloud data-source drivers are developed, versioned, and published as **standalone plugins in their own repositories**.

1. **Explore open targets and scope:**
   - Review current and requested drivers in the [Driver Contribution Hub (#1145)](https://github.com/TabularisDB/tabularis/issues/1145).
   - Check the [Plugin Bounty Board](https://tabularis.dev/plugins/bounties) for open driver targets looking for contributors.
2. **Scaffold a new driver plugin:**
   Use the official `@tabularis/create-plugin` generator:
   ```bash
   pnpm create @tabularis/plugin@latest my-driver --db-type=network
   ```
   * `--db-type=network`: Standard TCP databases (e.g. CockroachDB, TiDB, ClickHouse).
   * `--db-type=api`: Cloud REST/GraphQL services (e.g. Google Sheets, Airtable, DynamoDB).
   * `--db-type=file`: Local and embedded file formats (e.g. DuckDB, SQLite, Parquet).
3. **Develop and test locally:**
   ```bash
   cd my-driver
   just dev-install   # Builds your driver and installs it into local Tabularis plugin directory
   ```
4. **Read the guides:**
   - Step-by-step walkthrough: [Plugin Tutorial](./plugins/PLUGIN_TUTORIAL.md).
   - Full RPC specification and manifest capabilities: [Plugin Guide](./plugins/PLUGIN_GUIDE.md).
   - Driver capability best practices: [Plugin Rules](./.rules/plugins.md). Always declare supported dialects and capabilities rather than branching on driver IDs.

#### 4. Quality Checklist & PR Guidelines

Before opening a pull request, ensure your branch satisfies the quality standards described in [AGENTS.md](./AGENTS.md) and [`.rules/`](./.rules/):

- [ ] **Tests pass**: Targeted unit tests (`pnpm test <path>`) and full test suite pass cleanly.
- [ ] **Typecheck**: `pnpm exec tsc -b` (or `pnpm typecheck`) completes with zero errors.
- [ ] **Lint & Design Tokens**: `pnpm lint` passes cleanly. Use theme tokens from `src/theme/tokens.css` (never hardcode arbitrary hex/RGB colors).
- [ ] **Accessibility**: Maintain keyboard navigation, visible focus outlines, and appropriate ARIA attributes for interactive elements ([Accessibility Rules](./.rules/accessibility.md)).
- [ ] **Internationalization**: If adding user-visible strings, declare translation keys in `packages/web-ui/src/i18n/locales/` instead of hardcoding text in JSX.
- [ ] **Issue Reference**: Include `Closes #<issue-number>` or `Fixes #<issue-number>` in your PR description.

### Testing a Pull Request Build

Maintainers can add the `preview` label to a pull request to get installable builds of it for macOS, Linux and Windows, without publishing anything to the Releases page. The build runs right away and again on every push while the label stays; a bot comment on the PR links the downloads (a GitHub login is required, and they expire after 14 days). Builds of PRs from forks are not signed, so macOS asks for `xattr -cr` on the app and Windows shows a SmartScreen warning.

If you reported a bug and a maintainer points you to such a build, that is the fastest way to confirm the fix before it lands in a nightly.

### Improving The Documentation

Documentation improvements are always welcome! Whether fixing typos, clarifying complex workflows, or expanding guides:
- For repository documentation and guides, edit Markdown files directly in the repository and submit a PR with the `docs:` prefix.
- For website documentation, tutorials, and wiki pages, visit [tabularis.dev](https://tabularis.dev/) and its documentation source.

## Styleguides

### Commit Messages

Tabularis follows the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) specification:

- `feat:` Adds a new user-facing feature or enhancement.
- `fix:` Patches a bug or addresses unexpected behavior.
- `docs:` Documentation improvements, markdown corrections, and guides.
- `style:` Formatting, missing semicolons, or whitespace adjustments (no code change).
- `refactor:` Code restructuring without changing behavior or adding features.
- `test:` Adding or refactoring automated tests.
- `chore:` Maintenance tasks, dependency updates, and build script adjustments.
- `perf:` Performance improvements without behavior changes.
- `ci:` / `build:` Changes to CI workflows or the build setup.
- `revert:` Reverts a previous commit.

The scope in parentheses is optional and names the area you touched (`editor`, `grid`, `postgres`, `create-plugin`, ...). Start the subject with a lowercase letter. Add `!` after the type or scope for a breaking change (`feat(plugin-api)!: ...`).

Example:
```git
feat(editor): add shortcut for executing current cell in sql notebook
fix(grid): prevent horizontal scroll jump when expanding nested json
docs(contributing): add first contribution quickstart and workflow guide
```

Pull requests are squash merged, so **the PR title becomes the commit on `main`** and must follow the same format. A check on every PR validates it; if it fails, edit the title and the check re-runs. For the npm packages under `packages/`, the title also decides the release: a `fix` produces a patch release, a `feat` a minor one, while `chore`, `docs`, `test` and similar do not release anything.

## Join The Project Team

Active contributors, driver authors, and community members are encouraged to join the conversation:
- Join our [Discord community](https://discord.com/invite/K2hmhfHRSt) to discuss features, drivers, and design proposals.
- Follow development updates and roadmap discussions on [GitHub Issues & Discussions](https://github.com/TabularisDB/tabularis).

<!-- omit in toc -->

## Attribution

This guide is based on the [contributing.md](https://contributing.md/generator)!
