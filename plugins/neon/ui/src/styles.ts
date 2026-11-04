export const styles = `
.neon-panel {display:flex;flex:1;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden;color:var(--text-primary);font:inherit;container-type:inline-size}
.neon-view {min-width:0;max-width:1100px;margin:0 auto}
.neon-toolbar {display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:0 0 12px;margin-bottom:16px;border-bottom:1px solid var(--border-default)}
.neon-panel .neon-description {margin:0;color:var(--text-secondary);font-size:12px;line-height:1.65;max-width:76ch}
.neon-toolbar .neon-description {margin-bottom:5px}
.neon-section {min-width:0;margin:0 0 22px}
.neon-section-header {display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px;min-width:0}
.neon-section-header > div:first-child {min-width:0}
.neon-section-header h3 {margin:0;font-size:13px;font-weight:600;line-height:1.5;color:var(--text-primary)}
.neon-panel .neon-hint {margin:6px 0 0;color:var(--text-muted);font-size:12px;line-height:1.65;max-width:76ch}
.neon-count {color:var(--text-secondary);font-size:11px;white-space:nowrap}
.neon-summary-strip {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px;padding:2px 0 18px;margin:0 0 20px;border-bottom:1px solid var(--border-default)}
.neon-summary-strip > div {min-width:0}
.neon-summary-strip dt {font-size:11px;color:var(--text-muted);margin-bottom:5px}
.neon-summary-strip dd {font-size:14px;font-weight:600;color:var(--text-primary);margin:0;overflow-wrap:anywhere}
.neon-summary-strip code {font-family:var(--font-mono);font-size:13px;font-weight:500}
.neon-service-list {border-top:1px solid var(--border-default)}
.neon-service {display:flex;align-items:center;gap:12px;min-height:58px;padding:10px 0;border-bottom:1px solid var(--border-default)}
.neon-service-name {flex:1;min-width:0}
.neon-service-name strong {display:block;font-size:12px;font-weight:500;color:var(--text-primary)}
.neon-service-name > span {display:block;font-size:11px;color:var(--text-muted);margin-top:2px}
.neon-status-dot {display:inline-block;flex-shrink:0;width:6px;height:6px;border-radius:50%;background:var(--text-muted)}
.neon-status-dot.is-configured {background:var(--accent-success)}
.neon-status-dot.is-missing {background:var(--accent-warning)}
.neon-status {display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border-default);border-radius:var(--radius-sm);padding:2px 6px;white-space:nowrap;color:var(--text-secondary);font-size:10px;font-weight:500;line-height:1.5}
.neon-status.is-configured {color:var(--accent-success)}
.neon-status.is-missing {color:var(--accent-warning)}
.neon-panel .neon-disclosure {padding:10px 0;border-top:1px solid var(--border-default);font-size:12px}
.neon-panel .neon-disclosure summary {cursor:pointer;color:var(--text-secondary);font-size:12px;padding:3px 0;user-select:none}
.neon-disclosure[open] > summary {margin-bottom:10px;color:var(--text-primary)}
.neon-meta-list {margin:0;padding:0;min-width:0}
.neon-meta-list > div {display:grid;grid-template-columns:120px minmax(0,1fr);gap:16px;margin:0;padding:10px 0;border-bottom:1px solid var(--border-default);font-size:12px}
.neon-meta-list dt {color:var(--text-muted)}
.neon-meta-list dd {margin:0;min-width:0;color:var(--text-secondary);overflow-wrap:anywhere;line-height:1.5}
.neon-meta-list code {font-family:var(--font-mono);font-size:11px}
.neon-data-view {display:flex;flex-direction:column;height:100%;min-height:0;gap:0}
.neon-data-view .neon-toolbar {flex-shrink:0;margin-bottom:10px}
.neon-data-region {flex:1;min-height:160px;min-width:0}
.neon-result-count {flex-shrink:0;margin:8px 0 0;color:var(--text-muted);font-size:11px}
.neon-workbench {display:grid;grid-template-columns:minmax(0,1.15fr) minmax(280px,1fr);gap:28px;min-width:0;align-items:start}
.neon-workbench-balanced {grid-template-columns:repeat(2,minmax(0,1fr))}
.neon-workbench-settings {grid-template-columns:minmax(0,1.1fr) minmax(260px,.9fr)}
.neon-workbench > * {min-width:0}
.neon-filterbar,.neon-actionbar,.neon-inline-actions {display:flex;align-items:center;gap:8px;min-width:0}
.neon-filterbar {align-items:flex-end;margin-bottom:12px}
.neon-actionbar {justify-content:space-between;flex-wrap:wrap;margin-top:12px}
.neon-inline-actions {flex-wrap:wrap}
.neon-grow {flex:1;min-width:0}
.neon-row {display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0}
.neon-panel .neon-button,.neon-settings-action {display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:32px;padding:6px 11px;border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);background:var(--bg-input);font:inherit;font-size:12px;white-space:nowrap;cursor:pointer;flex-shrink:0}
.neon-panel .neon-button:enabled:hover,.neon-settings-action:hover {background:var(--surface-hover)}
.neon-panel .neon-button:disabled,.neon-settings-action:disabled {opacity:.5;cursor:default}
.neon-panel .neon-link:focus-visible,.neon-panel .neon-button:focus-visible,.neon-panel .neon-field:focus-visible,.neon-settings-action:focus-visible,.neon-disclosure summary:focus-visible,.neon-account-check input:focus-visible {outline:2px solid var(--border-focus);outline-offset:2px}
.neon-panel .neon-button-primary {background:var(--accent-primary);color:var(--text-inverse);border-color:transparent}
.neon-panel .neon-button-primary:enabled:hover {background:var(--accent-primary);filter:brightness(1.08)}
.neon-panel .neon-button-danger {color:var(--accent-error)}
.neon-panel .neon-button-quiet {border-color:transparent;background:transparent;color:var(--text-secondary)}
.neon-panel .neon-button-quiet:hover {background:var(--surface-hover);color:var(--text-primary)}
.neon-panel .neon-link {background:none;border:0;color:var(--text-accent);padding:3px 0;text-align:left;overflow-wrap:anywhere;font:inherit;font-size:12px;cursor:pointer}
.neon-panel .neon-empty,.neon-panel .neon-feedback {padding:8px 10px;background:var(--bg-base);border:1px solid var(--border-default);border-radius:var(--radius-sm);margin:10px 0;font-size:12px;color:var(--text-secondary);overflow-wrap:anywhere}
.neon-panel .neon-error,.neon-error {color:var(--accent-error)}
.neon-panel .neon-success {color:var(--accent-success);font-size:12px;margin:10px 0}
.neon-panel .neon-result-placeholder {display:flex;align-items:center;justify-content:center;min-height:150px;padding:24px;border:1px dashed var(--border-default);border-radius:var(--radius-sm);background:var(--bg-base);color:var(--text-muted);font-size:12px;line-height:1.6;text-align:center}
.neon-panel .neon-field-label {display:block;margin:12px 0 5px;color:var(--text-secondary);font-size:12px}
.neon-panel .neon-field {display:block;box-sizing:border-box;width:100%;min-width:0;min-height:32px;padding:7px 9px;border:1px solid var(--border-default);background:var(--bg-input);border-radius:var(--radius-sm);color:var(--text-primary);font:inherit;font-size:12px}
.neon-panel .neon-field:disabled {opacity:.6}
.neon-panel .neon-field-compact {width:auto;max-width:100%;min-height:30px;padding:4px 8px}
.neon-editor-tools {display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.neon-editor-tools label {font-size:11px;color:var(--text-muted)}
.neon-panel .neon-actions-sticky {position:sticky;bottom:-12px;z-index:2;background:var(--bg-elevated);padding:10px 0;border-top:1px solid var(--border-default);gap:8px;justify-content:flex-end}
.neon-pending {display:flex;align-items:center;gap:8px}
.neon-pending::before {content:'';width:10px;height:10px;flex-shrink:0;border:2px solid var(--border-default);border-top-color:var(--accent-primary);border-radius:50%;animation:neon-loading .8s linear infinite}
@keyframes neon-loading {to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.neon-pending::before{animation:none}}
.neon-panel .neon-feedback.neon-error {border-left:3px solid var(--accent-error)}
.neon-panel .neon-success {display:block;border-left:3px solid var(--accent-success);padding:7px 10px;background:var(--bg-base);line-height:1.6}

.neon-panel textarea.neon-field {resize:vertical;min-height:80px;font-family:var(--font-mono);line-height:1.65}
.neon-panel .neon-editor {tab-size:2}
.neon-panel .neon-prompt {min-height:220px}
.neon-panel .neon-query {min-height:145px}
.neon-panel .neon-secret {min-height:190px;-webkit-text-security:disc}
.neon-panel .neon-columns {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.neon-panel .neon-output {white-space:pre-wrap;overflow-wrap:anywhere;max-height:360px;overflow:auto;padding:14px;border:1px solid var(--border-default);border-radius:var(--radius-sm);background:var(--bg-base);font-family:var(--font-mono);font-size:12px;line-height:1.7;margin:0}
.neon-panel .neon-answer {font-family:inherit;line-height:1.75;min-height:150px}
.neon-panel .neon-muted-code {display:block;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);font-size:10px;font-family:var(--font-mono)}
.neon-panel .neon-fields {display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
.neon-panel .neon-code {font-family:var(--font-mono);font-size:11px;background:var(--bg-input);padding:2px 4px;border-radius:var(--radius-sm);overflow-wrap:anywhere}
.neon-panel .neon-small {font-size:12px;color:var(--text-secondary)}
.neon-panel .neon-confirmation {margin:12px 0;padding:12px;border:1px solid var(--accent-warning);border-radius:var(--radius-sm);background:var(--bg-base);font-size:12px}
.neon-confirmation p {margin:0 0 10px;line-height:1.6;color:var(--text-secondary);overflow-wrap:anywhere}
.neon-field-list {list-style:none;padding:0;margin:0}
.neon-field-list li {display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border-default);color:var(--text-secondary);font-size:11px;min-width:0}
.neon-field-list code {font-family:var(--font-mono);overflow-wrap:anywhere}
.neon-account {padding:20px;height:auto;min-height:100%;overflow:visible;box-sizing:border-box}
.neon-account > h3 {margin:0 0 10px;font-size:14px}
.neon-account-form {display:grid;gap:16px;margin-top:20px}
.neon-account-form .neon-columns {gap:16px}
.neon-account-form .neon-field-label {margin:0 0 7px;font-weight:500}
.neon-account-actions {display:flex;justify-content:space-between;align-items:center;gap:12px;padding-top:16px;margin-top:20px;border-top:1px solid var(--border-default)}
.neon-account-actions .neon-button {min-height:36px;padding:8px 14px}
.neon-account-connected {display:flex;align-items:center;justify-content:space-between;gap:12px;margin:16px 0 4px;padding:10px 0;border-top:1px solid var(--border-default);border-bottom:1px solid var(--border-default)}
.neon-account-service-warning {display:block;margin-top:4px;font-size:11px;color:var(--text-muted);line-height:1.5;overflow-wrap:anywhere}
.neon-account .neon-account-subtitle {font-size:12px;margin:20px 0 8px}
.neon-account-check {display:flex;align-items:flex-start;gap:8px;margin-top:18px;font-size:12px;color:var(--text-primary);line-height:1.5}
.neon-account-check input {margin-top:3px;accent-color:var(--accent-primary);flex-shrink:0}
.neon-account-warnings {font-size:12px;color:var(--text-secondary);line-height:1.6;padding-left:20px;margin:16px 0}
.neon-provider-intro {padding:18px 20px;border-bottom:1px solid var(--border-default);color:var(--text-primary)}
.neon-provider-intro h3 {font-size:14px;margin:0;font-weight:600}
.neon-provider-intro p {font-size:12px;line-height:1.6;color:var(--text-secondary);margin:10px 0}
.neon-provider-features {display:flex;flex-wrap:wrap;gap:6px 18px;list-style:none;margin:12px 0 0;padding:0;font-size:11px;color:var(--text-secondary)}
.neon-provider-features li {border-left:2px solid var(--accent-primary);padding-left:8px}
.neon-existing-connection {padding:20px;height:auto;overflow:visible;box-sizing:border-box}
.neon-existing-connection h3 {font-size:13px;margin:0 0 10px}
.neon-account .neon-inline-actions {margin-top:20px}
.neon-connect-action {display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:8px 12px;border:1px solid var(--border-strong);border-radius:var(--radius-lg);background:var(--bg-elevated);color:var(--text-primary);font:inherit;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}
.neon-connect-action:hover {background:var(--surface-hover);border-color:var(--accent-primary)}
.neon-connect-action:focus-visible {outline:2px solid var(--border-focus);outline-offset:2px}
.neon-authentication {margin-top:16px;min-width:0}
.neon-auth-option {border:1px solid var(--border-default);border-radius:var(--radius-sm);padding:14px;background:var(--bg-elevated)}
.neon-auth-title {margin:0 0 8px;font-size:13px;font-weight:600}
.neon-auth-key-toggle {margin:10px 0}
.neon-auth-install {padding-top:8px;border-top:1px solid var(--border-default)}
.neon-auth-command {margin:10px 0;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;font-family:var(--font-mono);font-size:12px;color:var(--text-primary)}
.neon-branch-picker {min-width:0;color:var(--text-secondary);font-size:12px}
.neon-branch-project {display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--text-muted);margin-bottom:5px}
.neon-branch-picker-row {display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px}
.neon-branch-picker-row > button {min-width:0;min-height:30px;border:1px solid var(--border-default);background:var(--bg-input);color:var(--text-primary);border-radius:var(--radius-sm);font:inherit;padding:4px 7px;cursor:pointer}
.neon-branch-picker-row > button:focus-visible {outline:2px solid var(--border-focus);outline-offset:2px}
.neon-branch-picker-row [role="combobox"],.neon-compact-select [role="combobox"] {min-height:30px;padding:4px 28px 4px 8px;font-size:12px}
.neon-compact-select {min-width:150px;max-width:100%}
.neon-branch-picker [role="alert"] {display:block;overflow-wrap:anywhere;margin-top:6px;font-size:11px}
.neon-branches-layout {grid-template-columns:minmax(220px,.8fr) minmax(0,1.4fr)}
.neon-usage {min-width:0}
.neon-usage .neon-hint {overflow-wrap:anywhere}
.neon-usage-summary {margin:16px 0 10px;padding-bottom:14px;gap:14px}
.neon-usage-limit {--usage-tone:var(--text-accent);padding:14px 0;border-bottom:1px solid var(--border-default);min-width:0}
.neon-usage-limit[data-tone="warning"] {--usage-tone:var(--accent-warning)}
.neon-usage-limit[data-tone="exceeded"] {--usage-tone:var(--accent-error)}
.neon-usage-limit h4 {margin:0;font-size:12px;font-weight:600;color:var(--text-primary)}
.neon-usage-limit .neon-section-header {margin-bottom:8px}
.neon-usage-values {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0}
.neon-usage-values dt {font-size:11px;color:var(--text-muted);margin-bottom:4px}
.neon-usage-values dd {margin:0;font-size:12px;color:var(--text-primary);overflow-wrap:anywhere}
.neon-usage-meter {height:4px;margin-top:12px;border-radius:var(--radius-sm);background:var(--surface-secondary);overflow:hidden}
.neon-usage-meter > span {display:block;height:100%;background:var(--usage-tone)}
.neon-panel .neon-usage-warning {color:var(--accent-warning);border-left:3px solid var(--accent-warning)}
.neon-usage-table {overflow:auto;max-width:100%;margin-top:12px;border:1px solid var(--border-default);border-radius:var(--radius-sm)}
.neon-usage-table table {border-collapse:collapse;width:100%;font-size:12px}
.neon-usage-table th,.neon-usage-table td {padding:9px 10px;text-align:left;border-bottom:1px solid var(--border-default);color:var(--text-primary)}
.neon-usage-table thead th {background:var(--bg-base);color:var(--text-secondary);font-size:11px;font-weight:500;white-space:nowrap}
.neon-usage-table tbody th {font-weight:500;min-width:150px}
.neon-usage-table td {min-width:85px;white-space:nowrap}
.neon-usage-table small {display:block;color:var(--text-muted);font-size:10px;font-weight:400;margin-top:3px}
@container(max-width:740px){.neon-workbench,.neon-workbench-balanced,.neon-workbench-settings{grid-template-columns:minmax(0,1fr);gap:18px}.neon-service{gap:8px}.neon-service-name > span{max-width:42ch}.neon-toolbar{gap:10px}.neon-status{font-size:10px}}
@container(max-width:540px){.neon-panel .neon-columns{grid-template-columns:minmax(0,1fr)}.neon-toolbar > .neon-description{flex-basis:100%}.neon-section-header > .neon-inline-actions{width:100%}.neon-panel .neon-auth-metadata{grid-template-columns:minmax(0,1fr);gap:4px}.neon-auth-metadata dd{margin-bottom:10px}}
@container(max-width:400px){.neon-summary-strip{grid-template-columns:minmax(0,1fr);gap:10px}.neon-summary-strip > div{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.neon-summary-strip dt{margin:0}.neon-summary-strip dd{font-size:12px}.neon-service-name > span{display:none}.neon-meta-list > div{grid-template-columns:minmax(0,1fr);gap:4px}.neon-data-region{min-height:160px}}
`;
