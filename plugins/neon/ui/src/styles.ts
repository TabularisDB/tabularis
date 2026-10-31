export const styles = `
.neon-panel {font-family:inherit;font-size:13px;line-height:1.5;color:var(--text-primary);display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden;isolation:isolate;background:var(--bg-elevated)}
.neon-panel * {box-sizing:border-box}
.neon-error {color:var(--accent-error)}
.neon-panel :focus-visible {outline:2px solid var(--border-focus);outline-offset:3px}
.neon-panel [data-workspace-content] button,.neon-panel input,.neon-panel textarea,.neon-panel select {font:inherit}
.neon-panel button {cursor:pointer}
.neon-panel button:disabled {opacity:.5;cursor:default}
.neon-panel h3 {margin:0 0 5px;font-size:16px;font-weight:600}
.neon-panel [data-workspace-content] p {margin:0 0 16px;color:var(--text-secondary);max-width:76ch}
.neon-panel .neon-row {display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0}
.neon-panel .neon-button {padding:7px 12px;border:1px solid var(--border-default);border-radius:var(--radius-base);color:var(--text-primary);background:var(--bg-input);font-weight:500;font-size:12px}
.neon-panel .neon-button-primary {background:var(--accent-primary);color:var(--text-inverse);border-color:transparent}
.neon-panel .neon-button-danger {color:var(--accent-error)}
.neon-panel .neon-link {background:none;border:0;color:var(--accent-primary);padding:0;font-size:12px}
.neon-panel .neon-grid {max-width:100%;overflow-x:auto;border:1px solid var(--border-default);border-radius:var(--radius-base);margin:12px 0}
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
.neon-panel .neon-columns {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.neon-panel .neon-output {white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;padding:14px;border:1px solid var(--border-default);border-radius:var(--radius-base);background:var(--bg-base);font-size:12px}
.neon-panel .neon-fields {display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}
.neon-panel code {font-family:var(--font-mono);font-size:11px;background:var(--bg-input);padding:3px 6px;border-radius:var(--radius-sm);overflow-wrap:anywhere}
.neon-panel .neon-small {font-size:12px;color:var(--text-secondary)}
@media(max-width:650px){
.neon-panel .neon-columns{grid-template-columns:minmax(0,1fr)}
}
`;
