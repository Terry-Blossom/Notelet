import { describe, expect, it } from 'vitest';
import { createEmptyNote } from '../lib/format';
import { exportNotesAsObsidianZip, mergeNoteletBackupJson, noteToObsidianMarkdown } from '../lib/noteExportImport';
import { createZipBytes, unzipTextFiles } from '../lib/zip';
import { AppDataSnapshot } from '../types';

describe('ZIP, Obsidian Markdown export, and Backup restore', () => {
  it('creates and extracts UTF-8 ZIP archives round-trip', async () => {
    const bytes = createZipBytes([
      { name: 'notes/2026-11-22_会議メモ.md', content: '# 会議メモ\nテスト内容' },
      { name: 'data.json', content: '{"ok":true}' },
    ]);
    const extracted = await unzipTextFiles(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

    expect(extracted).toHaveLength(2);
    expect(extracted[0].name).toBe('notes/2026-11-22_会議メモ.md');
    expect(extracted[0].content).toBe('# 会議メモ\nテスト内容');
    expect(extracted[1].name).toBe('data.json');
    expect(extracted[1].content).toBe('{"ok":true}');
  });

  it('exports notes as Obsidian YAML frontmatter Markdown inside ZIP', async () => {
    const note = createEmptyNote();
    note.id = 'n-obs-1';
    note.title = '設計レビュー';
    note.created_at = '2026-11-22T10:00:00Z';
    note.folder_id = 'meeting';
    note.participants = ['佐藤', '鈴木'];
    note.tags = ['design'];
    note.summary = 'アーキテクチャを合意しました。';
    note.decisions = ['Option A を採用'];
    note.action_items = [{ id: 'a1', text: 'PR を作成する', assignee: '佐藤', done: false }];
    note.segments = [{ id: 's1', start_ms: 5000, end_ms: 8000, speaker: '佐藤', text: '開始します。' }];

    const md = noteToObsidianMarkdown(note, '会議');
    expect(md).toContain('folder: "会議"');
    expect(md).toContain('## 決定事項');
    expect(md).toContain('- [ ] PR を作成する (@佐藤)');

    const zipBlob = exportNotesAsObsidianZip([note], [
      { id: 'meeting', name: '会議', is_shared: false, permission: 'owner' },
    ]);
    expect(zipBlob.type).toBe('application/zip');
    expect(zipBlob.size).toBeGreaterThan(100);
  });

  it('merges Notelet backup JSON without duplicating existing IDs', () => {
    const existing = createEmptyNote();
    existing.id = 'note-1';
    existing.title = 'Existing';
    existing.created_at = '2026-11-20T09:00:00Z';

    const incomingNew = createEmptyNote();
    incomingNew.id = 'note-2';
    incomingNew.title = 'Restored';
    incomingNew.created_at = '2026-11-21T09:00:00Z';

    const current: AppDataSnapshot = {
      notes: [existing],
      folders: [{ id: 'meeting', name: '会議', is_shared: false, permission: 'owner' }],
      dictionary: [],
      recipes: [],
      settings: {} as AppDataSnapshot['settings'],
      audit_logs: [],
    };

    const backupJson = JSON.stringify({
      notes: [existing, incomingNew],
      folders: [{ id: 'proj', name: 'プロジェクト', is_shared: false, permission: 'owner' }],
      dictionary: [{ id: 'd1', term: 'Notelet', reading: 'ノートレット', note: '', scope: 'personal' }],
    });

    const result = mergeNoteletBackupJson(backupJson, current);
    expect(result.addedNotes).toBe(1);
    expect(result.updatedNotes).toBe(1);
    expect(result.addedFolders).toBe(1);
    expect(result.addedDictionary).toBe(1);
    expect(result.snapshot.notes).toHaveLength(2);
    expect(result.snapshot.notes[0].id).toBe('note-2');
  });
});
