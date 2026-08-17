import React, { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { computeVirtualWindow } from '../../lib/virtualGrid';

interface VirtualMenuGridProps<T> {
  /** All groups to display (already filtered/grouped by the caller). */
  groups: T[];
  /** Stable key for each group (used as React key). */
  getKey: (group: T) => string;
  /** Renders a single card. Re-created by the parent on every parent render. */
  renderItem: (group: T) => React.ReactNode;
  /** Classes for the scrollable container (flex sizing + overflow). */
  scrollClassName: string;
  /** Classes for the inner grid (grid cols, gap, alignment). */
  gridClassName: string;
  /** Initial row-height guess before the first measurement (px). */
  estimatedRowHeight?: number;
  /** Only virtualize when there are more than this many groups. */
  threshold?: number;
  /** Disable virtualization (render everything) — used in DnD edit mode. */
  disableVirtualization?: boolean;
}

/**
 * Scrollable grid that renders only the visible rows (plus overscan) into the
 * DOM. Row height is measured after each window render and smoothed, so cards
 * with images / fallbacks / varying text stay aligned. Before the first
 * measurement the full list is rendered once (bootstrap), then windowing
 * kicks in for the whole session — category/search changes keep measurements.
 */
export default function VirtualMenuGrid<T>({
  groups,
  getKey,
  renderItem,
  scrollClassName,
  gridClassName,
  estimatedRowHeight = 180,
  threshold = 100,
  disableVirtualization = false,
}: VirtualMenuGridProps<T>) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef(0);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(0);
  const [rowH, setRowH] = useState<number | null>(null);
  const [cols, setCols] = useState<number | null>(null);

  // Reset scroll to top whenever the filtered group list changes (category /
  // search / menu refresh) so the user sees the start of the new list.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrollTop(0);
  }, [groups]);

  // Track container height (viewport resizes / layout changes).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportH(el.clientHeight || 0);
    const observer = new ResizeObserver(() => {
      setViewportH(el.clientHeight || 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Measure columns + average row height after the window renders.
  // Re-runs whenever the rendered slice changes; the deadband prevents churn.
  useLayoutEffect(() => {
    const el = windowRef.current;
    if (!el) return;
    const computedCols = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length;
    if (computedCols > 0 && computedCols !== cols) setCols(computedCols);
    const rowsRendered = Math.ceil(el.children.length / Math.max(1, computedCols));
    if (rowsRendered > 0) {
      const actual = el.offsetHeight / rowsRendered;
      if (actual > 0) {
        setRowH((prev) => {
          if (prev === null) return actual;
          if (Math.abs(actual - prev) / prev > 0.08) return prev * 0.7 + actual * 0.3;
          return prev;
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, scrollTop, viewportH]);

  const handleScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
    });
  }, []);

  const ready = cols !== null && cols > 0 && rowH !== null && rowH > 0;
  const virtualize = ready && !disableVirtualization && groups.length > threshold;

  const win = useMemo(
    () =>
      computeVirtualWindow({
        itemCount: groups.length,
        cols: cols ?? 1,
        scrollTop,
        viewportH,
        rowH: rowH ?? estimatedRowHeight,
        overscan: 3,
      }),
    [groups.length, cols, scrollTop, viewportH, rowH, estimatedRowHeight],
  );

  const visible = useMemo(() => groups.slice(win.startIndex, win.endIndex), [groups, win.startIndex, win.endIndex]);

  if (virtualize) {
    return (
      <div ref={scrollRef} onScroll={handleScroll} className={scrollClassName}>
        <div style={{ position: 'relative', height: win.totalH }}>
          <div
            ref={windowRef}
            className={gridClassName}
            style={{ transform: `translateY(${win.offsetY}px)`, willChange: 'transform' }}
          >
            {visible.map((group) => (
              <Fragment key={getKey(group)}>{renderItem(group)}</Fragment>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={scrollRef} onScroll={handleScroll} className={scrollClassName}>
      <div ref={windowRef} className={gridClassName}>
        {groups.map((group) => (
          <Fragment key={getKey(group)}>{renderItem(group)}</Fragment>
        ))}
      </div>
    </div>
  );
}
