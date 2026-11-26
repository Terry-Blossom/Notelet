import { describe, expect, it } from 'vitest';
import { parseGranolaImportFiles, prosemirrorToMarkdown } from '../lib/granolaImport';

describe('Granola import parser', () => {
  it('parses Granola CSV export with multiline quoted fields and transcript', () => {
    const csv = [
      'id,title,created_at,participants,summary,manual_notes,transcript',
      '"g-101","Product Sync, Q4","2026-11-10T10:00:00Z","Alice; Bob","## Summary\nDiscussed roadmap.\n\n## Decisions\n- Ship v2 in Dec\n\n## Action Items\n- [ ] Prepare release notes","Check QA status","[00:05] Alice: Let us review Q4.\n[00:18] Bob: Sounds good."',
    ].join('\n');

    const res = parseGranolaImportFiles([{ name: 'granola-export.csv', content: csv }], {
      folderId: 'meeting',
    });

    expect(res.warnings).toEqual([]);
    expect(res.skippedDuplicates).toBe(0);
    expect(res.notes).toHaveLength(1);

    const note = res.notes[0];
    expect(note.title).toBe('Product Sync, Q4');
    expect(note.folder_id).toBe('meeting');
    expect(note.participants).toEqual(['Alice', 'Bob']);
    expect(note.decisions).toEqual(['Ship v2 in Dec']);
    expect(note.action_items).toHaveLength(1);
    expect(note.action_items[0].text).toBe('Prepare release notes');
    expect(note.manual_notes).toBe('Check QA status');
    expect(note.segments).toHaveLength(2);
    expect(note.segments[0].speaker).toBe('Alice');
    expect(note.segments[0].start_ms).toBe(5000);
    expect(note.segments[1].speaker).toBe('Bob');
    expect(note.segments[1].start_ms).toBe(18000);
    expect(note.tags).toContain('granola-import');
    expect(note.tags).toContain('granola:g-101');
  });

  it('parses double-JSON encoded cache-v3.json with ProseMirror content and transcripts', () => {
    const innerState = {
      state: {
        documents: {
          'doc-1': {
            id: 'doc-1',
            title: 'Weekly Standup',
            created_at: '2026-11-12T09:00:00Z',
            updated_at: '2026-11-12T09:30:00Z',
            people: {
              attendees: [{ name: 'Ken' }, { email: 'mika@example.com' }],
            },
            last_viewed_panel: {
              content: {
                type: 'doc',
                content: [
                  {
                    type: 'heading',
                    attrs: { level: 2 },
                    content: [{ type: 'text', text: 'Highlights' }],
                  },
                  {
                    type: 'bulletList',
                    content: [
                      {
                        type: 'listItem',
                        content: [
                          {
                            type: 'paragraph',
                            content: [
                              { type: 'text', text: 'API migration ', marks: [{ type: 'bold' }] },
                              { type: 'text', text: 'completed' },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
          'doc-deleted': {
            id: 'doc-deleted',
            title: 'Deleted Note',
            deleted_at: '2026-11-12T10:00:00Z',
          },
        },
        transcripts: {
          'doc-1': [
            {
              source: 'microphone',
              text: 'Morning everyone.',
              start_timestamp: '2026-11-12T09:00:05Z',
              end_timestamp: '2026-11-12T09:00:08Z',
            },
            {
              source: 'system',
              text: 'API migration is done.',
              start_timestamp: '2026-11-12T09:00:10Z',
              end_timestamp: '2026-11-12T09:00:15Z',
            },
          ],
        },
      },
    };

    const outerCache = JSON.stringify({
      cache: JSON.stringify(innerState),
    });

    const res = parseGranolaImportFiles([{ name: 'cache-v3.json', content: outerCache }]);
    expect(res.warnings).toEqual([]);
    expect(res.notes).toHaveLength(1);

    const note = res.notes[0];
    expect(note.title).toBe('Weekly Standup');
    expect(note.participants).toEqual(['Ken', 'mika@example.com']);
    expect(note.summary).toContain('## Highlights');
    expect(note.summary).toContain('- **API migration **completed');
    expect(note.segments).toHaveLength(2);
    expect(note.segments[0].speaker).toBe('自分');
    expect(note.segments[0].start_ms).toBe(5000);
    expect(note.segments[1].speaker).toBe('相手');
    expect(note.duration_sec).toBe(15);
  });

  it('warns clearly when encountering encrypted Granola cache JSON', () => {
    const encryptedJson = JSON.stringify({ encrypted: true, ciphertext: 'abc123' });
    const res = parseGranolaImportFiles([{ name: 'cache-v3.json', content: encryptedJson }]);
    expect(res.notes).toHaveLength(0);
    expect(res.warnings[0]).toContain('暗号化');
  });

  it('parses Markdown export with YAML frontmatter and transcript section', () => {
    const md = [
      '---',
      'id: md-42',
      'title: Design Review',
      'created: 2026-11-15T14:00:00Z',
      'participants:',
      '  - Sato',
      '  - Tanaka',
      '---',
      '',
      '## 要約',
      'UI の配色を確定しました。',
      '',
      '## Transcript',
      '[00:10] Sato: コントラストを上げましょう。',
      '[00:22] Tanaka: 了解です。',
    ].join('\n');

    const res = parseGranolaImportFiles([{ name: '2026-11-15_Design_Review.md', content: md }]);
    expect(res.notes).toHaveLength(1);
    const note = res.notes[0];
    expect(note.title).toBe('Design Review');
    expect(note.participants).toEqual(['Sato', 'Tanaka']);
    expect(note.summary).toContain('UI の配色を確定しました。');
    expect(note.segments).toHaveLength(2);
    expect(note.segments[0].speaker).toBe('Sato');
    expect(note.segments[0].start_ms).toBe(10000);
  });

  it('skips duplicate notes based on granola ID or title + created_at', () => {
    const md = `---\nid: dup-1\ntitle: Same Meeting\ncreated: 2026-11-15T14:00:00Z\n---\nSummary text`;
    const first = parseGranolaImportFiles([{ name: 'a.md', content: md }]);
    expect(first.notes).toHaveLength(1);

    const second = parseGranolaImportFiles([{ name: 'a.md', content: md }], {
      existingNotes: first.notes,
    });
    expect(second.notes).toHaveLength(0);
    expect(second.skippedDuplicates).toBe(1);
  });

  it('converts ProseMirror codeBlock and blockquote', () => {
    const out = prosemirrorToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note this' }] }],
        },
      ],
    });
    expect(out).toBe('> Note this');
  });

  it('parses float epoch timestamp strings instead of falling back to now (#32)', () => {
    const payload = JSON.stringify([
      {
        id: 'g-float',
        title: 'Float Epoch Meeting',
        created_at: '1700000000.123',
        notes_markdown: 'Body',
      },
    ]);
    const res = parseGranolaImportFiles([{ name: 'granola.json', content: payload }]);
    expect(res.notes).toHaveLength(1);
    expect(res.notes[0].created_at).toBe('2023-11-14T22:13:20.123Z');
  });
});
