## [0.9.15](https://github.com/debba/tabularis/compare/v0.9.14...v0.9.15) (2026-04-08)


### Bug Fixes

* **notebook:** ensure unique keys for rendered cells using id and index ([8d6e1ea](https://github.com/debba/tabularis/commit/8d6e1ea81947f7f5c64c896fac51dc6d46349020))
* **notebook:** prevent stale runCell, add typings and guards ([be1731e](https://github.com/debba/tabularis/commit/be1731eed97154126abfc7bfc52fe6c35d3f60b9))
* **notebook:** render cell history panel outside collapsed check for sql ([cb58710](https://github.com/debba/tabularis/commit/cb58710a83efaaa57972024fcc06778c4605d1bf))
* **notebook:** sync cells ref and improve export with error handling ([aa6ba5a](https://github.com/debba/tabularis/commit/aa6ba5abea5ceec935bbddd6fbec77a534c82203))
* **ui:** render modal into portal and adjust tooltip z-index ([5a60282](https://github.com/debba/tabularis/commit/5a60282934c0e7fd3c4d6bb0841bade25523ae71))
* **ui:** replace useEffect setState with initialEditing prop pattern ([85262f3](https://github.com/debba/tabularis/commit/85262f38dd39d34a3569ccff65ad29387aeacc9f))


### Features

* **ai:** add AI tab rename feature ([c5cfb57](https://github.com/debba/tabularis/commit/c5cfb57ec98f236fe5875d7979a40723788b823f))
* **editor:** add multi-query run and selection UI ([63e5aa8](https://github.com/debba/tabularis/commit/63e5aa872767ca48060bb6b908e177996daa656c))
* **editor:** add tab rename, close and multi-query run support ([808e0cb](https://github.com/debba/tabularis/commit/808e0cbabd6641572962bc6e91a7555f2381f5f5))
* **editor:** prompt for params when running multi queries ([c741411](https://github.com/debba/tabularis/commit/c7414115a94db1c366ee3e5218f72ab4eb161f69))
* **health-check:** add periodic connection ping health checks ([17398dd](https://github.com/debba/tabularis/commit/17398dd001cede8c71692d8cd4c42e738b60320f))
* **multi-result-panel:** add collapsible query preview to result panel ([be8e541](https://github.com/debba/tabularis/commit/be8e541349e57a328253c4e885a0d51d501362bc))
* **notebook:** add AI buttons, outline, collapse and export ([d0ccee9](https://github.com/debba/tabularis/commit/d0ccee9e2684e6727aa2f5fbc3486fbcb9a5e215))
* **notebook:** add AI naming for outline and collapse/expand all ([a15b056](https://github.com/debba/tabularis/commit/a15b056c6e24e5ce3b0acccfa8520d26f1f2758a))
* **notebook:** add AI-generated cell names and outline support ([8499bdb](https://github.com/debba/tabularis/commit/8499bdb6470ebbf265529956bca52c5b0a3eb60c))
* **notebook:** add charts, params, sections, history ([da915f2](https://github.com/debba/tabularis/commit/da915f247969d9f71ac6157001de6cf1f46c5750))
* **notebook:** add fallback markdown outline and add-cell button ([09887df](https://github.com/debba/tabularis/commit/09887df411b42b17b8e218d87978a72827b63c74))
* **notebook:** add notebook UI with SQL and markdown cells, add run ([f4b4983](https://github.com/debba/tabularis/commit/f4b49838dbfb74ac23ce4f479bcfde1d10d4b40a))
* **notebook:** add per-cell schema selection and multi-db support ([6047199](https://github.com/debba/tabularis/commit/6047199151ff56a979eaa756705438435b3e8ad6))
* **notebook:** auto-run unresolved cell dependencies before query ([1757639](https://github.com/debba/tabularis/commit/17576395034d036a4261a35c2af0102f6189fa29))
* **notebooks:** add file-based persistence and debounced store ([98ebf4c](https://github.com/debba/tabularis/commit/98ebf4c19d3f214fdc350ea032ebfb938ab225da))
* **query-selection:** revamp modal UI and add run-single action ([8f7052b](https://github.com/debba/tabularis/commit/8f7052bea4166f4212d048c2c2ab195fea56bfa2))
* **ui:** add scrolling and inline rename to multi-result tabs ([871d7be](https://github.com/debba/tabularis/commit/871d7be81fc64b38b3d0b4437826ddc0bb4314ed))
* **ui:** add tab context menu to multi-result panel ([c291f0c](https://github.com/debba/tabularis/commit/c291f0c5e18ca892e68da52060104355a68f20a4))
* **ui:** add WhatsNew modal and stacked multi-result UI components ([f1ef252](https://github.com/debba/tabularis/commit/f1ef252fcaf488a4c8ba268b77581af5513e5901))


### BREAKING CHANGES

* **notebook:** clearHistory no longer accepts a cell argument

## [0.9.14](https://github.com/debba/tabularis/compare/v0.9.13...v0.9.14) (2026-04-07)


### Bug Fixes

* **driver:** fallback to test_connection when ping not implemented ([3b99ed2](https://github.com/debba/tabularis/commit/3b99ed24c1b127761d4d79e316cf7fb9229acead))
* **drivers:** handle ORDER BY without swallowing LIMIT/OFFSET ([094fca3](https://github.com/debba/tabularis/commit/094fca39bb868d95f2e086f5163e96d7850e2874))
* **modals:** improve modal UI and fix column type parsing ([39671f2](https://github.com/debba/tabularis/commit/39671f210cb357c97c3f06ae1f64ead6b2e097d7))
* **website:** correct video path and move asset to videos/posts ([c1841e8](https://github.com/debba/tabularis/commit/c1841e894c28c305ccbb9b5f9c7d224b552fe900))


### Features

* **blog:** add notebooks post and image lightbox ([1b4302a](https://github.com/debba/tabularis/commit/1b4302ac2079025111bef2f7f47dd0847508d71e))
* **column-types:** add column type parsing and extension support ([aeb146c](https://github.com/debba/tabularis/commit/aeb146c61864554d5363a9adf7b15a4a848302b3))
* **health-check:** add periodic connection ping and auto-disconnect ([a815da1](https://github.com/debba/tabularis/commit/a815da199eca39ed202ddedda47c7112787059e6))
* **modals:** add keyboard navigation and i18n to query selection modal ([ae4220f](https://github.com/debba/tabularis/commit/ae4220f91253176c2934eb17e0c98b5a1dfaba8b))
* **modals:** replace native selects with Select component ([d68ca23](https://github.com/debba/tabularis/commit/d68ca23b20809d62743652fe650156b5b7fa99bd))
* **postgres:** support SMALLSERIAL auto increment and sync UI behavior ([7fe6c03](https://github.com/debba/tabularis/commit/7fe6c038fdf46cbaa1446a572c26289413606ffc))

## [0.9.13](https://github.com/debba/tabularis/compare/v0.9.12...v0.9.13) (2026-04-02)


### Bug Fixes

* add check to prevent panic if buf len is less than 4 ([f43af04](https://github.com/debba/tabularis/commit/f43af04b273e3472b73457dda8e5b98abd8069d9))
* **editor:** register paste action per instance and improve scrollbar UI ([32020d1](https://github.com/debba/tabularis/commit/32020d1072833ae543146b7189faf46d58e4cd20))
* handle `Option` returned by `split_at_value_len` to return `Null` if `None` ([26cc2ab](https://github.com/debba/tabularis/commit/26cc2ab4d118a484630d16b11cba23df817d5d0a))
* make `fill_nulls` fill only the remaining fields ([d45cce7](https://github.com/debba/tabularis/commit/d45cce7d5fcbbf67f00a69ec2901418bf96652e9))
* return empty array in zero dimensions instead of `null` ([60c420a](https://github.com/debba/tabularis/commit/60c420a9149217bdcefc34b5507907c754df60fb))
* return None if `len < 0` which means the value is null ([e45a67d](https://github.com/debba/tabularis/commit/e45a67d7bf7c89cde358efe8ed6657b6a7464027))
* skip the length of each range ([c2e1844](https://github.com/debba/tabularis/commit/c2e18444f80c594da86807af1036e002babe8f63))
* **sql-editor:** preserve cursor and improve autocomplete behavior ([92c0fe3](https://github.com/debba/tabularis/commit/92c0fe3a3eb8723131a33cd1606fb27b1552082a))


### Features

* add support for `multirange` postgres type ([a56d9f2](https://github.com/debba/tabularis/commit/a56d9f290f458bc42ec66b28d2c61b6ba6661d09))
* add support for `range` postgres type ([14fe823](https://github.com/debba/tabularis/commit/14fe8236ee705283059c5b4bb2f80d6837ecab3a))
* **drivers:** add readonly capability to disable data writes ([2846a2c](https://github.com/debba/tabularis/commit/2846a2c0bf97330b786680e2b2e70ae99955d491))
* **hooks:** add setSettings to usePluginSetting hook ([e0ce6a5](https://github.com/debba/tabularis/commit/e0ce6a538701e8fa702cf3e0a5352a4077a70078))
* **modals:** add error modal and use it for async errors ([4373b9f](https://github.com/debba/tabularis/commit/4373b9f2042616af41fddc51f9d5af01c52b04cd))
* **plugin-modal:** add plugin modal context and provider ([57b89fc](https://github.com/debba/tabularis/commit/57b89fc6f5a1ef668672ab583cae4df2f77149c7))
* **plugins:** add JSON Viewer example plugin for UI Extensions ([53485ec](https://github.com/debba/tabularis/commit/53485ec7eeff845db1e7cdcd18700a54b5b5e20f))
* **plugins:** add manage_tables capability and UI gating ([df07072](https://github.com/debba/tabularis/commit/df070723a2642eaac95c4dedf0a35820ed718e7d))
* **plugins:** add plugin slots and external opener support ([6725a6c](https://github.com/debba/tabularis/commit/6725a6ca4b677eb1da89eada6e2a9171d6c16a64))
* **plugins:** default manage_tables to true and use helper ([6a2a0c5](https://github.com/debba/tabularis/commit/6a2a0c5760af79c2edcbd0b7f3655ff0369d82d7))
* **plugins:** implement Plugin UI Extensions system (Phase 2) ([5e464f3](https://github.com/debba/tabularis/commit/5e464f3a3d196a2bfbd3add8260432d30b7e8601))
* **plugins:** support UI-only plugins and external UI bundles ([065307c](https://github.com/debba/tabularis/commit/065307cf712dcdfa5598978cbf9fa04cd48a007b))
* **settings:** split settings UI into modular tabs and add editor prefs ([4d71583](https://github.com/debba/tabularis/commit/4d715839ea7ce0db84a1be2d2b49a9c955c76e93))

## [0.9.12](https://github.com/debba/tabularis/compare/v0.9.11...v0.9.12) (2026-03-29)


### Bug Fixes

* add missing extracting logic ([6c1bcc2](https://github.com/debba/tabularis/commit/6c1bcc27eed1bf793265083704bb6e47533d7310))
* add missing extracting logic ([743b655](https://github.com/debba/tabularis/commit/743b655787f5d8678577c730ee98dcd3b2ce82cc))
* handle misreported text/blob types using known_type hint ([805d495](https://github.com/debba/tabularis/commit/805d49574562d92c163f91483b96a324c95ea2f2))
* **json-input:** sync text state with value using ref instead of effect ([4ff8b4f](https://github.com/debba/tabularis/commit/4ff8b4ff1bc928255da1f82790884933bfb53164))
* MySQL JSON column values shown as NULL in data grid ([493f125](https://github.com/debba/tabularis/commit/493f1252d7966cb33a1a76b658b62387a55a93e4))
* **react:** add missing hook deps and stabilize callbacks ([c74a2bb](https://github.com/debba/tabularis/commit/c74a2bb946f02f06d98893965f8dc4b90d1c4fff))
* skip the field type bytes ([3d4401c](https://github.com/debba/tabularis/commit/3d4401cd63339083a43904b5a6e2daa44a6608a7))


### Features

* add JSON editor with validation for sidebar editing ([41ab6d1](https://github.com/debba/tabularis/commit/41ab6d119c695cb64c81fa2a22e81b142bf8695c))
* add MiniMax as first-class AI provider ([ffc0e50](https://github.com/debba/tabularis/commit/ffc0e50893d46c4091997d5c80dea1b0fc612c9c))
* **alert:** add global alert modal and replace dialog notifications ([27c843d](https://github.com/debba/tabularis/commit/27c843db1ff32b5e2a50efb5b8f5fafecd181412))
* **editor:** show active database and update window title ([6ddc629](https://github.com/debba/tabularis/commit/6ddc62925919ca4068d08b8152313683600eb853))
* **error:** improve pg errors and add toggleable details UI ([f83025b](https://github.com/debba/tabularis/commit/f83025b6ae028b95a5e30626132257cb72ecc1e8))
* **posts:** include PR contributors between releases in contributor ([945823d](https://github.com/debba/tabularis/commit/945823d4d2d0a3fbec7c9fd14eda9828f7064b81))
* **settings:** add provider icons and change key label ([5ffad1a](https://github.com/debba/tabularis/commit/5ffad1a2b2fc2a276059ed29172898b3cd8cbe49))
* **website:** add ZH to language badge ([6037e00](https://github.com/debba/tabularis/commit/6037e000b182613a4e43a5480f282f58b109d8b6))

## [0.9.11](https://github.com/debba/tabularis/compare/v0.9.10...v0.9.11) (2026-03-25)


### Features

* add Chinese (Simplified) language support ([fc8c6b9](https://github.com/debba/tabularis/commit/fc8c6b923bb06112c3b90aea8465ab435ed4597c))
* **console:** enable inline editing for single-table query results ([a9ceb74](https://github.com/debba/tabularis/commit/a9ceb74e2c9c5e243e7a34eb6ab1ed2e4bcd2bb1))
* **copy:** add JSON copy format and selectable default ([594cb8c](https://github.com/debba/tabularis/commit/594cb8c5e6e17bc312f975ce404109d3e62245f9))
* **export:** add configurable CSV delimiter for copy and export ([5e20c6a](https://github.com/debba/tabularis/commit/5e20c6a479721f831d9a7f4798eaf3cbb91235fb))
* **postgres:** support array types and JSON-to-ARRAY literals ([9ab2c37](https://github.com/debba/tabularis/commit/9ab2c37f78ce4afea3555ceb9e7cf52d81f387a0))

## [0.9.10](https://github.com/debba/tabularis/compare/v0.9.9...v0.9.10) (2026-03-18)


### Bug Fixes

* **blog:** make tag filter dropdown inline instead of overlay ([96dbf96](https://github.com/debba/tabularis/commit/96dbf961924bcc39a59e0b23369a28e1a4decc09))
* **database-provider:** reflect multi-db selection in window title ([85548f8](https://github.com/debba/tabularis/commit/85548f8d4ce2ddd098de7caa4f7d0c3a3c5cb7c0))
* **index:** update gitnexus version in AGENTS.md ([d3c3130](https://github.com/debba/tabularis/commit/d3c3130dedb4ed062ed76cf4f1f75367aa4b8ae3))
* **modals:** focus name input on validation and update placeholder ([eac063f](https://github.com/debba/tabularis/commit/eac063f43fb761ab98ac5aa090aef907edebc577))
* normalize blog post dates to ISO 8601 format (YYYY-MM-DDTHH:MM:SS) ([5510dba](https://github.com/debba/tabularis/commit/5510dbac65825c8dd1e7a26439deed718f292b03))


### Features

* **blog:** replace tag cloud with collapsible "Filter by tag" dropdown ([6926bd4](https://github.com/debba/tabularis/commit/6926bd49197e70cf66102c2275396c529bfdf122))
* **commands:** allow selecting database for record operations ([e12efdd](https://github.com/debba/tabularis/commit/e12efddd6d57ac217d00234eb0fa7e25c2a931f7))
* Display platform detection badge ([7b55b58](https://github.com/debba/tabularis/commit/7b55b58479f4bf50e20c634437a9ce71863e7974))
* **docs:** add changelog page and rename screenshots ([fe78037](https://github.com/debba/tabularis/commit/fe78037a504442e8982d5f0ce14f7f3ff2617e3a))
* **download:** add download thank you page with auto-trigger and ([b1e78c3](https://github.com/debba/tabularis/commit/b1e78c36c5059ebbbc7798ebfaf9c5109974b624))
* **mcp:** add multi-client support and connection improvements ([d9655e6](https://github.com/debba/tabularis/commit/d9655e68de33ab83e6b124a3e4e2cf4fd50705cc))
* **search:** add client-side search functionality ([652b3e4](https://github.com/debba/tabularis/commit/652b3e4ef74dc484ddcd7019a9155d55a76f1b47))
* website - add reading time to PostCard ([d08cc02](https://github.com/debba/tabularis/commit/d08cc0277d55eca545476533c07d83df20708e69))



## [0.9.9](https://github.com/debba/tabularis/compare/v0.9.8...v0.9.9) (2026-03-14)


### Bug Fixes

* **connections:** show menu only when groups exist or connection grouped ([0e71482](https://github.com/debba/tabularis/commit/0e71482a83fd4553b210c8bbf6e7dedf299a6c0a))
* **sponsors:** set dynamic to force-static for OG image ([862b49d](https://github.com/debba/tabularis/commit/862b49db50e33594aed0c87e5f95329068d5ff0f))
* **ui:** improve connection card styling ([29d1bcc](https://github.com/debba/tabularis/commit/29d1bccc7998c5f20ecbb4619145faafcf3bd7bd))
* **website:** constrain sponsor modal height and enable scrolling ([a8a8025](https://github.com/debba/tabularis/commit/a8a802545a7f2d4e049c7d3717c39d13b01ff1b1))


### Features

* **auth:** add validation for connection name and databases selection ([3fffa04](https://github.com/debba/tabularis/commit/3fffa047bc04db6afc599f1170167fdc00bf0683))
* **mcp:** add MCP server docs, client icons, and UI integration ([78c22e5](https://github.com/debba/tabularis/commit/78c22e55348c6eb7f8575313c50e5dc7202f0fff))
* **plugins:** add connection_string and connection_string_example flags ([2de0297](https://github.com/debba/tabularis/commit/2de0297cffb7f5feffd319f513445e93f34cfc29))
* **sponsors:** add Open Graph image and page metadata ([5c5c124](https://github.com/debba/tabularis/commit/5c5c124bc51873b0adf5d76f7e746e55bd622193))
* **sponsors:** add optional highlightColor for sponsor accents ([2139848](https://github.com/debba/tabularis/commit/2139848128a6939f03d067251cb2761ff34ee6e8))
* **sponsors:** add sponsor sync script and generated docs ([9e82f9a](https://github.com/debba/tabularis/commit/9e82f9a943dc7d35ad30c5938dca2a71f1c6126f))
* **sponsors:** add sponsors page, contact form, grid, and confirm page ([6b592b6](https://github.com/debba/tabularis/commit/6b592b668bf64ef22931df5d91bb1f7de97eb09e))
* **sponsors:** add sponsors section and assets to website ([cc802fd](https://github.com/debba/tabularis/commit/cc802fded81a59920bad008d2c8c80daf259ebb6))

## [0.9.8](https://github.com/debba/tabularis/compare/v0.9.7...v0.9.8) (2026-03-11)


### Bug Fixes

* **new-connection-modal:** avoid returning promise from onClick ([14f644e](https://github.com/debba/tabularis/commit/14f644e7878249b471a2cb1c48a1c25bedbb747b))
* **new-connection-modal:** reset tab on close and UI tweaks ([7a1f2fb](https://github.com/debba/tabularis/commit/7a1f2fbeb6301c89b588a59cdeb0a8f4f739a285))
* **sqlite:** resolve SQLITE_CANTOPEN (error code 14) on Windows ([c8e5734](https://github.com/debba/tabularis/commit/c8e5734dbdf5920294bfdf24e76c8c8ef249e163))
* **visual-query:** replace HTML5 drag-and-drop with pointer events for ([3afee6b](https://github.com/debba/tabularis/commit/3afee6ba61188f4bdb70096927c2311c45b1c8e8))


### Features

* **download-buttons:** add split download button with platform dropdown ([542961c](https://github.com/debba/tabularis/commit/542961cf34e3b8d0723af752f6ef96242b59818e))
* **download:** add download modal and wire up download buttons ([f2cc6ab](https://github.com/debba/tabularis/commit/f2cc6ab146ea6d3313e1e175784fce0f04667ed3))
* **drivers:** add connection string parser and import UI ([2258ba3](https://github.com/debba/tabularis/commit/2258ba39a4c84bdf0567bd12dd3716bccd2cf096))
* **plugins:** add hackernews plugin to registry ([6635124](https://github.com/debba/tabularis/commit/663512496c25f88c5e03c413f34e30fb8db1fc1f))
* use ubuntu 25.04 for building linux ([5f80a89](https://github.com/debba/tabularis/commit/5f80a89d4d31564af0f9da82b189917dcab02c09))



## [0.9.7](https://github.com/debba/tabularis/compare/v0.9.6...v0.9.7) (2026-03-09)


### Bug Fixes

* build alerts ([c5cf57a](https://github.com/debba/tabularis/commit/c5cf57a16efc41e4b3644372fa779794c2b2cf6d))
* merged code ([c430a5b](https://github.com/debba/tabularis/commit/c430a5b00a24b733dec3b35b6c312391459cebd9))
* **tabs:** prefer loaded activeTabId or null, avoid implicit fallback ([297138b](https://github.com/debba/tabularis/commit/297138b702b51134d91f9f0b487f867a6c667546))
* use SqliteConnectOptions for reliable WAL mode database opening ([b0d0a4f](https://github.com/debba/tabularis/commit/b0d0a4f44ed8ec929daa5745bbb0e701e8c2201e))


### Features

* add connections group ([1e91768](https://github.com/debba/tabularis/commit/1e91768d3171f1a08b8b80e81fc269e2684510bc))
* **credential-cache:** add credential cache to reduce keychain calls, ([ca2e668](https://github.com/debba/tabularis/commit/ca2e668763491032d5b109105889b76ad49e5de5))
* **credentials:** fetch connection credentials when editing connections ([e580ccf](https://github.com/debba/tabularis/commit/e580ccfd5f62466679fbcd288d6d8acd5db16071))
* **modals:** add ConfirmModal and replace inline confirm dialogs ([0ceddda](https://github.com/debba/tabularis/commit/0cedddad723105ffb16e08a02f17570754e83bda))
* **new-connection-modal:** preselect databases from initial connection ([53d10c9](https://github.com/debba/tabularis/commit/53d10c91ec2260023b564a66ac635e0f68f55875))
* **plugins:** add per-plugin interpreter settings with error modal ([64ed30c](https://github.com/debba/tabularis/commit/64ed30cab6e980f78ad4c29c3e67841451857d74))
* **plugins:** add plugin remove modal and integrate into Settings ([e2d38f5](https://github.com/debba/tabularis/commit/e2d38f5292c61dd7ce14dfd8fb912846692ef7f7))
* **plugins:** add plugin settings and no_connection_required flag ([7097190](https://github.com/debba/tabularis/commit/70971909c34fc73b3c59ab743cb183654e54e63f))
* **select:** add Select component and replace SearchableSelect ([3be733a](https://github.com/debba/tabularis/commit/3be733a176b3265a7d2bd06a7dc2f4cd271556fa))
* **settings:** add portal-based plugin version dropdown ([9f4f82c](https://github.com/debba/tabularis/commit/9f4f82c2ce90bada6d091fe08e1042ead58f98b9))

## [0.9.6](https://github.com/debba/tabularis/compare/v0.9.5...v0.9.6) (2026-03-07)


### Bug Fixes

* add autoComplete="off" to all connection dialog inputs ([573380b](https://github.com/debba/tabularis/commit/573380b6f01888e4ddadc3b5a597de454b2e413a)), closes [#64](https://github.com/debba/tabularis/issues/64)
* disable macOS autocorrect on connection dialog inputs ([481f7fe](https://github.com/debba/tabularis/commit/481f7fe4bb081c8424fe2ab3050986d547ea26f7)), closes [#64](https://github.com/debba/tabularis/issues/64)
* **website:** scope badge image rule to shields.io only ([af7dfb7](https://github.com/debba/tabularis/commit/af7dfb7cf1bfa6933be1617af11a2b8fea2b89fd))


### Features

* **editor:** add close tab keyboard shortcut ([167de6e](https://github.com/debba/tabularis/commit/167de6e9409f121b58622556954d8f17e9c9db10))
* **filters:** add structured filter utils and toolbar UI ([150e08f](https://github.com/debba/tabularis/commit/150e08f323bcedc477ba605a89eec6d513ce9130))
* **plugins:** add clickhouse plugin to registry ([1a78418](https://github.com/debba/tabularis/commit/1a78418c41b509195d3e8672582f8892f660c008))
* **plugins:** add install error modal and improve installer logging ([db2d0de](https://github.com/debba/tabularis/commit/db2d0ded454b5f2be9110d0279dc6b3ec8cdccd0))
* **plugins:** add Redis plugin to registry with version 0.1.0 and download links ([848b530](https://github.com/debba/tabularis/commit/848b530010306b3087fe1604dc20cf5ca24375b0))
* **plugins:** update redis plugin assets and add download logging ([204175f](https://github.com/debba/tabularis/commit/204175f4a2370df23bc81a6a1b7fc0b7014ed7de))
* **table-toolbar:** add ORDER BY autocomplete ([ed58068](https://github.com/debba/tabularis/commit/ed58068e127842a9784c3d3788df283049411f71))

## [0.9.5](https://github.com/debba/tabularis/compare/v0.9.4...v0.9.5) (2026-03-04)


### Bug Fixes

* **mysql:** use per-db pools and include database in pool key ([9abda3b](https://github.com/debba/tabularis/commit/9abda3bf8c2e4e7b5237233e1a61a725e409a6b8))
* **postgres:** bind UUID strings as uuid type for queries ([380c494](https://github.com/debba/tabularis/commit/380c494559f0febf6958943cecedaae0dabe7071))
* remove runtime monaco-editor import to bundle only SQL ([cc8d960](https://github.com/debba/tabularis/commit/cc8d96076f0c8cd2d090303bfbff2e64d2b59fcb))
* **updater:** avoid stale cache and restart app after update ([38ec23a](https://github.com/debba/tabularis/commit/38ec23abb854c767ec15819a520c4975a97f4621))


### Features

* Apply Tauri recommended compiler options ([63de45f](https://github.com/debba/tabularis/commit/63de45f62edee65e136e37bec3e32e0221cb0c0c))
* **cookie-consent:** add cookie consent component and policy page ([37211d5](https://github.com/debba/tabularis/commit/37211d5db372fd651b2a49b6457690e64f3d8997))
* **cookie-consent:** enable cookieless Matomo and consent flow ([be1bffd](https://github.com/debba/tabularis/commit/be1bffd01e737e0a0eb8262fff499889b686862a))
* **cookies:** add manage cookies button and matomo consent handling ([adeedb6](https://github.com/debba/tabularis/commit/adeedb6e660fac5777d2d467c82a0b2118007702))
* **data-grid:** add header context menu to data grid ([85a6efc](https://github.com/debba/tabularis/commit/85a6efcb3b8905910d65dae3d7bc1f0b419ac150))
* **dump:** add schema-aware dump/import utilities and UI integration ([f964fb7](https://github.com/debba/tabularis/commit/f964fb7e5d2891a36e94884ef37e79df4d14813e))



## [0.9.4](https://github.com/debba/tabularis/compare/v0.9.3...v0.9.4) (2026-03-02)


### Bug Fixes

* **blob:** treat small UTF-8 varbinary values as plain text ([c6f5c75](https://github.com/debba/tabularis/commit/c6f5c7594989a6f457f284702da038e7c6df12ef))
* **datagrid:** include pending changes in sidebar row data ([ec08534](https://github.com/debba/tabularis/commit/ec08534dc2f814c2b1d8a92ae61eb0f2e9edd292))
* **react:** include missing hook deps in Connections and Settings ([540e69c](https://github.com/debba/tabularis/commit/540e69cffd14c48996f02b4168c159a841abf9ae))


### Features

* **connections:** redesign connections UI and add i18n keys ([3e06b75](https://github.com/debba/tabularis/commit/3e06b75208c7e6c188873799bbc0100d3f95befd))
* **database:** support multi-database selection and driver UI metadata ([02efa39](https://github.com/debba/tabularis/commit/02efa3917736eeaea8969816b83272f6eb8437ff))
* **db-panel:** scope database APIs per panel and display conn name ([c7ce603](https://github.com/debba/tabularis/commit/c7ce603a3c3f32ff307e6d7229d66782187d4320))
* **db:** add multi-database sidebar and utilities ([5851da9](https://github.com/debba/tabularis/commit/5851da983f15e64a1659262fb6586bfeeee1d7b7))
* **drivers:** use branded icons and colors for built-in drivers ([621d765](https://github.com/debba/tabularis/commit/621d76571ff081291ddb3c791fac65c1a59691a2))
* **explorer:** add database manager and get_available_databases command ([d4ad168](https://github.com/debba/tabularis/commit/d4ad1681bb1fbf357fe546b4864947912dc69c93))
* **keybindings:** add keyboard shortcuts system and persistence ([45df357](https://github.com/debba/tabularis/commit/45df357bab8c3cb1b4edae7d93ea752ceba54fd8))
* **keybindings:** show shortcut hints and map display keys ([e608b5f](https://github.com/debba/tabularis/commit/e608b5f54533573eec06b78ee13e161132215aae))



## [0.9.3](https://github.com/debba/tabularis/compare/v0.9.2...v0.9.3) (2026-03-01)


### Bug Fixes

* open graph image ([12696a0](https://github.com/debba/tabularis/commit/12696a0db8ce00f227b2bc02b38d701601d69f2e))
* **plugins:** resolve plugin executable lookup on Windows ([f766141](https://github.com/debba/tabularis/commit/f766141a48673d2bb816d7d462232e929b4ba5bd))


### Features

* **settings:** add downgrade flow and translations for older versions ([77ebbb3](https://github.com/debba/tabularis/commit/77ebbb3ee5b856f1b0d73030484e6a5ed753790d))
* **site-header:** smooth scroll to top when clicking logo on home ([a83b765](https://github.com/debba/tabularis/commit/a83b76555967677f63812229e24200b6e259cf0d))
* website - create latests-post.json ([081c7e5](https://github.com/debba/tabularis/commit/081c7e5a47349d2672cdead08504288f6b290616))
* **website:** add blog post for plugins evolved and plugin card ([d12b24f](https://github.com/debba/tabularis/commit/d12b24fd2fdca282dda449f843758860271f1ed4))
* **website:** add install links and update installation docs ([ee0c597](https://github.com/debba/tabularis/commit/ee0c597eebf37325927bb76b831947bed6a6c19a))



## [0.9.2](https://github.com/debba/tabularis/compare/v0.9.1...v0.9.2) (2026-02-26)


### Features

* **drivers:** add driver capability metadata and helper utilities ([3b0a2a3](https://github.com/debba/tabularis/commit/3b0a2a3ff8b68b4ffa9073bd4b512ea4c632a63f))
* **drivers:** add is_builtin and default_username to plugin manifests ([60ac211](https://github.com/debba/tabularis/commit/60ac211bf494ab52e46ae8383c3dbfc3469dfc74))
* **lightbox:** add mobile slider, touch and keyboard navigation ([ab00d29](https://github.com/debba/tabularis/commit/ab00d29c66a37f613385a4740d5a5735b3d76768))
* **plugin:** add enable/disable functionality with proper shutdown ([6a4272a](https://github.com/debba/tabularis/commit/6a4272a84fa53d4510ad6b61e6f1aed0a88fbd23))
* **plugins:** add custom registry URL support ([7f17e46](https://github.com/debba/tabularis/commit/7f17e46986e121f0dabdfba9b06c0356c70e8ae6))
* **plugins:** manage disabled external plugins ([99968d8](https://github.com/debba/tabularis/commit/99968d8c58d7404195613f5aada4b7d83aa66e06))
* **query:** use LIMIT+1 for pagination and add count query ([7473e63](https://github.com/debba/tabularis/commit/7473e6338a1f563c4549745b5a5f2e08726a98bf))
* **registry:** add plugin releases metadata and GitNexus skills ([49e5480](https://github.com/debba/tabularis/commit/49e54803aad975cc14025a2e398231ea64d63a19))
* **task-manager:** add child process details to task manager ([a24b2cb](https://github.com/debba/tabularis/commit/a24b2cb4bc212ac779146bd534c2b44aaccfe509))
* **task-manager:** add process monitoring and management system ([c899ee5](https://github.com/debba/tabularis/commit/c899ee517c4da26466ee6981115a9f94f8a0f87f))
* **task-manager:** optimize child process loading ([4d8e8bc](https://github.com/debba/tabularis/commit/4d8e8bc90b5dcf6109c59ee141e7db5baedba34f))
* **ui:** add Task Manager feature article and gallery item ([c9f2fd4](https://github.com/debba/tabularis/commit/c9f2fd4833fb84b2c400c790b06b2131390ade38))
* **website:** add homepage intro and update global styles ([a024a74](https://github.com/debba/tabularis/commit/a024a74fb730e68555cd5342e52cb401c5b82a9f))
* **website:** include min_tabularis_version in plugin display ([17f0aab](https://github.com/debba/tabularis/commit/17f0aab3eae5d510e50aa23ae29acda56f157cbc))
* **website:** make plugin author link clickable and tidy layout ([83ed834](https://github.com/debba/tabularis/commit/83ed83495ae0ca79db432312d9e75f2b0ff07a5b))


### Performance Improvements

* **postgres:** run count query concurrently for paginated selects ([f96152c](https://github.com/debba/tabularis/commit/f96152c1edc29d3839d40db4b491135c006dc6cf))


### BREAKING CHANGES

* **task-manager:** removes children field from TabularisSelfStats, now
fetched on-demand
* **query:** Pagination.total_rows is now Option<u64> and has_more
added



## [0.9.1](https://github.com/debba/tabularis/compare/v0.9.0...v0.9.1) (2026-02-25)


### Bug Fixes

* **app:** remove localhost debug override ([7cbbacd](https://github.com/debba/tabularis/commit/7cbbacdfda3f3231da15c859a2698c95eda5c58f))
* **ci:** resolve pnpm store path from website directory ([6badec3](https://github.com/debba/tabularis/commit/6badec36b5524ab3014b431a87751e1d5197f301))
* **ci:** resolve pnpm store path from website directory ([f0c4620](https://github.com/debba/tabularis/commit/f0c4620cb1683cb8f7dd50e490b00ceac7c5d5ad))
* **plugins:** accept 'universal' asset as fallback for platform ([45b638d](https://github.com/debba/tabularis/commit/45b638d9d7ecbcf20cc48ee329adf4c5ec3b50f6))
* **website:** correct next-env import path ([4f04254](https://github.com/debba/tabularis/commit/4f04254030709e108436b0973423cee291f17124))


### Features

* **blog:** add blog section with posts and styling ([cc4cab7](https://github.com/debba/tabularis/commit/cc4cab747bab9d718b16c19aef276f5d4f9ca48a))
* **blog:** add post meta bar and syntax highlighting ([f6a3dc8](https://github.com/debba/tabularis/commit/f6a3dc8e3ca4fe9e532b921f95154add51307349))
* **blog:** add search modal, post navigation, and author card ([01c16c7](https://github.com/debba/tabularis/commit/01c16c7e03ef00f3b937f79fc87479e0425ed0a2))
* **data-grid:** support multiline cell editing with autosized textarea ([fa9df84](https://github.com/debba/tabularis/commit/fa9df8401528ad86697eaafc28eca889f3d5a287))
* **drivers:** add folder_based capability for directory plugins ([0919ccc](https://github.com/debba/tabularis/commit/0919ccc4d977a9900222aa874a1bb3d1f600108b))
* **drivers:** add folder_based capability to fallback drivers ([3ac2a90](https://github.com/debba/tabularis/commit/3ac2a903395eb0bf994ea164f22787fd162c4b0b))
* **editor:** add tab switcher modal and tab scrolling utils ([f50627f](https://github.com/debba/tabularis/commit/f50627f349ab3e66261fdcaa2ebc7cf0fe371d11))
* **flathub:** add publishing workflow and flatpak support ([a7b10d5](https://github.com/debba/tabularis/commit/a7b10d5e7c7878b511fa279114ba8780a8d46f0a))
* **home:** add edit-on-github links to home page ([fe1af9e](https://github.com/debba/tabularis/commit/fe1af9e028dde7a8cd3b22f821cae43439acbed9))
* **layout:** set metadataBase to https://tabularis.dev ([82ba795](https://github.com/debba/tabularis/commit/82ba7952b3fbde82034d7636337bfdb888eced4b))
* **plugins:** add csv plugin entry to registry ([602b3c6](https://github.com/debba/tabularis/commit/602b3c6f7c4a2681f2e0ecfbb57c5abdf2d461e0))
* **plugins:** add plugin manifest JSON schema and guide note ([11d9854](https://github.com/debba/tabularis/commit/11d9854dbeac9128da743fbd19a9fa2faf14fa5e))
* **plugins:** require length and precision in manifests ([adc5254](https://github.com/debba/tabularis/commit/adc5254d0f870c9ac5ed2a1e107b1f9f787c178f))
* **site-header:** add logo and restructure header with crumbs ([d9517e8](https://github.com/debba/tabularis/commit/d9517e8f9cc111ebe27c0406a08751f7aa5c997c))
* **site:** add Matomo tracking and dynamic post list loading ([bb80f04](https://github.com/debba/tabularis/commit/bb80f0452fff87a782c652f3cf3de3a0994c8956))
* **ui:** add DateInput component and dateInput utils with tests ([9b3f52b](https://github.com/debba/tabularis/commit/9b3f52ba70a304caf9dfd9272e40fe57ca2840c2))
* **ui:** redesign theme cards and enhance search modal ([87481c7](https://github.com/debba/tabularis/commit/87481c700c118b493e9dad00a80d38fe01725419))
* **updater:** detect installation source and skip updates for packages ([d5e4b10](https://github.com/debba/tabularis/commit/d5e4b10967acf381f6a4e03eeeced79321a86169))
* **website:** add 404 page, sitemap and header crumbs styles ([db5fb3f](https://github.com/debba/tabularis/commit/db5fb3f29dd0631e7d61d9cbb1708e513d8fd5ae))
* **website:** add blog pagination, tags, and og images ([4aa9352](https://github.com/debba/tabularis/commit/4aa935291314f58fcb7b1c1353423a9510890c2b))
* **website:** add plugins registry and unified site header ([3c3d93c](https://github.com/debba/tabularis/commit/3c3d93cd2076c177d7cb2367e1612046fb2c6d41))
* **website:** add post styles and wiki open graph metadata ([6ef5705](https://github.com/debba/tabularis/commit/6ef5705c30f7f7c9bef34905f8b59f70f2ed8aa7))
* **website:** add screenshot 9 and OG page ([0001546](https://github.com/debba/tabularis/commit/0001546b6464493cda5a7f9765207460c1ed94c4))
* **website:** convert static HTML site to Next.js with static export ([60201c3](https://github.com/debba/tabularis/commit/60201c31b0eb85bae17ddc6317f716aed237ac42))
* **website:** use APP_VERSION and add platform install docs ([18ffc35](https://github.com/debba/tabularis/commit/18ffc358651f396a6ffa2009de080d6ea9350767))
* **wiki:** add wiki content, pages, and UI integration ([cfee3fd](https://github.com/debba/tabularis/commit/cfee3fdf41ff0b5ab4b57daab5dfc004b63eae37))


### BREAKING CHANGES

* **plugins:** manifest.schema.json replaces has_length with
requires_length and requires_precision and adds default_length



# [0.9.0](https://github.com/debba/tabularis/compare/v0.8.15...v0.9.0) (2026-02-23)


### Bug Fixes

* **connection:** handle test failures, check DB file, parse port ([09600f2](https://github.com/debba/tabularis/commit/09600f2db7a83f873a681af776f9cba78cfd519f))
* database dropdown selection on click ([631eccc](https://github.com/debba/tabularis/commit/631ecccb1e5390b1dfdfd955988c87d7994eb07f))
* **duckdb:** improve query type detection in execute_query function ([9ec6acc](https://github.com/debba/tabularis/commit/9ec6acccc9a3de2cdb21cc6f98db5a9f3412d3f4))
* **editor:** use per-tab editor ref and fallback to saved query ([b3de58b](https://github.com/debba/tabularis/commit/b3de58b0cde2ab5651ad9f7e7f33d855c30140c5))
* **ui:** hide keychain option for file-based drivers ([f76c0ec](https://github.com/debba/tabularis/commit/f76c0ec1af1fca9c1e657ff16f2d239de0edb106))


### Features

* **drivers:** add alter_primary_key and update duckdb pk logic ([c9b3e9c](https://github.com/debba/tabularis/commit/c9b3e9c2df8261253643bd36aed3d376ac06c23a))
* **duckdb:** add base64 dependency and extend data types list ([4c1c494](https://github.com/debba/tabularis/commit/4c1c4941c4bb26028e3d91d301964a6c7e1301f6))
* **duckdb:** add duckdb plugin with manifest and CLI bridge (as ([5b10c38](https://github.com/debba/tabularis/commit/5b10c38935a5267f9f188097465a37da9111db85))
* **duckdb:** inject rowid for tables without primary key in SELECT * ([2efa700](https://github.com/debba/tabularis/commit/2efa700e1afdc94317117fcc569bf4ef48fc9b2e))
* **plugins:** add external JSON-RPC plugin system and manager ([ebd23fa](https://github.com/debba/tabularis/commit/ebd23fab7705010392c66f9ecf958003f809d745))
* **plugins:** add plugin registry and installer ([195f154](https://github.com/debba/tabularis/commit/195f15472c17c859a288d0924226b8110a5a32aa))
* **plugins:** implement dynamic database driver plugin ecosystem ([609290b](https://github.com/debba/tabularis/commit/609290bc781bbadadd2a208a1856041de30de078))
* **website:** add plugin registry section to website ([36ac05c](https://github.com/debba/tabularis/commit/36ac05cb7ea59541c0078e22acd8d0c19c6ccd8d))



## [0.8.15](https://github.com/debba/tabularis/compare/v0.8.14...v0.8.15) (2026-02-21)


### Bug Fixes

* **ui:** hide set-empty button for blob fields ([989e5f9](https://github.com/debba/tabularis/commit/989e5f9dbda5497bad3949712b3811f36f18b714))


### Features

* **blob:** add blob parsing and payload helpers ([e5e6e66](https://github.com/debba/tabularis/commit/e5e6e66e69873bcda2e6499f04c4567718222ea8))
* **blob:** add image preview and fetch blob as data URL ([8e0d677](https://github.com/debba/tabularis/commit/8e0d677ecb2ef5fb91bea116390d43634fce065e))
* **blob:** enforce configurable max blob size and show errors ([86039cc](https://github.com/debba/tabularis/commit/86039ccb9caa725a4b3109ec8f519f1f10cdf3d1))
* **blob:** handle large BLOBs with backend truncation and UI support ([68848d5](https://github.com/debba/tabularis/commit/68848d5a722a9384bc7a0f5818ee499425ae9c0e)), closes [#36](https://github.com/debba/tabularis/issues/36)
* **blob:** improve large BLOB handling with preview wire format ([9de0a4e](https://github.com/debba/tabularis/commit/9de0a4ecc2d6cf49020698bb4fffc2f4de7bc9da))
* **pool-manager:** add default MySQL connection params ([f2fc644](https://github.com/debba/tabularis/commit/f2fc64413ec6754e838109cda425503b1aacce32))



## [0.8.14](https://github.com/debba/tabularis/compare/v0.8.13...v0.8.14) (2026-02-17)


### Bug Fixes

* **commands:** clear connection_id for temporary information_schema pool ([30f870e](https://github.com/debba/tabularis/commit/30f870e05263d57721f1c6dda01c243a70facc68))
* **connections:** disconnect active connection before deleting ([461b027](https://github.com/debba/tabularis/commit/461b0276a094ff56146e52286904626b2b0e6175))
* **mysql:** exclude views from get_tables query ([146f4af](https://github.com/debba/tabularis/commit/146f4afbc3fcd46d109edb2c79c594d31616a828))
* **ssh:** verify host keys, use accept-new, secure logging ([d8ab538](https://github.com/debba/tabularis/commit/d8ab538ee684c8fb1146e98d81f810aad88287ae))


### Features

* add split view, open editor, AI overlay; improve connection state ([bd98bea](https://github.com/debba/tabularis/commit/bd98beaea6db749a182c97b6465164198a296223))
* **connection:** add connection manager utils, hook, and UI components ([e58456b](https://github.com/debba/tabularis/commit/e58456bdcff0006fd0e7170c521012357e7f9bba))
* **editor:** relocate AI assist buttons to overlay and adjust padding ([0f346d8](https://github.com/debba/tabularis/commit/0f346d8af690f680b212f549342773e9b496c2af))
* **layout:** add split view layout with connection grouping ([903286f](https://github.com/debba/tabularis/commit/903286fbbee36862eaf26a42355fbf731fc99c5d))
* **layout:** add split view visibility control and panel close button ([b35e059](https://github.com/debba/tabularis/commit/b35e059163acbf32dfe8b2c12f50ab80fdcc8461))
* **layout:** replace connections icon and remove editor link ([23a7d8d](https://github.com/debba/tabularis/commit/23a7d8da1d1a489af3dfa20a9ea2189e4b72b629))
* **searchable-select:** render dropdown via portal with positioning ([396f384](https://github.com/debba/tabularis/commit/396f3844640d9e8741aaf9b72e628402fd3c634c))
* **sidebar:** add context menu to open connection in editor ([72614b7](https://github.com/debba/tabularis/commit/72614b791b48a21852f893cba2f44faf2ae2bb0e))



## [0.8.13](https://github.com/debba/tabularis/compare/v0.8.12...v0.8.13) (2026-02-15)


### Features

* **connections:** add disconnect command and provider handling ([622ab6c](https://github.com/debba/tabularis/commit/622ab6ca53f8b2b566c3fb0fdcadd096923dde9d))
* **database:** test connection before loading schemas ([001ea15](https://github.com/debba/tabularis/commit/001ea158670b9b882efcde980106e103d40aaabe))
* **drivers:** add data type registry and extraction modules ([c6e0d25](https://github.com/debba/tabularis/commit/c6e0d25adf66dc864fcb1b60631b8545090e6c79))
* **geometry:** add geometry parsing and WKB->WKT formatting ([6c4aaa5](https://github.com/debba/tabularis/commit/6c4aaa57f857e1ca550a1a763912ebf944956eac))
* **icons:** add Discord icon component and replace MessageSquare usages ([f453e1c](https://github.com/debba/tabularis/commit/f453e1cd4d6577033f56dfdd3d1a95c70c82048b))
* **mysql,postgres:** support raw SQL function inputs for spatial data ([dbcb5f2](https://github.com/debba/tabularis/commit/dbcb5f2e1e21da0d21cdbb293bda17675ad37cb3))
* **postgres,i18n:** add pg schema selection and Spanish locale ([d278718](https://github.com/debba/tabularis/commit/d27871806dcaa2ff3a70a387b055b91607bb6cbe))



## [0.8.12](https://github.com/debba/tabularis/compare/v0.8.11...v0.8.12) (2026-02-11)


### Bug Fixes

* **drivers-mysql:** use column indices for Windows/MySQL 8 ([8e30b8f](https://github.com/debba/tabularis/commit/8e30b8f6a2af61ef25e8dbc5c574705c2baa910e))


### Features

* **tauri:** integrate clipboard-manager plugin and editor paste ([0bc7a68](https://github.com/debba/tabularis/commit/0bc7a6891114a398ca5a07ba9e34b016c1a9daee))



## [0.8.11](https://github.com/debba/tabularis/compare/v0.8.10...v0.8.11) (2026-02-10)


### Bug Fixes

* **db:** allow empty inserts for auto-generated fields in insert_record ([5c34144](https://github.com/debba/tabularis/commit/5c3414424d38a742140bef4cce94ff6c4ea70fa8))
* **postgres:** read is_pk as bool instead of i64 ([90a95da](https://github.com/debba/tabularis/commit/90a95da42a76ffe2923db5a52e0a6e82d9edff3d))
* **ui-data-grid:** handle insertion row metadata and cleanup comments ([d54c3cb](https://github.com/debba/tabularis/commit/d54c3cb2cc4b0c8ff85587047e5ed2ebc8547ddd))
* **ui:** show database load error below database select ([fe6d7eb](https://github.com/debba/tabularis/commit/fe6d7eb929b70d8a206d770f2fbd21fe00b9e31f))


### Features

* **community:** add community modal and Discord link ([d031009](https://github.com/debba/tabularis/commit/d031009eacb7ebf9895172b5e4dc2430d6ac5a8d))
* **data-grid:** add cell display utils and styling helpers ([759b80c](https://github.com/debba/tabularis/commit/759b80c46e6a8870a6fb82884f5409978b851b2e))
* **data-grid:** add DEFAULT sentinel handling and cell value actions ([b89eed5](https://github.com/debba/tabularis/commit/b89eed5cbb4c93a4087d764d99dd40259768b0c4))
* **data-grid:** add edit and mark-for-deletion actions in context menu ([7e7426c](https://github.com/debba/tabularis/commit/7e7426ced0e90359b60e7f4d490db34d88305990))
* **db:** implement default value retrieval for MySQL and PostgreSQL ([ac7ecd5](https://github.com/debba/tabularis/commit/ac7ecd59593f8addf6f02e52c1c8a8d7d0fad8cd))
* **drivers-postgres:** add extended PostgreSQL metadata functions and ([4f91dbb](https://github.com/debba/tabularis/commit/4f91dbb7ecc5b4f1ab25b43c7407980d2908c0a5))
* **editor:** add global Ctrl+F5 shortcut to run queries ([895bfb6](https://github.com/debba/tabularis/commit/895bfb669ea2d82d4e0422988c90ff53c9a10bc5))
* **editor:** add pending insertions support ([c4c6ad9](https://github.com/debba/tabularis/commit/c4c6ad95c75e582860e16d842c2f142765baf2d2))
* **editor:** add table run prompt and fallback query handling ([483fdd4](https://github.com/debba/tabularis/commit/483fdd4fbd7622d9ac41bf8447018d7f25f133dc))
* **editor:** display discard option and handle auto-increment defaults ([bb60012](https://github.com/debba/tabularis/commit/bb600123a1e936bd3085333cdf3d8f6936e4c9a1))
* **prefs:** add editor preferences persistence via tauri backend ([9b481d9](https://github.com/debba/tabularis/commit/9b481d918feba2ce4c8aa8f2b1ed5dcc59c72580))
* **roadmap:** add links to roadmap and make items openable ([77f7995](https://github.com/debba/tabularis/commit/77f7995ba4b26d017f467cc74ab0647c76815bd5))
* **roadmap:** add roadmap sync workflow and update scripts ([2a8c48d](https://github.com/debba/tabularis/commit/2a8c48d3bf02f9e6124b9526a3d899a7eddf051d))
* **ui-datagrid:** add tab key navigation between cells ([e101191](https://github.com/debba/tabularis/commit/e1011918488319af50a479f957ba11bf8c0ade49))



## [0.8.10](https://github.com/debba/tabularis/compare/v0.8.8...v0.8.10) (2026-02-08)


### Bug Fixes

* **keychain:** log errors to stderr in get_ai_key ([a4ad95a](https://github.com/debba/tabularis/commit/a4ad95ae20ccd9a57d59ca4ca00ba55ab674c6b8))
* **mcp:** update cross-platform directory handling for project paths ([3ae677c](https://github.com/debba/tabularis/commit/3ae677c513591723688398fbc19ed76314bc6fee))
* **modals:** update ModifyColumnModal SQL generation and submission ([e8c9e15](https://github.com/debba/tabularis/commit/e8c9e1506c465d303a5acbb53f8a0542f436c228))


### Features

* **ai:** add delete AI key command and status API ([ce295bd](https://github.com/debba/tabularis/commit/ce295bdae780c9a4f1b6f69837b567de3f13672a))
* **cli:** add debug mode logging flag to enable verbose logging ([5b24e74](https://github.com/debba/tabularis/commit/5b24e7408b8c48879c80bba0503fa09454e6dc92))
* **connection:** add list databases feature for MySQL, PostgreSQL, ([64816a8](https://github.com/debba/tabularis/commit/64816a84640e6bebbe3b79247f3cf2e7b40369a9))
* **custom-openai:** add support for custom OpenAI-compatible API configuration ([3e80a07](https://github.com/debba/tabularis/commit/3e80a07d9bf8324cb3bd659342555fb593c39672))
* **er-diagram:** add configurable default layout setting in schema ([f45ad8f](https://github.com/debba/tabularis/commit/f45ad8f195e9314b6a85426e14113a7abb78c2d5))
* **er-diagram:** add table focus, layout toggle, and context menu ([6f0b997](https://github.com/debba/tabularis/commit/6f0b9971b3ba96c5a49e2916e108add952a6eed6))
* **logger:** add in-memory log capture and log commands for management ([e551749](https://github.com/debba/tabularis/commit/e5517499a27dc6173ae8adcb63702baad446321d))
* **modal:** update driver reset logic in connection form ([0e47969](https://github.com/debba/tabularis/commit/0e4796906775c2756f3b7f0aa9da094ca70ba0e6))
* **pool:** add stable pooling with connection_id for SSH tunnels ([2faf727](https://github.com/debba/tabularis/commit/2faf727431c9b74672a21b33a6747c1096d29e7f))
* **readme:** add OpenAI-compatible APIs section and sync roadmap ([651de87](https://github.com/debba/tabularis/commit/651de87eb44c1b09bd3600b63ea6e235288fc944))
* **routines:** add commands to fetch routines and their details ([a1ab2d2](https://github.com/debba/tabularis/commit/a1ab2d2b1e5f7a35c03e0231976bccbf384fb61f))
* **sidebar:** add refresh tables button ([21c6c6f](https://github.com/debba/tabularis/commit/21c6c6ffa7912456e545410b578eb54200eee0f5))
* **sql:** add identifier escaping helpers for MySQL, Postgres, and ([79f1ac4](https://github.com/debba/tabularis/commit/79f1ac473a7f31997266f776ac010cd92a8484da))
* **tauri:** add debug mode flag with is_debug_mode command ([c814a66](https://github.com/debba/tabularis/commit/c814a66569ab527d7b6d2d16c531e2ec84534f16))
* **tauri:** add devtools commands and auto-open in debug mode ([af698bf](https://github.com/debba/tabularis/commit/af698bf1363b6001554db4ae18f535dcdadfcc42))
* **updater:** add automatic update checking and install support ([0bd16ad](https://github.com/debba/tabularis/commit/0bd16ad719073925dc4663fe839ed5cd0f4145de))
* **view:** add database view management commands and UI components ([48b558d](https://github.com/debba/tabularis/commit/48b558dba1ccc9813a111013f4b123b571c50d60))



## [0.8.9](https://github.com/debba/tabularis/compare/v0.8.8...v0.8.9) (2026-02-06)


### Bug Fixes

* **keychain:** log errors to stderr in get_ai_key ([a4ad95a](https://github.com/debba/tabularis/commit/a4ad95ae20ccd9a57d59ca4ca00ba55ab674c6b8))
* **mcp:** update cross-platform directory handling for project paths ([3ae677c](https://github.com/debba/tabularis/commit/3ae677c513591723688398fbc19ed76314bc6fee))


### Features

* **ai:** add delete AI key command and status API ([ce295bd](https://github.com/debba/tabularis/commit/ce295bdae780c9a4f1b6f69837b567de3f13672a))
* **connection:** add list databases feature for MySQL, PostgreSQL, ([64816a8](https://github.com/debba/tabularis/commit/64816a84640e6bebbe3b79247f3cf2e7b40369a9))
* **custom-openai:** add support for custom OpenAI-compatible API configuration ([3e80a07](https://github.com/debba/tabularis/commit/3e80a07d9bf8324cb3bd659342555fb593c39672))
* **logger:** add in-memory log capture and log commands for management ([e551749](https://github.com/debba/tabularis/commit/e5517499a27dc6173ae8adcb63702baad446321d))
* **modal:** update driver reset logic in connection form ([0e47969](https://github.com/debba/tabularis/commit/0e4796906775c2756f3b7f0aa9da094ca70ba0e6))
* **readme:** add OpenAI-compatible APIs section and sync roadmap ([651de87](https://github.com/debba/tabularis/commit/651de87eb44c1b09bd3600b63ea6e235288fc944))
* **sidebar:** add refresh tables button ([21c6c6f](https://github.com/debba/tabularis/commit/21c6c6ffa7912456e545410b578eb54200eee0f5))
* **tauri:** add debug mode flag with is_debug_mode command ([c814a66](https://github.com/debba/tabularis/commit/c814a66569ab527d7b6d2d16c531e2ec84534f16))
* **updater:** add automatic update checking and install support ([0bd16ad](https://github.com/debba/tabularis/commit/0bd16ad719073925dc4663fe839ed5cd0f4145de))



## [0.8.8](https://github.com/debba/tabularis/compare/v0.8.7...v0.8.8) (2026-02-04)


### Features

* **components:** refactor SSH connections modal logic ([732af14](https://github.com/debba/tabularis/commit/732af14edd7b473ce90452b8a85c6cefd34ab418))
* **database:** add dump and import utilities ([5927e04](https://github.com/debba/tabularis/commit/5927e049248314e8cdd8c79618606c47fb0acca1))
* **datagrid:** add copy row and selected cells functionality ([1159299](https://github.com/debba/tabularis/commit/1159299126a2fb506b55e45028046dfeb29119ed))
* **editor:** add middle-click tab close functionality ([8a08abc](https://github.com/debba/tabularis/commit/8a08abc08881be6b37c9b28932b01e7fa4d89ac3))
* **sidebar:** add accordion, nav item, table item, resize hook, types ([173aa12](https://github.com/debba/tabularis/commit/173aa12a6093eea615f03c67586d1ed6d2a78c65))
* **sidebar:** add responsive actions dropdown for narrow sidebars ([65f166d](https://github.com/debba/tabularis/commit/65f166d8132e6d9025a4c0ed229856d9ac966715))
* **ssh:** add SSH connections management support ([9f0f8be](https://github.com/debba/tabularis/commit/9f0f8be7d1d6c74f2a0bad9ae7092e63fa83a6c1))
* **ssh:** enhance SSH connection credential handling ([6c4f277](https://github.com/debba/tabularis/commit/6c4f277c348c4ec4bb2c0c196f1cfbc6e41578fe))
* **ssh:** improve SSH connection management and validation ([ec12241](https://github.com/debba/tabularis/commit/ec12241e7a97c83b2b150f80bc0f41c41f88921d))
* **ui:** enhance connection modal status feedback ([fc02ce6](https://github.com/debba/tabularis/commit/fc02ce6a2e76f0bde6b97384b2d229085a1d380e))



## [0.8.7](https://github.com/debba/tabularis/compare/v0.8.6...v0.8.7) (2026-02-03)


### Features

* **ai:** add new model entries and centralize API key retrieval ([c0fdeeb](https://github.com/debba/tabularis/commit/c0fdeeba71bdacb1907a174dbe992d8956eb5d88))
* **ai:** add Ollama provider with dynamic model fetching and caching ([fd30ab5](https://github.com/debba/tabularis/commit/fd30ab5a9a32efd5617b2773ab9b1ba4e9872cc0))



## [0.8.6](https://github.com/debba/tabularis/compare/v0.8.5...v0.8.6) (2026-02-02)


### Features

* **ui:** add context menu positioning utils and SQL generator utilities ([9d63a37](https://github.com/debba/tabularis/commit/9d63a371d4ad7c8707801efd620d607cf206a53d))
* **utils:** add settings and theme management utilities ([952d651](https://github.com/debba/tabularis/commit/952d651e74bfb920550210f1f1cea690466387bf))
* **utils:** add visual query SQL generator and table toolbar helpers ([ca44962](https://github.com/debba/tabularis/commit/ca4496219173dd028f54242d8e8d28a71c2b886d))
* **utils:** extract and add testable utility modules with unit tests ([369a9af](https://github.com/debba/tabularis/commit/369a9afad461ae8d456213c2ea6de05c4ee73a47))



## [0.8.5](https://github.com/debba/tabularis/compare/v0.8.4...v0.8.5) (2026-02-01)


### Bug Fixes

* **backend:** prepend app name to ER diagram window title ([c3c652c](https://github.com/debba/tabularis/commit/c3c652cf164042b08fef95dc466be88826406304))
* **sidebar:** add error handling for index deletion and i18n messages ([346adc8](https://github.com/debba/tabularis/commit/346adc8f43479e9767925910f72e220ca6893cd0))


### Features

* **editor:** add apply-to-all toggle for batch updates ([e5e5aa8](https://github.com/debba/tabularis/commit/e5e5aa8bd20ac30e42ef32ebe90b52933416eebb))
* **sidebar:** add Generate SQL modal for tables ([0c077ca](https://github.com/debba/tabularis/commit/0c077caabefe2f0983f29eb829a9456227e65c53))



## [0.8.4](https://github.com/debba/tabularis/compare/v0.8.3...v0.8.4) (2026-02-01)


### Features

* **i18n:** add themeSelection translation key ([43daa61](https://github.com/debba/tabularis/commit/43daa613fa6e64349373a770e715234e0a024fc6))
* **settings:** add configurable font family and size ([7daf6ef](https://github.com/debba/tabularis/commit/7daf6efa792fd44f54d1c42bfc8214c6f8150826))
* **settings:** add font family selection and lazy-loaded fonts ([8a0e61a](https://github.com/debba/tabularis/commit/8a0e61a23b4bb2815eacc25d8f82f25ecf7144b8))
* **settings:** add localization tab and gallery images ([bb00a26](https://github.com/debba/tabularis/commit/bb00a26932f30c92a6d05f7791d7417f5131555e))
* **settings:** improve AI config handling and detection ([b9d0831](https://github.com/debba/tabularis/commit/b9d08315b432550b7f48e16c0d1a3cbd743d1556))
* **theme:** add font settings and ai custom models to app config ([8e849e2](https://github.com/debba/tabularis/commit/8e849e2fa8fe1b56f985c44f4317d0468be18cda))
* **theme:** apply dynamic theme colors to sidebar and settings logos ([cc23fab](https://github.com/debba/tabularis/commit/cc23fabfa3c151b85beacd826ffde13e6e0209d6))
* **theme:** implement theme system with CSS variables and provider ([55f8905](https://github.com/debba/tabularis/commit/55f89058e635dbaefc112ccb39f449a496dc962f))
* **theme:** integrate monaco-themes and add new preset themes ([9154510](https://github.com/debba/tabularis/commit/9154510b627deafb0d9f2f903e90c39e36818920))
* **ui:** add modal styling rules, SqlPreview component and splash ([f74f063](https://github.com/debba/tabularis/commit/f74f063ea49fc84a6bff4c8b648caa26fab736f4))



## [0.8.3](https://github.com/debba/tabularis/compare/v0.8.2...v0.8.3) (2026-01-31)



## [0.8.2](https://github.com/debba/tabularis/compare/v0.8.1...v0.8.2) (2026-01-31)


### Features

* **er-diagram:** add window command and page for schema diagrams ([676b41f](https://github.com/debba/tabularis/commit/676b41f62c1a92f46dcd09905f6a0f8d78a95d4e))
* **schema-diagram:** add refresh UI and encode ER diagram parameters ([61b8b00](https://github.com/debba/tabularis/commit/61b8b00490453c27b277a6e32298b4dfb6320776))
* **schema:** add schema diagram UI with backend snapshot ([72849e8](https://github.com/debba/tabularis/commit/72849e8303f5c0e64517e78380941b16b2f46de4))


### BREAKING CHANGES

* **er-diagram:** remove `schema_diagram` tab type from editor tabs



## [0.8.1](https://github.com/debba/tabularis/compare/v0.8.0...v0.8.1) (2026-01-30)


### Features

* **connections:** add connection loading state ([36a72d2](https://github.com/debba/tabularis/commit/36a72d2cef2cc2596bd9cab9db327c07b1cf0697))
* **editor:** add convert to console action and translations ([c3ad2b2](https://github.com/debba/tabularis/commit/c3ad2b2907cc0438b6df5c5e13545fe00e12bb6c))
* **modal:** add run mode to query params modal ([a8af1c3](https://github.com/debba/tabularis/commit/a8af1c36645edb1a4f80da874dd3858e3de2bd9a))
* **query:** add parameterized query support ([9fd2fbc](https://github.com/debba/tabularis/commit/9fd2fbccc847b7b85cd604880526718eaf97744d))
* **sql:** preserve ORDER BY clause during pagination ([a963c28](https://github.com/debba/tabularis/commit/a963c28b89a3ae68b194e26bddedfb873eade2e1))
* **ui:** add column sorting in DataGrid ([896658c](https://github.com/debba/tabularis/commit/896658c76f13a21769a5574ae990097aac17f9db))
* **ui:** add virtualized data grid and SQL editor wrapper ([30a9099](https://github.com/debba/tabularis/commit/30a9099dbe48d608972c33b2c9c7ea7a4bbc2814))
* **ui:** enhance table interaction with click and double-click actions ([eccc881](https://github.com/debba/tabularis/commit/eccc881cd5425b1acf22a38aaa4d483d40b325da))



# [0.8.0](https://github.com/debba/tabularis/compare/v0.7.1...v0.8.0) (2026-01-29)


### Features

* **ai:** add AI integration with backend, settings UI, and docs ([0ff1899](https://github.com/debba/tabularis/commit/0ff1899ab502327faaf279f511d824aaa4d8f7b6))
* **ai:** add AI query generation and explanation support ([370f1e8](https://github.com/debba/tabularis/commit/370f1e846c5a98ed2b49c7b963761ce440ce3d46))
* **ai:** add dynamic model loading with fallback and experimental flag ([702103e](https://github.com/debba/tabularis/commit/702103efd253b0f5f851fed2054a885f1fb0cf80))
* **drivers:** add table sorting for all database types ([beb8abc](https://github.com/debba/tabularis/commit/beb8abc095d9729eedd7da24d6235657ab78874d))
* **editor:** add DataGrip‑style SQL autocomplete and enable word wrap ([fb1d252](https://github.com/debba/tabularis/commit/fb1d252adec6a36e2abd1c3a9ec756820a5382fd))
* **export:** add query result export to CSV and JSON ([e283aa1](https://github.com/debba/tabularis/commit/e283aa14fc310343fe6f8aae5320dfd83e787bc8))
* **mcp:** add MCP server integration with UI and config handling ([8d61571](https://github.com/debba/tabularis/commit/8d615714966801d39d3e074c0ee831d2ca6e525a))
* **mcp:** add name support for connection resolution ([f01d685](https://github.com/debba/tabularis/commit/f01d68512c8227c06a1de97bb928c2532e87b8af))



## [0.7.1](https://github.com/debba/tabularis/compare/v0.7.0...v0.7.1) (2026-01-29)


### Bug Fixes

* **editor:** clear pending state when running query ([fe3354b](https://github.com/debba/tabularis/commit/fe3354b98d70475e776c7ea201fc3576dec17b68))


### Features

* **database:** implement connection pool manager ([8ea4278](https://github.com/debba/tabularis/commit/8ea4278bebfd4b3fcc83da014fa48651c06c0145))
* **table-view:** enhance filtering with dynamic placeholders and limit ([cfc5f53](https://github.com/debba/tabularis/commit/cfc5f531aca00a7b699e9f4c7e6d5eaee58bd7a0))
* **ui:** enhance table view with full-screen mode and filters ([b528821](https://github.com/debba/tabularis/commit/b528821b6806802178c4c1faff076936977b7ec3))



# [0.7.0](https://github.com/debba/tabularis/compare/v0.6.1...v0.7.0) (2026-01-29)


### Features

* **data-grid:** improve table extraction and cell rendering ([fd21915](https://github.com/debba/tabularis/commit/fd21915983ddfb85b40a4d432c4cccea8c551ee0))
* **drivers:** enhance multi-database decimal and null value handling ([4d49f66](https://github.com/debba/tabularis/commit/4d49f66eb407f8b9b59d11efc645655d16bf7a95))
* **drivers:** improve datetime parsing and formatting ([74c394b](https://github.com/debba/tabularis/commit/74c394b8ae1852bba70f60bbdee7665d1b066b99))
* **editor:** improve query execution loading state ([d1decc1](https://github.com/debba/tabularis/commit/d1decc1f46d79bc4b557c8b80d10191890e2610a))
* **settings:** fix external links by using opener plugin ([11acdb5](https://github.com/debba/tabularis/commit/11acdb520aa7e93f9eb04f8f824e6c0e3a87ceeb))
* **ui:** implement batch editing with pending changes and deletions ([cb6aecb](https://github.com/debba/tabularis/commit/cb6aecb319a857d7e300bd50f378ffa2bdd9472d))
* **website:** add landing page and sync version handling ([471bf68](https://github.com/debba/tabularis/commit/471bf682ac06a0882a26f296b2e4101bf45c1b18))



## [0.6.1](https://github.com/debba/debba.sql/compare/v0.6.0...v0.6.1) (2026-01-28)


### Features

* **version:** add APP_VERSION export and sync script ([54aeaa6](https://github.com/debba/debba.sql/commit/54aeaa6274cc9e906b016b24ffd91ef38881e129))



# [0.6.0](https://github.com/debba/debba.sql/compare/v0.5.0...v0.6.0) (2026-01-28)


### Features

* **i18n:** add internationalization support and bump version to 0.6.0 ([e1cab12](https://github.com/debba/debba.sql/commit/e1cab1255165c8133d929cc075c08900fc7a3067))
* **security:** integrate system keychain for connection passwords ([ab284b5](https://github.com/debba/debba.sql/commit/ab284b52d7fc204c4551ec66c5cd8c34c404ca81))
* **window:** add Wayland window title workaround for Linux ([c09ae72](https://github.com/debba/debba.sql/commit/c09ae7261ed88f3924a84e3e8b00f470176f07af))



# [0.5.0](https://github.com/debba/debba.sql/compare/v0.4.0...v0.5.0) (2026-01-27)


### Bug Fixes

* restore pagination controls and fix truncated flag scope ([1bdf104](https://github.com/debba/debba.sql/commit/1bdf104c37c057f183ed9f37f97abd40b31fbd66))


### Features

* release v0.5.0 - Advanced Schema Management & UX Improvements ([f2d7d1c](https://github.com/debba/debba.sql/commit/f2d7d1c841ef6a0d62b22e8ec27bef8ef845113e))
* **schema:** add foreign key, index structs and: column edit UI ([c20c550](https://github.com/debba/debba.sql/commit/c20c550c3661bcc8dd0dbb09e02149fdf92ccaef))
* **sidebar:** add column explorer with delete action ([b25cd50](https://github.com/debba/debba.sql/commit/b25cd508aef8d58f0894976068d9ee5621f69e9a))
* **ui:** add multi-row selection and select-all column to DataGrid ([66ddfaa](https://github.com/debba/debba.sql/commit/66ddfaa86c01dc73c452bb04d2608cfdc640c07a))



# [0.4.0](https://github.com/debba/debba.sql/compare/v0.3.0...v0.4.0) (2026-01-27)


### Features

* **ci:** add readme downloads workflow ([d48ef6b](https://github.com/debba/debba.sql/commit/d48ef6bb77e9a654b8081080eb0f40756dcef280))
* **editor:** add DataGrip-style multiple query tabs with isolation ([688739a](https://github.com/debba/debba.sql/commit/688739aac8eb995e1329943ef43e290d8b503f8d))
* **visual-query-builder:** add delete table node UI and auto GROUP BY ([0f1f9be](https://github.com/debba/debba.sql/commit/0f1f9bebd9143f9d155c0790628acf199cd79e24))
* **visual-query-builder:** add visual query builder UI ([f97b67a](https://github.com/debba/debba.sql/commit/f97b67a459dd3d7e4465622c2702bbfdd1439e99))



# [0.3.0](https://github.com/debba/debba.sql/compare/v0.2.0...v0.3.0) (2026-01-27)


### Features

* **connection:** add duplicate connection command and clone button ([4e00382](https://github.com/debba/debba.sql/commit/4e003828a491c18a2d348a6efcc86ccfffcadcc2))



# [0.2.0](https://github.com/debba/debba.sql/compare/3a9fc495d44cdd907d5f561a73d5734d0ccb0590...v0.2.0) (2026-01-27)


### Bug Fixes

* **drivers:** support additional numeric types and correct row mapping ([0769f3b](https://github.com/debba/debba.sql/commit/0769f3b4ed38fe2a531ff9ac7b6affed70af75b2))


### Features

* add query cancellation, sanitization, and multi‑statement support ([403956a](https://github.com/debba/debba.sql/commit/403956ab596a3808d9fcb65358bcbaf857cba1ed))
* **connections:** add error handling UI and propagate connection errors ([3494021](https://github.com/debba/debba.sql/commit/34940210025808434ea7c333263714792ae03b02))
* **editor:** add run dropdown and dynamic window title ([99b3d1c](https://github.com/debba/debba.sql/commit/99b3d1c3fba7b424533a4ebad4629d5bec1c5484))
* **pagination:** implement server‑side pagination and UI controls ([f50b110](https://github.com/debba/debba.sql/commit/f50b11001ac1eb82d310fcb23bc51c50881a9b52))
* **saved-queries:** add saved queries support ([9839737](https://github.com/debba/debba.sql/commit/9839737fc2d532e4e139226fc5e331f722ba57de))
* **settings:** implement query limit UI and backend streaming support ([9fd89f3](https://github.com/debba/debba.sql/commit/9fd89f3c3b3538b0d09fe8324e89ba4172339100))
* **ssh:** add SSH tunnel support with connection edit/delete UI ([3a9fc49](https://github.com/debba/debba.sql/commit/3a9fc495d44cdd907d5f561a73d5734d0ccb0590))
* **ssh:** add system SSH backend and URL encoding for DB URLs ([5e93ea3](https://github.com/debba/debba.sql/commit/5e93ea38f1a74966ab1a41f5ddda4e8cb13bb23c))



