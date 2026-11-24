import { describe, expect, it, vi } from 'vitest';
import { openWikipediaWithConfirm, splitTextWithWikiTerms } from '../lib/wikiTerms';

describe('wikiTerms', () => {
  it('detects technical terms and deduplicates within the same block', () => {
    const seen = new Set<string>();
    const parts = splitTextWithWikiTerms(
      'RAGとLLMを組み合わせたファインチューニング。なおLLMは重要です。',
      seen
    );
    const terms = parts.filter((p) => p.term).map((p) => p.term);
    expect(terms).toEqual(['RAG', 'LLM', 'ファインチューニング']);
  });

  it('asks confirmation before opening Wikipedia', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    await openWikipediaWithConfirm('RAG');
    expect(openSpy).not.toHaveBeenCalled();

    await openWikipediaWithConfirm('RAG');
    expect(openSpy).toHaveBeenCalledWith(
      'https://ja.wikipedia.org/wiki/RAG',
      '_blank',
      'noopener,noreferrer'
    );

    confirmSpy.mockRestore();
    openSpy.mockRestore();
  });
});
