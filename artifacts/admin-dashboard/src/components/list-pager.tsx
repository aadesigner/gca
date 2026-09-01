import { Button } from "@/components/ui/button";

type ListPagerProps = {
  offset: number;
  pageSize: number;
  total: number;
  onOffsetChange: (next: number) => void;
  className?: string;
};

export function ListPager({ offset, pageSize, total, onOffsetChange, className = "" }: ListPagerProps) {
  if (total <= pageSize) return null;

  const page = Math.floor(offset / pageSize) + 1;
  const pageCount = Math.ceil(total / pageSize);
  const from = offset + 1;
  const to = Math.min(offset + pageSize, total);

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-6 py-4 border-t border-border ${className}`}
    >
      <span className="text-xs text-muted-foreground font-mono">
        Showing {from}–{to} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
          disabled={offset === 0}
        >
          ← Previous
        </Button>
        <span className="text-xs text-muted-foreground min-w-[7rem] text-center">
          Page {page} of {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onOffsetChange(offset + pageSize)}
          disabled={offset + pageSize >= total}
        >
          Next →
        </Button>
      </div>
    </div>
  );
}
