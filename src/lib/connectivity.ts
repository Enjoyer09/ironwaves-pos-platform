import { getApiBaseUrl, isBackendEnabled } from '../api/client';

const DEFAULT_PROBE_URL = 'https://www.gstatic.com/generate_204';

const withTimeout = async (promise: Promise<Response>, timeoutMs = 3500): Promise<Response> => {
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('probe-timeout')), timeoutMs);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
};

// navigator.onLine is often optimistic; this probe confirms real internet access.
export const probeInternet = async (probeUrl = DEFAULT_PROBE_URL): Promise<boolean> => {
  const backendProbe = isBackendEnabled() ? `${getApiBaseUrl()}/health` : '';
  const candidates = [backendProbe, probeUrl].filter(Boolean);

  try {
    for (const candidate of candidates) {
      try {
        await withTimeout(
          fetch(candidate, {
            method: 'GET',
            cache: 'no-store',
            mode: candidate === backendProbe ? 'cors' : 'no-cors',
          }),
          3500,
        );
        return true;
      } catch {
        // try next probe candidate
      }
    }
    return false;
  } catch {
    return false;
  }
};
