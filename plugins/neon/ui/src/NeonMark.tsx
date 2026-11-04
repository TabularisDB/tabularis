/** Shared provider mark; its foreground follows the host's accessible brand contrast. */
export function NeonMark({size = 26}: {size?: number}) {
    return (
        <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path
                d="M3 16V4h10l4 4v8h-5V9l-5 7H3Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
            />
        </svg>
    );
}
