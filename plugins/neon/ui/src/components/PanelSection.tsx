import type {ReactNode} from 'react';

export function PanelSection({
    title,
    hint,
    actions,
    children,
}: {
    title: string;
    hint?: string;
    actions?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="neon-section">
            <div className="neon-section-header">
                <div>
                    <h3>{title}</h3>
                    {hint && <p className="neon-hint">{hint}</p>}
                </div>
                {actions && <div className="neon-inline-actions">{actions}</div>}
            </div>
            {children}
        </section>
    );
}

export function ResultPlaceholder({children}: {children: ReactNode}) {
    return <div className="neon-result-placeholder">{children}</div>;
}
