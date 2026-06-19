import { useLingui } from "@lingui/react/macro";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type { Pagination } from "../../types/editor";

interface PaginationControlsProps {
  pagination: Pagination;
  isLoading: boolean;
  onPageChange: (page: number) => void;
}

export function PaginationControls({
  pagination,
  isLoading,
  onPageChange,
}: PaginationControlsProps) {
  const { t } = useLingui();
  const isFirstPage = pagination.page === 1;
  const totalPages =
    pagination.total_rows !== null
      ? Math.ceil(pagination.total_rows / pagination.page_size)
      : null;

  return (
    <div className="flex items-center gap-1 bg-surface-secondary rounded border border-strong">
      <button
        disabled={isFirstPage || isLoading}
        onClick={() => onPageChange(1)}
        className="p-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
        title="First Page"
      >
        <ChevronsLeft size={14} />
      </button>
      <button
        disabled={isFirstPage || isLoading}
        onClick={() => onPageChange(pagination.page - 1)}
        className="p-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border-l border-strong"
        title="Previous Page"
      >
        <ChevronLeft size={14} />
      </button>
      <div className="px-3 text-secondary text-xs font-medium min-w-[80px] text-center py-1">
        {totalPages !== null
          ? t`Page ${pagination.page} of ${totalPages}`
          : t`Page ${pagination.page}`}
      </div>
      <button
        disabled={!pagination.has_more || isLoading}
        onClick={() => onPageChange(pagination.page + 1)}
        className="p-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border-l border-strong"
        title="Next Page"
      >
        <ChevronRight size={14} />
      </button>
      <button
        disabled={totalPages === null || isLoading}
        onClick={() => {
          if (totalPages !== null) onPageChange(totalPages);
        }}
        className="p-1 hover:bg-surface-tertiary text-secondary hover:text-white disabled:opacity-30 disabled:cursor-not-allowed border-l border-strong"
        title="Last Page"
      >
        <ChevronsRight size={14} />
      </button>
    </div>
  );
}
