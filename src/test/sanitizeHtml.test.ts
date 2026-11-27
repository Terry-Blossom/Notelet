import { describe, expect, it } from 'vitest';
import { sanitizeMemoHtml } from '../lib/sanitizeHtml';

describe('sanitizeMemoHtml', () => {
  it('removes script tags, event handlers, and javascript: URLs', () => {
    const dirty =
      '<p>Hello</p><script>alert(1)</script>' +
      '<img src="x" onerror="alert(2)">' +
      '<svg onload="alert(3)"></svg>' +
      '<a href="javascript:alert(4)" onclick="alert(5)">bad</a>' +
      '<div onmouseover="alert(6)">hover</div>';
    const clean = sanitizeMemoHtml(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('onload');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('onmouseover');
    expect(clean).not.toContain('javascript:');
    expect(clean).toContain('<p>Hello</p>');
    expect(clean).toContain('<div>hover</div>');
  });

  it('preserves safe formatting tags and https links', () => {
    const safe =
      '<h1>Title</h1><p><strong>Bold</strong> <u>Underline</u></p>' +
      '<ul><li>Item 1</li></ul><a href="https://example.com">Link</a>';
    const clean = sanitizeMemoHtml(safe);
    expect(clean).toContain('<h1>Title</h1>');
    expect(clean).toContain('<strong>Bold</strong>');
    expect(clean).toContain('<u>Underline</u>');
    expect(clean).toContain('<ul><li>Item 1</li></ul>');
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain('rel="noopener noreferrer"');
  });
});
