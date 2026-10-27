import {useTranslation} from 'react-i18next';
import {ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight} from 'lucide-react';
import type {Pagination} from '@/types/editor';
import {totalPageCount} from '@/utils/pagination';
import {PageIndicator} from './PageIndicator';

interface PaginationControlsProps {
    pagination: Pagination;
    isLoading: boolean;
    onPageChange: (page: number) => void;
}

export function PaginationControls({pagination, isLoading, onPageChange}: PaginationControlsProps) {
    const {t} = useTranslation();
    const isFirstPage = pagination.page === 1;
    const totalPages = totalPageCount(pagination.total_rows, pagination.page_size);

    return (
        <div className="flex items-center gap-1 bg-surface-secondary rounded border border-strong shrink-0">
            {/* First/last jump buttons disappear in narrow panes (container query) */}
            <button
                disabled={isFirstPage || isLoading}
                onClick={() => onPageChange(1)}
                className="hidden @[420px]:block p-1 hover:bg-surface-tertiary text-secondary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                title={t('pagination.firstPage')}
                aria-label={t('pagination.firstPage')}
            >
                <ChevronsLeft size={14} />
            </button>
            <button
                disabled={isFirstPage || isLoading}
                onClick={() => onPageChange(pagination.page - 1)}
                className="p-1 hover:bg-surface-tertiary text-secondary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed @[420px]:border-l border-strong"
                title={t('pagination.previousPage')}
                aria-label={t('pagination.previousPage')}
            >
                <ChevronLeft size={14} />
            </button>
            <PageIndicator
                page={pagination.page}
                totalPages={totalPages}
                disabled={isLoading}
                onPageChange={onPageChange}
            />
            <button
                disabled={!pagination.has_more || isLoading}
                onClick={() => onPageChange(pagination.page + 1)}
                className="p-1 hover:bg-surface-tertiary text-secondary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed border-l border-strong"
                title={t('pagination.nextPage')}
                aria-label={t('pagination.nextPage')}
            >
                <ChevronRight size={14} />
            </button>
            <button
                disabled={totalPages === null || isLoading}
                onClick={() => {
                    if (totalPages !== null) onPageChange(totalPages);
                }}
                className="hidden @[420px]:block p-1 hover:bg-surface-tertiary text-secondary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed border-l border-strong"
                title={t('pagination.lastPage')}
                aria-label={t('pagination.lastPage')}
            >
                <ChevronsRight size={14} />
            </button>
        </div>
    );
}
