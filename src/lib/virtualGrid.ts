// Virtualized grid windowing math (pure, unit-testable).
//
// Given a scrollable CSS grid of `itemCount` items laid out in `cols` columns,
// computes which slice of items must be rendered so that only the visible rows
// (plus overscan) exist in the DOM. The rendered window is offset with
// `translateY(offsetY)` inside a spacer of `totalH` so the scrollbar length
// stays correct without rendering every row.
//
// Row heights are estimated (`rowH`) and continuously re-measured by the
// VirtualMenuGrid component — see src/components/pos/VirtualMenuGrid.tsx.

export interface VirtualWindowResult {
  /** Index into the items array of the first visible item. */
  startIndex: number;
  /** Index one past the last visible item. */
  endIndex: number;
  /** Number of items that should be rendered. */
  visibleCount: number;
  /** Total number of grid rows in the full list. */
  totalRows: number;
  /** First rendered row (clamped to >= 0). */
  startRow: number;
  /** One past the last rendered row (clamped to <= totalRows). */
  endRow: number;
  /** Pixel offset to translate the rendered window by. */
  offsetY: number;
  /** Total pixel height of the scroll content (spacer height). */
  totalH: number;
}

export interface VirtualWindowInput {
  /** Total number of items in the grid. */
  itemCount: number;
  /** Number of grid columns (>= 1). */
  cols: number;
  /** Current scroll top of the container, px. */
  scrollTop: number;
  /** Visible height of the scroll container, px. */
  viewportH: number;
  /** Estimated/measured row height, px. */
  rowH: number;
  /** Rows rendered above/below the viewport. Default 3. */
  overscan?: number;
}

/** Fallback row height used before the first measurement. */
export const FALLBACK_ROW_H = 180;
/** Fallback viewport height used before the first ResizeObserver tick. */
export const FALLBACK_VIEWPORT_H = 480;

export function computeVirtualWindow({
  itemCount,
  cols,
  scrollTop,
  viewportH,
  rowH,
  overscan = 3,
}: VirtualWindowInput): VirtualWindowResult {
  const safeCols = Math.max(1, Math.floor(cols) || 1);
  const safeItemCount = Math.max(0, Math.floor(itemCount) || 0);
  const totalRows = Math.max(1, Math.ceil(safeItemCount / safeCols));
  const safeRowH = rowH > 0 ? rowH : FALLBACK_ROW_H;
  const safeViewport = Math.max(0, viewportH) || FALLBACK_VIEWPORT_H;

  // Clamp the scroll row to the content so over-scrolled positions still show
  // the last page instead of an empty window past the end.
  const scrollRow = Math.min(totalRows, Math.floor(Math.max(0, scrollTop) / safeRowH));
  const visibleRows = Math.ceil(safeViewport / safeRowH);

  const startRow = Math.max(0, scrollRow - overscan);
  const endRow = Math.min(totalRows, scrollRow + visibleRows + overscan);

  const startIndex = startRow * safeCols;
  const endIndex = Math.min(safeItemCount, endRow * safeCols);

  return {
    startIndex,
    endIndex,
    visibleCount: Math.max(0, endIndex - startIndex),
    totalRows,
    startRow,
    endRow,
    offsetY: startRow * safeRowH,
    totalH: totalRows * safeRowH,
  };
}
