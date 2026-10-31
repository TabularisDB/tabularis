export const styles = `
.neon-launch {display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;background:transparent;color:var(--text-secondary);border:1px solid var(--border-default);border-radius:var(--radius-base);font:inherit;font-size:12px;cursor:pointer}
.neon-launch:hover {color:var(--text-primary);background:var(--bg-input)}
.neon-launch svg {color:var(--accent-primary);flex-shrink:0}
.neon-panel {font-family:inherit;font-size:13px;line-height:1.5;color:var(--text-primary);min-width:0;background:var(--bg-elevated)}
.neon-panel * {box-sizing:border-box}
.neon-panel button,.neon-panel input,.neon-panel textarea,.neon-panel select {font:inherit}
.neon-panel button {cursor:pointer}
.neon-panel button:disabled {opacity:.5;cursor:default}
.neon-panel :focus-visible,.neon-launch:focus-visible {outline:2px solid var(--border-focus);outline-offset:3px}
.neon-panel .neon-head {display:flex;justify-content:space-between;align-items:flex-start;gap:18px;padding:16px 20px;border-bottom:1px solid var(--border-default);background:var(--bg-base)}
.neon-panel .neon-head p {margin:3px 0 0;color:var(--text-secondary);font-size:12px;overflow-wrap:anywhere}
.neon-panel .neon-head strong {font-size:15px;font-weight:600}
.neon-panel .neon-shell {display:grid;grid-template-columns:160px minmax(0,1fr);min-height:420px;max-height:65vh}
.neon-panel .neon-nav {padding:12px 8px;background:var(--bg-base);border-right:1px solid var(--border-default);overflow-y:auto}
.neon-panel .neon-nav button {display:block;text-align:left;width:100%;padding:9px 12px;border:0;border-radius:var(--radius-base);background:transparent;color:var(--text-secondary);font-size:12px}
.neon-panel .neon-nav button[aria-selected=true] {background:var(--bg-input);color:var(--text-primary);box-shadow:inset 3px 0 var(--accent-primary);font-weight:600}
.neon-panel .neon-main {padding:22px;overflow:auto;min-width:0}
.neon-panel h3 {margin:0 0 5px;font-size:16px;font-weight:600}
.neon-panel p {margin:0 0 16px;color:var(--text-secondary);max-width:76ch}
.neon-panel .neon-row {display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0}
.neon-panel .neon-button {padding:7px 12px;border:1px solid var(--border-default);border-radius:var(--radius-base);color:var(--text-primary);background:var(--bg-input);font-weight:500;font-size:12px}
.neon-panel .neon-button-primary {background:var(--accent-primary);color:var(--text-inverse);border-color:transparent}
.neon-panel .neon-button-danger {color:var(--accent-error)}
.neon-panel .neon-link {background:none;border:0;color:var(--accent-primary);padding:0;font-size:12px}
.neon-panel .neon-grid {overflow:auto;max-height:340px;border:1px solid var(--border-default);border-radius:var(--radius-base);margin:12px 0}
.neon-panel table {border-collapse:collapse;width:100%;font-size:12px;text-align:left;white-space:nowrap}
.neon-panel th {position:sticky;top:0;background:var(--bg-base);color:var(--text-secondary);font-weight:500}
.neon-panel th,.neon-panel td {padding:9px 12px;border-bottom:1px solid var(--border-default);max-width:400px;overflow:hidden;text-overflow:ellipsis}
.neon-panel tbody tr:last-child td {border-bottom:0}
.neon-panel .neon-empty,.neon-panel .neon-feedback {padding:12px 14px;background:var(--bg-base);border:1px solid var(--border-default);border-radius:var(--radius-base);margin:12px 0;color:var(--text-secondary);overflow-wrap:anywhere}
.neon-panel .neon-error {color:var(--accent-error)}
.neon-panel .neon-ok {color:var(--accent-success)}
.neon-panel .neon-service {display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid var(--border-default)}
.neon-panel .neon-service span:last-child {font-size:12px;color:var(--text-secondary)}
.neon-panel label {display:block;margin:14px 0 6px;color:var(--text-secondary);font-size:12px}
.neon-panel input,.neon-panel textarea,.neon-panel select {display:block;width:100%;padding:9px 10px;border:1px solid var(--border-default);background:var(--bg-input);border-radius:var(--radius-base);color:var(--text-primary);min-width:0}
.neon-panel textarea {resize:vertical;min-height:90px;font-family:var(--font-mono);font-size:12px}
.neon-panel .neon-secret {min-height:140px;-webkit-text-security:disc}
.neon-panel .neon-columns {display:grid;grid-template-columns:1fr 1fr;gap:14px}
.neon-panel .neon-output {white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;padding:14px;border:1px solid var(--border-default);border-radius:var(--radius-base);background:var(--bg-base);font-size:12px}
.neon-panel .neon-fields {display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}
.neon-panel code {font-family:var(--font-mono);font-size:11px;background:var(--bg-input);padding:3px 6px;border-radius:var(--radius-sm);overflow-wrap:anywhere}
.neon-panel .neon-small {font-size:12px;color:var(--text-secondary)}
@media(max-width:650px){.neon-panel .neon-shell{grid-template-columns:1fr;max-height:70vh}.neon-panel .neon-nav{display:flex;overflow-x:auto;gap:3px;border-right:0;border-bottom:1px solid var(--border-default)}.neon-panel .neon-nav button{white-space:nowrap;width:auto}.neon-panel .neon-main{padding:16px}.neon-panel .neon-columns{grid-template-columns:1fr}.neon-panel .neon-head{padding:14px 16px}}
`;
