import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({
  page, pageSize, total, onPageChange,
}: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 text-sm">
      <p className="text-slate-500">
        {total === 0 ? 'No results' : `Showing ${from}-${to} of ${total}`}
      </p>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex items-center justify-center h-8 w-8 rounded-control border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-2 text-slate-600">{page} / {totalPages}</span>
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="inline-flex items-center justify-center h-8 w-8 rounded-control border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
