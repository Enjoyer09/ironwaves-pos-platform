/**
 * Pure utility functions for floor plan calculations.
 * No React, no side effects — fully unit-testable.
 */

export interface FloorTableMin {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  capacity: number;
  status: string;
  assigned_table_id?: string | null;
}

export interface MergedGroup {
  id: string;
  tables: FloorTableMin[];
}

export interface GroupOutline {
  id: string;
  label: string;
  left: string;
  width: string;
  top: string;
  height: string;
}

export interface FloorSummary {
  AVAILABLE: number;
  RESERVED: number;
  SEATED: number;
  ACTIVE_CHECK: number;
  DIRTY: number;
}

export interface ReservationTimelineEntry {
  reservation: any;
  lane: number;
  startMinutes: number;
  duration: number;
  top: number;
  height: number;
}

export interface ReservationTimeline {
  hourStart: number;
  hourEnd: number;
  minuteHeight: number;
  lanes: Array<{ id: string; label: string }>;
  laneWidth: number;
  entries: ReservationTimelineEntry[];
  totalHeight: number;
  totalWidth: number;
}

/**
 * Computes floor summary statistics from floor tables.
 */
export function computeFloorSummary(floorTables: FloorTableMin[]): FloorSummary {
  const counts: FloorSummary = { AVAILABLE: 0, RESERVED: 0, SEATED: 0, ACTIVE_CHECK: 0, DIRTY: 0 };
  floorTables.forEach((row) => {
    const status = String(row.status || 'AVAILABLE').toUpperCase() as keyof FloorSummary;
    if (status in counts) counts[status] += 1;
  });
  return counts;
}

/**
 * Suggests best-fit tables for a reservation based on party size.
 */
export function suggestReservationTables(
  candidates: FloorTableMin[],
  partySize: number,
  limit = 3,
): FloorTableMin[] {
  const size = Math.max(1, partySize);
  return [...candidates]
    .filter((row) => Number(row.capacity || 0) >= size)
    .sort((a, b) => {
      const gapA = Math.abs(Number(a.capacity || 0) - size);
      const gapB = Math.abs(Number(b.capacity || 0) - size);
      if (gapA !== gapB) return gapA - gapB;
      return String(a.label || '').localeCompare(String(b.label || ''));
    })
    .slice(0, limit);
}

/**
 * Groups floor tables by merged_group_id.
 */
export function computeMergedGroups(floorTables: any[]): MergedGroup[] {
  const groups = new Map<string, any[]>();
  floorTables.forEach((table) => {
    const mergedGroupId = String((table as any).merged_group_id || '').trim();
    if (!mergedGroupId) return;
    groups.set(mergedGroupId, [...(groups.get(mergedGroupId) || []), table]);
  });
  return Array.from(groups.entries()).map(([id, tablesInGroup]) => ({ id, tables: tablesInGroup }));
}

/**
 * Computes visual outlines for merged table groups.
 */
export function computeMergedGroupOutlines(
  mergedGroups: MergedGroup[],
  maxCols: number,
): GroupOutline[] {
  const cols = Math.max(6, maxCols);
  return mergedGroups.map((group) => {
    const minX = Math.min(...group.tables.map((t) => Number(t.x || 0)));
    const minY = Math.min(...group.tables.map((t) => Number(t.y || 0)));
    const maxX = Math.max(...group.tables.map((t) => Number(t.x || 0) + Number(t.w || 1)));
    const maxY = Math.max(...group.tables.map((t) => Number(t.y || 0) + Number(t.h || 1)));
    return {
      id: group.id,
      label: group.tables.map((t) => t.label).join(' + '),
      left: `${(minX / cols) * 100}%`,
      width: `${((maxX - minX) / cols) * 100}%`,
      top: `${minY * 70}px`,
      height: `${(maxY - minY) * 70}px`,
    };
  });
}

/**
 * Computes reservation timeline layout for the timeline view.
 */
export function computeReservationTimeline(params: {
  reservations: any[];
  floorTables: Array<{ id: string; label: string }>;
  reservationDurationDrafts: Record<string, number>;
  reservationZoom: 15 | 30;
  unassignedLabel: string;
  parseTimestamp: (ts: string) => Date | null;
}): ReservationTimeline {
  const { reservations, floorTables, reservationDurationDrafts, reservationZoom, unassignedLabel, parseTimestamp } = params;
  const hourStart = 8;
  const hourEnd = 24;
  const minuteHeight = reservationZoom === 15 ? 1.25 : 0.8;
  const laneDefinitions = [
    { id: '', label: unassignedLabel },
    ...[...floorTables]
      .sort((a, b) => String(a.label || '').localeCompare(String(b.label || '')))
      .map((table) => ({ id: table.id, label: table.label })),
  ];
  const laneWidth = 220;
  const entries: ReservationTimelineEntry[] = [...reservations]
    .sort((a, b) => a.reservation_at.localeCompare(b.reservation_at))
    .map((reservation) => {
      const startAt = parseTimestamp(reservation.reservation_at) || new Date(reservation.reservation_at);
      const startMinutes = startAt.getHours() * 60 + startAt.getMinutes();
      const duration = Math.max(30, Number(reservationDurationDrafts[reservation.id] ?? (reservation.duration_minutes || 90)));
      const lane = Math.max(0, laneDefinitions.findIndex((laneRow) => laneRow.id === String(reservation.assigned_table_id || '')));
      return {
        reservation,
        lane,
        startMinutes,
        duration,
        top: Math.max(0, startMinutes - hourStart * 60) * minuteHeight,
        height: Math.max(62, duration * minuteHeight),
      };
    });
  return {
    hourStart,
    hourEnd,
    minuteHeight,
    lanes: laneDefinitions,
    laneWidth,
    entries,
    totalHeight: (hourEnd - hourStart) * 60 * minuteHeight,
    totalWidth: laneDefinitions.length * laneWidth,
  };
}
