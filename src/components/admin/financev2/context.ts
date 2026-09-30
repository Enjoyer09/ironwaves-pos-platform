import React from 'react';
import type { GLAccount, GLCapabilities } from '../../../api/gl';

export type GLNotify = (type: 'success' | 'error' | 'info' | 'warning', message: string) => void;

export type GLPanelContext = {
  lang: string;
  caps: GLCapabilities;
  accounts: GLAccount[];
  accountsByCode: Map<string, GLAccount>;
  notify: GLNotify;
  /** Increments after every write so tabs refetch. */
  version: number;
  bump: () => void;
  openLedger: (accountId: string) => void;
  openJournal: (journalId: string) => void;
};

export const GLContext = React.createContext<GLPanelContext | null>(null);

export function useGL(): GLPanelContext {
  const ctx = React.useContext(GLContext);
  if (!ctx) throw new Error('GLContext is missing');
  return ctx;
}

/** Load data for a tab; re-runs when deps or the panel version change. */
export function useGLLoad<T>(loader: () => Promise<T>, deps: React.DependencyList): { data: T | null; loading: boolean; error: string; reload: () => void } {
  const { version } = useGL();
  const [data, setData] = React.useState<T | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    loader()
      .then((result) => { if (alive) setData(result); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version, tick]);
  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}
