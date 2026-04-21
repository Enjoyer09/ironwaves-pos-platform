export function sanitizeHtmlForIframe(input: string | null | undefined): string {
  const raw = String(input || '');
  if (!raw) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') return raw;

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(raw, 'text/html');

    doc.querySelectorAll('script, iframe, object, embed').forEach((node) => node.remove());

    doc.querySelectorAll('*').forEach((el) => {
      const attrs = Array.from(el.attributes || []);
      attrs.forEach((attr) => {
        const name = String(attr.name || '').toLowerCase();
        const value = String(attr.value || '').trim().toLowerCase();
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
          return;
        }
        if ((name === 'src' || name === 'href' || name === 'xlink:href') && value.startsWith('javascript:')) {
          el.removeAttribute(attr.name);
        }
      });
    });

    return doc.documentElement.outerHTML;
  } catch {
    return raw;
  }
}

