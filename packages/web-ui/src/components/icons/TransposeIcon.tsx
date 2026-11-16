interface TransposeIconProps {
    size?: number;
    className?: string;
}

/**
 * Transposed-grid toggle (#561): a table with a two-way corner arrow in its
 * cut-out corner. Drawn on Lucide's 24px grid and stroke so it sits with the
 * other toolbar icons; Lucide has no transpose glyph.
 */
export const TransposeIcon = ({size = 24, className}: TransposeIconProps) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
    >
        <path d="M21 10V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" />
        <path d="M3 9h18" />
        <path d="M9 3v18" />
        <path d="M12 14h5a2 2 0 0 1 2 2v6" />
        <path d="m15 11-3 3 3 3" />
        <path d="m16 19 3 3 3-3" />
    </svg>
);
