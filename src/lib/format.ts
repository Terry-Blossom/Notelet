import { Note } from '../types';

export function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatNoteTimer(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatMonthDay(iso: string): string {
  if (!iso) return '11月20日';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '11月20日';
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function formatDateTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatNoteForCopy(note: Note, format: 'markdown' | 'plain'): string {
  const title = note.title.trim() || '無題のノート';
  const dateStr = formatDateTime(note.created_at);

  if (format === 'plain') {
    const lines: string[] = [title, `日時: ${dateStr}`];
    if (note.participants.length > 0) {
      lines.push(`参加者: ${note.participants.join(', ')}`);
    }
    if (note.summary.trim()) {
      lines.push('', '【要約】', note.summary.trim());
    }
    if (note.decisions.length > 0) {
      lines.push('', '【決定事項】', ...note.decisions.map((d) => `・${d}`));
    }
    if (note.action_items.length > 0) {
      lines.push(
        '',
        '【アクション項目】',
        ...note.action_items.map((a) => `[${a.done ? 'x' : ' '}] ${a.text}${a.assignee ? `（${a.assignee}）` : ''}`)
      );
    }
    if (note.manual_notes.trim()) {
      lines.push('', '【手入力メモ】', note.manual_notes.trim());
    }
    if (note.segments.length > 0) {
      lines.push(
        '',
        '【文字起こし】',
        ...note.segments.map((s) => `[${formatMs(s.start_ms)}] ${s.speaker}: ${s.text}`)
      );
    }
    return lines.join('\n');
  }

  const md: string[] = [`# ${title}`, `- 日時: ${dateStr}`];
  if (note.participants.length > 0) {
    md.push(`- 参加者: ${note.participants.join(', ')}`);
  }
  if (note.summary.trim()) {
    md.push('', '## 要約', note.summary.trim());
  }
  if (note.decisions.length > 0) {
    md.push('', '## 決定事項', ...note.decisions.map((d) => `- ${d}`));
  }
  if (note.action_items.length > 0) {
    md.push(
      '',
      '## アクション項目',
      ...note.action_items.map((a) => `- [${a.done ? 'x' : ' '}] ${a.text}${a.assignee ? `（担当: ${a.assignee}）` : ''}`)
    );
  }
  if (note.manual_notes.trim()) {
    md.push('', '## 手入力メモ', note.manual_notes.trim());
  }
  if (note.segments.length > 0) {
    md.push(
      '',
      '## 文字起こし',
      ...note.segments.map((s) => `- \`${formatMs(s.start_ms)}\` **${s.speaker}**: ${s.text}`)
    );
  }
  return md.join('\n');
}

export function createEmptyNote(folderId = 'personal'): Note {
  const now = new Date();
  const label = now.toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return {
    id: crypto.randomUUID(),
    title: `録音ノート ${label}`,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    duration_sec: 0,
    folder_id: folderId,
    tags: [],
    participants: [],
    manual_notes: '',
    segments: [],
    summary: '',
    decisions: [],
    action_items: [],
    follow_up_draft: '',
    asr_model_id: '',
    asr_provider_label: '未文字起こし',
    language: 'ja',
    diarization_supported: false,
    notion_sync: {
      page_id: null,
      page_url: null,
      database_id: null,
      last_synced_at: null,
      status: 'not_synced',
      last_error: null,
    },
    audio_path: null,
    audio_encrypted: false,
  };
}

export interface NoteSearchMatch {
  source: string;
  before: string;
  match: string;
  after: string;
}

function stripHtmlForSearch(raw: string): string {
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildSnippetAround(text: string, qLower: string): { before: string; match: string; after: string } | null {
  const clean = stripHtmlForSearch(text);
  if (!clean) return null;
  const idx = clean.toLowerCase().indexOf(qLower);
  if (idx === -1) return null;
  const start = Math.max(0, idx - 32);
  const end = Math.min(clean.length, idx + qLower.length + 48);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < clean.length ? '…' : '';
  return {
    before: prefix + clean.slice(start, idx),
    match: clean.slice(idx, idx + qLower.length),
    after: clean.slice(idx + qLower.length, end) + suffix,
  };
}

export function findNoteSearchMatches(note: Note, query: string): NoteSearchMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: NoteSearchMatch[] = [];

  const titleHit = buildSnippetAround(note.title || '無題のノート', q);
  if (titleHit) {
    results.push({ source: 'タイトル', ...titleHit });
  }
  const summaryHit = buildSnippetAround(note.summary, q);
  if (summaryHit) {
    results.push({ source: '要約', ...summaryHit });
  }
  const memoHit = buildSnippetAround(note.manual_notes, q);
  if (memoHit) {
    results.push({ source: 'メモ', ...memoHit });
  }
  for (const seg of note.segments) {
    if (results.length >= 3) break;
    const segHit = buildSnippetAround(seg.text, q);
    if (segHit) {
      results.push({ source: `文字起こし ${formatMs(seg.start_ms)}`, ...segHit });
    }
  }
  return results;
}
