export const styles = `
.neon-panel {display:flex;flex:1;flex-direction:column;height:100%;min-height:0;min-width:0;overflow:hidden;color:var(--text-primary);font:inherit}
.neon-error {color:var(--accent-error)}
.neon-panel .neon-description {margin:0 0 12px;color:var(--text-secondary);font-size:12px;line-height:1.5;max-width:76ch}
.neon-panel .neon-row {display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0}
.neon-panel .neon-button,.neon-settings-action {display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:28px;padding:4px 10px;border:1px solid var(--border-default);border-radius:var(--radius-sm);color:var(--text-primary);background:var(--bg-input);font:inherit;font-size:12px;cursor:pointer}
.neon-panel .neon-button:hover,.neon-settings-action:hover {background:var(--surface-hover)}
.neon-panel .neon-button:disabled,.neon-settings-action:disabled {opacity:.5;cursor:default}
.neon-panel .neon-button:focus-visible,.neon-panel .neon-field:focus-visible,.neon-settings-action:focus-visible {outline:2px solid var(--border-focus);outline-offset:2px}
.neon-panel .neon-button-primary {background:var(--accent-primary);color:var(--text-inverse);border-color:transparent}
.neon-panel .neon-button-danger {color:var(--accent-error)}
.neon-panel .neon-link {background:none;border:0;color:var(--text-accent);padding:0;font:inherit;font-size:12px;cursor:pointer}
.neon-panel .neon-empty,.neon-panel .neon-feedback {padding:8px 10px;background:var(--bg-base);border:1px solid var(--border-default);border-radius:var(--radius-sm);margin:10px 0;font-size:12px;color:var(--text-secondary);overflow-wrap:anywhere}
.neon-panel .neon-error {color:var(--accent-error)}
.neon-panel .neon-ok {color:var(--accent-success)}
.neon-panel .neon-service {display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-default);font-size:12px}
.neon-panel .neon-service span:last-child {color:var(--text-secondary)}
.neon-panel .neon-field-label {display:block;margin:12px 0 4px;color:var(--text-secondary);font-size:12px}
.neon-panel .neon-field {display:block;box-sizing:border-box;width:100%;min-width:0;padding:6px 8px;border:1px solid var(--border-default);background:var(--bg-input);border-radius:var(--radius-sm);color:var(--text-primary);font:inherit;font-size:12px}
.neon-panel textarea.neon-field {resize:vertical;min-height:80px;font-family:var(--font-mono)}
.neon-panel .neon-secret {min-height:140px;-webkit-text-security:disc}
.neon-panel .neon-columns {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.neon-panel .neon-output {white-space:pre-wrap;overflow-wrap:anywhere;max-height:300px;overflow:auto;padding:10px;border:1px solid var(--border-default);border-radius:var(--radius-sm);background:var(--bg-base);font-size:12px}
.neon-panel .neon-fields {display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
.neon-panel .neon-code {font-family:var(--font-mono);font-size:11px;background:var(--bg-input);padding:2px 4px;border-radius:var(--radius-sm);overflow-wrap:anywhere}
.neon-panel .neon-small {font-size:12px;color:var(--text-secondary)}
@media(max-width:650px){.neon-panel .neon-columns{grid-template-columns:minmax(0,1fr)}}
`;
