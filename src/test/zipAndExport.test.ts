import { describe, expect, it } from 'vitest';
import { createEmptyNote } from '../lib/format';
import {
  escapeYaml,
  exportNotesAsObsidianZip,
  mergeNoteletBackupJson,
  noteToObsidianMarkdown,
  sanitizeFileName,
} from '../lib/noteExportImport';
import { createZipBytes, unzipTextFiles } from '../lib/zip';
import { AppDataSnapshot, PopupChatSession } from '../types';

const toArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

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

  it('escapes YAML control characters and Windows reserved file names', () => {
    expect(escapeYaml('line1\nline2\r\t')).toBe('"line1\\nline2\\r\\t"');
    expect(escapeYaml('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(sanitizeFileName('CON')).toBe('_CON');
    expect(sanitizeFileName('lpt1.txt')).toBe('_lpt1.txt');
    expect(sanitizeFileName('..')).toBe('note');
    expect(sanitizeFileName('...')).toBe('note');

    const note = createEmptyNote();
    note.title = 'safe\ninjected: true';
    const md = noteToObsidianMarkdown(note);
    const frontmatter = md.split('---')[1];
    expect(frontmatter).toContain('title: "safe\\ninjected: true"');
    expect(frontmatter).not.toMatch(/^injected:/m);
  });

  it('rejects ZIP bombs and archives above the entry limit', async () => {
    const eocd = new Uint8Array(22);
    const view = new DataView(eocd.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint16(10, 3000, true);
    await expect(unzipTextFiles(toArrayBuffer(eocd))).rejects.toThrow(/エントリ数が上限/);

    const bytes = createZipBytes([{ name: 'a.txt', content: 'hello' }]);
    // 内容を改ざんして CRC 不一致を検出できることを確認する。
    const tampered = bytes.slice();
    tampered[35] = 0x7a;
    await expect(unzipTextFiles(toArrayBuffer(tampered))).rejects.toThrow(/CRC/);
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

    const existingChat: PopupChatSession = {
      id: 'chat-1',
      scopeKey: 'note:note-1',
      title: 'Current chat',
      updatedAt: '2026-11-20T09:00:00Z',
      messages: [],
    };
    const currentOnlyChat: PopupChatSession = {
      id: 'chat-current-only',
      scopeKey: 'note:note-3',
      title: 'Keep current chat',
      updatedAt: '2026-11-19T09:00:00Z',
      messages: [],
    };
    const updatedChat: PopupChatSession = { ...existingChat, title: 'Restored chat' };
    const addedChat: PopupChatSession = {
      id: 'chat-2',
      scopeKey: 'note:note-2',
      title: 'New chat',
      updatedAt: '2026-11-21T09:00:00Z',
      messages: [],
    };

    const current: AppDataSnapshot = {
      notes: [existing],
      folders: [{ id: 'meeting', name: '会議', is_shared: false, permission: 'owner' }],
      dictionary: [],
      recipes: [],
      settings: {} as AppDataSnapshot['settings'],
      audit_logs: [],
      popup_chat_sessions: [existingChat, currentOnlyChat],
    };

    const backupJson = JSON.stringify({
      notes: [existing, incomingNew],
      folders: [{ id: 'proj', name: 'プロジェクト', is_shared: false, permission: 'owner' }],
      dictionary: [{ id: 'd1', term: 'Notelet', reading: 'ノートレット', note: '', scope: 'personal' }],
      popup_chat_sessions: [updatedChat, addedChat],
    });

    const result = mergeNoteletBackupJson(backupJson, current);
    expect(result.addedNotes).toBe(1);
    expect(result.updatedNotes).toBe(1);
    expect(result.addedFolders).toBe(1);
    expect(result.addedDictionary).toBe(1);
    expect(result.snapshot.notes).toHaveLength(2);
    expect(result.snapshot.notes[0].id).toBe('note-2');
    expect(result.snapshot.popup_chat_sessions).toEqual([updatedChat, currentOnlyChat, addedChat]);
  });
});
