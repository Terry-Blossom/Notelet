import { AppDataSnapshot, DictionaryEntry, Folder, Note, Recipe } from '../types';
import { formatMs } from './format';
import { createZipBlob, ZipTextEntry } from './zip';

function escapeYaml(val: string): string {
  return `"${val.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80)
    .replace(/^_+|_+$/g, '') || 'note';
}

export function noteToObsidianMarkdown(note: Note, folderName?: string): string {
  const title = note.title.trim() || '無題のノート';
  const lines: string[] = [
    '---',
    `id: ${escapeYaml(note.id)}`,
    `title: ${escapeYaml(title)}`,
    `created: ${escapeYaml(note.created_at)}`,
    `updated: ${escapeYaml(note.updated_at)}`,
    `duration_sec: ${note.duration_sec}`,
  ];
  if (folderName) {
    lines.push(`folder: ${escapeYaml(folderName)}`);
  }
  if (note.tags.length > 0) {
    lines.push('tags:');
    for (const tag of note.tags) {
      lines.push(`  - ${escapeYaml(tag)}`);
    }
  }
  if (note.participants.length > 0) {
    lines.push('participants:');
    for (const p of note.participants) {
      lines.push(`  - ${escapeYaml(p)}`);
    }
  }
  lines.push('---', '', `# ${title}`, '');

  if (note.summary.trim()) {
    lines.push('## 要約', '', note.summary.trim(), '');
  }
  if (note.decisions.length > 0) {
    lines.push('## 決定事項', '');
    for (const d of note.decisions) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }
  if (note.action_items.length > 0) {
    lines.push('## アクション項目', '');
    for (const a of note.action_items) {
      lines.push(`- [${a.done ? 'x' : ' '}] ${a.text}${a.assignee ? ` (@${a.assignee})` : ''}`);
    }
    lines.push('');
  }
  const cleanMemo = note.manual_notes.replace(/<[^>]*>/g, '').trim();
  if (cleanMemo) {
    lines.push('## メモ', '', cleanMemo, '');
  }
  if (note.segments.length > 0) {
    lines.push('## 文字起こし', '');
    for (const seg of note.segments) {
      lines.push(`- [${formatMs(seg.start_ms)}] **${seg.speaker || '話者'}**: ${seg.text}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function exportNotesAsObsidianZip(notes: Note[], folders: Folder[]): Blob {
  const folderMap = new Map(folders.map((f) => [f.id, f.name]));
  const usedNames = new Set<string>();
  const entries: ZipTextEntry[] = [];

  for (const note of notes) {
    const datePrefix = note.created_at ? note.created_at.slice(0, 10) : 'undated';
    const baseName = `${datePrefix}_${sanitizeFileName(note.title || 'note')}`;
    let fileName = `${baseName}.md`;
    let suffix = 2;
    while (usedNames.has(fileName)) {
      fileName = `${baseName}_${suffix}.md`;
      suffix += 1;
    }
    usedNames.add(fileName);

    entries.push({
      name: fileName,
      content: noteToObsidianMarkdown(note, folderMap.get(note.folder_id)),
    });
  }

  return createZipBlob(entries);
}

export interface BackupRestoreResult {
  snapshot: AppDataSnapshot;
  addedNotes: number;
  updatedNotes: number;
  addedFolders: number;
  addedDictionary: number;
}

export function mergeKoeNoteBackupJson(
  jsonText: string,
  current: AppDataSnapshot
): BackupRestoreResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error(`JSON バックアップの解析に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('有効な Notelet バックアップ JSON オブジェクトではありません。');
  }

  const obj = parsed as Partial<AppDataSnapshot>;
  if (!Array.isArray(obj.notes)) {
    throw new Error('バックアップ JSON に notes 配列が含まれていません。');
  }

  const incomingNotes = obj.notes.filter((n): n is Note => Boolean(n && typeof n === 'object' && typeof n.id === 'string'));
  const existingNoteMap = new Map(current.notes.map((n) => [n.id, n]));
  let addedNotes = 0;
  let updatedNotes = 0;

  for (const note of incomingNotes) {
    if (existingNoteMap.has(note.id)) {
      updatedNotes += 1;
    } else {
      addedNotes += 1;
    }
    existingNoteMap.set(note.id, note);
  }

  const mergedNotes = Array.from(existingNoteMap.values()).sort(
    (a, b) => Date.parse(b.created_at || '') - Date.parse(a.created_at || '')
  );

  const folderMap = new Map(current.folders.map((f) => [f.id, f]));
  let addedFolders = 0;
  if (Array.isArray(obj.folders)) {
    for (const f of obj.folders) {
      if (f && typeof f === 'object' && typeof (f as Folder).id === 'string' && !folderMap.has((f as Folder).id)) {
        folderMap.set((f as Folder).id, f as Folder);
        addedFolders += 1;
      }
    }
  }

  const dictMap = new Map(current.dictionary.map((d) => [d.id, d]));
  let addedDictionary = 0;
  if (Array.isArray(obj.dictionary)) {
    for (const d of obj.dictionary) {
      if (d && typeof d === 'object' && typeof (d as DictionaryEntry).id === 'string' && !dictMap.has((d as DictionaryEntry).id)) {
        dictMap.set((d as DictionaryEntry).id, d as DictionaryEntry);
        addedDictionary += 1;
      }
    }
  }

  const recipeMap = new Map(current.recipes.map((r) => [r.id, r]));
  if (Array.isArray(obj.recipes)) {
    for (const r of obj.recipes) {
      if (r && typeof r === 'object' && typeof (r as Recipe).id === 'string' && !recipeMap.has((r as Recipe).id)) {
        recipeMap.set((r as Recipe).id, r as Recipe);
      }
    }
  }

  return {
    snapshot: {
      ...current,
      notes: mergedNotes,
      folders: Array.from(folderMap.values()),
      dictionary: Array.from(dictMap.values()),
      recipes: Array.from(recipeMap.values()),
    },
    addedNotes,
    updatedNotes,
    addedFolders,
    addedDictionary,
  };
}
