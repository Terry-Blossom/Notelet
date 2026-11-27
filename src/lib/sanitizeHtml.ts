const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'div',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'del',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'a',
  'hr',
]);

const DROP_SUBTREE_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'noscript',
  'template',
  'form',
  'input',
  'textarea',
  'button',
  'select',
]);

function isSafeHref(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('#')) return true;
  try {
    const parsed = new URL(trimmed, 'https://notelet.local');
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function sanitizeNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) {
    return doc.createTextNode(node.textContent ?? '');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROP_SUBTREE_TAGS.has(tag)) {
    return null;
  }
  if (!ALLOWED_TAGS.has(tag)) {
    const frag = doc.createDocumentFragment();
    for (const child of Array.from(el.childNodes)) {
      const cleanChild = sanitizeNode(child, doc);
      if (cleanChild) frag.appendChild(cleanChild);
    }
    return frag;
  }

  const out = doc.createElement(tag);
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    if (isSafeHref(href)) {
      out.setAttribute('href', href.trim());
      out.setAttribute('rel', 'noopener noreferrer');
      out.setAttribute('target', '_blank');
    }
  }
  for (const child of Array.from(el.childNodes)) {
    const cleanChild = sanitizeNode(child, doc);
    if (cleanChild) out.appendChild(cleanChild);
  }
  return out;
}

export function sanitizeMemoHtml(html: string): string {
  if (!html) return '';
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') {
    return html.replace(/<[^>]*>/g, '');
  }
  const parser = new DOMParser();
  const parsed = parser.parseFromString(html, 'text/html');
  const container = document.createElement('div');
  for (const child of Array.from(parsed.body.childNodes)) {
    const clean = sanitizeNode(child, document);
    if (clean) container.appendChild(clean);
  }
  return container.innerHTML;
}
