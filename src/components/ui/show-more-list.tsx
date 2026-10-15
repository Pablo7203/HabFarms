"use client";

import { Children, useId, useState, type ReactNode } from "react";

type ShowMoreListProps = {
  children: ReactNode;
  className?: string;
  initialCount?: number;
};

export function ShowMoreList({
  children,
  className,
  initialCount = 5,
}: ShowMoreListProps) {
  const items = Children.toArray(children);
  const [expanded, setExpanded] = useState(false);
  const listId = useId();

  if (items.length <= initialCount) {
    return <div className={className}>{items}</div>;
  }

  return (
    <>
      <div id={listId} className={className}>
        {expanded ? items : items.slice(0, initialCount)}
      </div>
      <div className="border-t border-stone-100 px-5 py-3">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((value) => !value)}
          className="min-h-10 rounded-lg px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
        >
          {expanded ? "Show less" : `Show ${items.length - initialCount} more`}
        </button>
      </div>
    </>
  );
}
