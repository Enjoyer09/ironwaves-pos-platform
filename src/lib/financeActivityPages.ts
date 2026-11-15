export type CursorPage<T> = { rows: T[]; total: number | null; next_cursor: string | null };

export async function collectFinanceActivityPages<T extends { id: string }>(
  fetchPage: (cursor?: string) => Promise<CursorPage<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  const seenIds = new Set<string>();
  const seenCursors = new Set<string>();
  let expectedTotal: number | null = null;
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    if (expectedTotal === null && page.total === null) throw new Error('Missing activity total');
    if (page.total !== null && (!Number.isSafeInteger(page.total) || page.total < 0 ||
        (expectedTotal !== null && page.total !== expectedTotal))) {
      throw new Error('Activity changed during export');
    }
    expectedTotal = expectedTotal ?? page.total;
    if (expectedTotal === null) throw new Error('Missing activity total');
    for (const row of page.rows) {
      if (seenIds.has(row.id)) throw new Error('Duplicate activity export row');
      seenIds.add(row.id);
      rows.push(row);
    }
    if (rows.length > expectedTotal) throw new Error('Activity changed during export');
    cursor = page.next_cursor || undefined;
    if (cursor) {
      if (seenCursors.has(cursor) || rows.length === expectedTotal) throw new Error('Invalid activity export cursor');
      seenCursors.add(cursor);
    } else {
      if (page.total === null) throw new Error('Missing final activity total');
      if (rows.length !== expectedTotal) throw new Error('Incomplete activity export');
    }
  } while (cursor);
  return rows;
}
