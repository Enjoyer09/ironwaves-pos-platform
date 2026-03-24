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
  try {
    await withTimeout(
      fetch(probeUrl, {
        method: 'GET',
        cache: 'no-store',
        mode: 'no-cors',
      }),
      3500,
    );
    return true;
  } catch {
    return false;
  }
};
