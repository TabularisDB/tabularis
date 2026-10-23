import type {SavedQueryExcerpt} from '@/utils/savedQuerySearch';

interface SqlMatchExcerptProps {
    excerpt: SavedQueryExcerpt;
}

export function SqlMatchExcerpt({excerpt}: SqlMatchExcerptProps) {
    const {before, match, after, truncatedStart, truncatedEnd} = excerpt;

    return (
        <div className="text-[11px] leading-[1.4] font-mono text-secondary whitespace-pre-wrap break-all overflow-hidden line-clamp-2">
            {truncatedStart && '…'}
            {before}
            <mark className="bg-accent-warning/30 text-primary rounded-sm">{match}</mark>
            {after}
            {truncatedEnd && '…'}
        </div>
    );
}
