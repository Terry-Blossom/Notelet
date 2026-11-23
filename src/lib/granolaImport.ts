import { ActionItem, Note, TranscriptSegment } from '../types';

export interface GranolaImportFileInput {
  name: string;
  content: string;
}

export interface GranolaImportParseResult {
  notes: Note[];
  skippedDuplicates: number;
  warnings: string[];
}

export interface GranolaImportOptions {
  folderId?: string;
  existingNotes?: Note[];
}

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeIsoDate(raw: unknown, fallbackIso: string): string {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return fallbackIso;
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      const ms = num > 1e12 ? num : num * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return fallbackIso;
}

function parseListField(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          const name = obj.name || obj.displayName || obj.full_name || obj.email;
          return typeof name === 'string' ? name.trim() : '';
        }
        return '';
      })
      .filter(Boolean);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parseListField(parsed);
      } catch {
        // fallback to delimiter split
      }
    }
    return trimmed
      .split(/[,;、\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

function extractDecisionsAndActions(markdown: string): {
  decisions: string[];
  actionItems: ActionItem[];
} {
  const decisions: string[] = [];
  const actionItems: ActionItem[] = [];
  const lines = markdown.split(/\r?\n/);
  let section: 'none' | 'decisions' | 'actions' = 'none';

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,4}\s+/.test(trimmed)) {
      const heading = trimmed.replace(/^#{1,4}\s+/, '').toLowerCase();
      if (/decision|決定事項|合意/.test(heading)) {
        section = 'decisions';
      } else if (/action|next step|todo|task|アクション|宿題|タスク/.test(heading)) {
        section = 'actions';
      } else {
        section = 'none';
      }
      continue;
    }

    const checkboxMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (checkboxMatch) {
      actionItems.push({
        id: makeId('act'),
        text: checkboxMatch[2].trim(),
        assignee: '',
        done: checkboxMatch[1].toLowerCase() === 'x',
      });
      continue;
    }

    const bulletMatch = trimmed.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (bulletMatch) {
      const text = bulletMatch[1].trim();
      if (section === 'decisions') {
        decisions.push(text);
      } else if (section === 'actions') {
        actionItems.push({
          id: makeId('act'),
          text,
          assignee: '',
          done: false,
        });
      }
    }
  }

  return { decisions, actionItems };
}

function parseTimeToMs(token: string): number | null {
  const parts = token.split(':').map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) return null;
  if (parts.length === 2) {
    return (parts[0] * 60 + parts[1]) * 1000;
  }
  if (parts.length === 3) {
    return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  }
  return null;
}

function parseTranscriptTextToSegments(raw: string): TranscriptSegment[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const segments: TranscriptSegment[] = [];
  let cursorMs = 0;

  for (const line of lines) {
    // e.g. "[00:12] Speaker: text" or "00:12 - Speaker: text" or "Speaker: text"
    const tsSpeakerMatch = line.match(
      /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*(?:-\s*)?([^:：]{1,40})[:：]\s*(.+)$/
    );
    if (tsSpeakerMatch) {
      const ms = parseTimeToMs(tsSpeakerMatch[1]) ?? cursorMs;
      cursorMs = Math.max(cursorMs, ms);
      segments.push({
        id: makeId('seg'),
        start_ms: ms,
        end_ms: ms + 4000,
        speaker: tsSpeakerMatch[2].trim() || '話者',
        text: tsSpeakerMatch[3].trim(),
      });
      cursorMs = ms + 4000;
      continue;
    }

    const tsOnlyMatch = line.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s+(.+)$/);
    if (tsOnlyMatch) {
      const ms = parseTimeToMs(tsOnlyMatch[1]) ?? cursorMs;
      segments.push({
        id: makeId('seg'),
        start_ms: ms,
        end_ms: ms + 4000,
        speaker: '話者',
        text: tsOnlyMatch[2].trim(),
      });
      cursorMs = ms + 4000;
      continue;
    }

    const speakerOnlyMatch = line.match(/^([A-Za-z0-9_\u3040-\u30ff\u4e00-\u9faf\s]{1,32})[:：]\s+(.+)$/);
    if (speakerOnlyMatch && !/^https?$/i.test(speakerOnlyMatch[1].trim())) {
      segments.push({
        id: makeId('seg'),
        start_ms: cursorMs,
        end_ms: cursorMs + 4000,
        speaker: speakerOnlyMatch[1].trim(),
        text: speakerOnlyMatch[2].trim(),
      });
      cursorMs += 4000;
      continue;
    }

    segments.push({
      id: makeId('seg'),
      start_ms: cursorMs,
      end_ms: cursorMs + 4000,
      speaker: '話者',
      text: line,
    });
    cursorMs += 4000;
  }

  return segments;
}

/**
 * Convert Granola ProseMirror JSON document to Markdown.
 */
export function prosemirrorToMarkdown(node: unknown, listDepth = 0): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as Record<string, unknown>;
  const type = typeof n.type === 'string' ? n.type : '';
  const content = Array.isArray(n.content) ? n.content : [];
  const attrs = (n.attrs && typeof n.attrs === 'object' ? n.attrs : {}) as Record<string, unknown>;

  if (type === 'text') {
    let text = typeof n.text === 'string' ? n.text : '';
    const marks = Array.isArray(n.marks) ? n.marks : [];
    for (const mark of marks) {
      if (!mark || typeof mark !== 'object') continue;
      const m = mark as Record<string, unknown>;
      const mType = typeof m.type === 'string' ? m.type : '';
      if (mType === 'bold' || mType === 'strong') {
        text = `**${text}**`;
      } else if (mType === 'italic' || mType === 'em') {
        text = `*${text}*`;
      } else if (mType === 'code') {
        text = `\`${text}\``;
      } else if (mType === 'strike') {
        text = `~~${text}~~`;
      } else if (mType === 'link') {
        const mAttrs = (m.attrs && typeof m.attrs === 'object' ? m.attrs : {}) as Record<string, unknown>;
        const href = typeof mAttrs.href === 'string' ? mAttrs.href : '';
        if (href) text = `[${text}](${href})`;
      }
    }
    return text;
  }

  if (type === 'hardBreak') return '\n';
  if (type === 'horizontalRule') return '\n---\n';

  if (type === 'doc') {
    return content
      .map((child) => prosemirrorToMarkdown(child, listDepth))
      .filter((s) => s.trim().length > 0)
      .join('\n\n')
      .trim();
  }

  if (type === 'heading') {
    const level = typeof attrs.level === 'number' ? Math.min(Math.max(attrs.level, 1), 6) : 2;
    const inner = content.map((child) => prosemirrorToMarkdown(child, listDepth)).join('').trim();
    return `${'#'.repeat(level)} ${inner}`;
  }

  if (type === 'paragraph') {
    return content.map((child) => prosemirrorToMarkdown(child, listDepth)).join('').trim();
  }

  if (type === 'bulletList' || type === 'orderedList') {
    const ordered = type === 'orderedList';
    const start = typeof attrs.start === 'number' ? attrs.start : 1;
    const indent = '  '.repeat(listDepth);
    return content
      .map((item, idx) => {
        if (!item || typeof item !== 'object') return '';
        const itemObj = item as Record<string, unknown>;
        const itemContent = Array.isArray(itemObj.content) ? itemObj.content : [];
        const prefix = ordered ? `${start + idx}. ` : '- ';
        const renderedChildren = itemContent
          .map((child) => {
            const childObj = child as Record<string, unknown>;
            if (childObj?.type === 'bulletList' || childObj?.type === 'orderedList') {
              return '\n' + prosemirrorToMarkdown(child, listDepth + 1);
            }
            return prosemirrorToMarkdown(child, listDepth);
          })
          .join('\n')
          .trim();
        return `${indent}${prefix}${renderedChildren}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  if (type === 'taskList') {
    const indent = '  '.repeat(listDepth);
    return content
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const itemObj = item as Record<string, unknown>;
        const itemAttrs = (itemObj.attrs && typeof itemObj.attrs === 'object' ? itemObj.attrs : {}) as Record<string, unknown>;
        const checked = Boolean(itemAttrs.checked);
        const itemContent = Array.isArray(itemObj.content) ? itemObj.content : [];
        const text = itemContent.map((c) => prosemirrorToMarkdown(c, listDepth)).join(' ').trim();
        return `${indent}- [${checked ? 'x' : ' '}] ${text}`;
      })
      .filter(Boolean)
      .join('\n');
  }

  if (type === 'blockquote') {
    const inner = content.map((c) => prosemirrorToMarkdown(c, listDepth)).join('\n');
    return inner
      .split('\n')
      .map((l) => `> ${l}`)
      .join('\n');
  }

  if (type === 'codeBlock') {
    const lang = typeof attrs.language === 'string' ? attrs.language : '';
    const inner = content.map((c) => prosemirrorToMarkdown(c, listDepth)).join('');
    return `\`\`\`${lang}\n${inner}\n\`\`\``;
  }

  return content.map((c) => prosemirrorToMarkdown(c, listDepth)).join('');
}

function buildNote(params: {
  granolaId?: string;
  title: string;
  createdAt: string;
  updatedAt?: string;
  folderId: string;
  participants: string[];
  manualNotes: string;
  summary: string;
  segments: TranscriptSegment[];
  tags?: string[];
}): Note {
  const nowIso = new Date().toISOString();
  const createdAt = normalizeIsoDate(params.createdAt, nowIso);
  const updatedAt = normalizeIsoDate(params.updatedAt ?? createdAt, createdAt);
  const lastEndMs = params.segments.reduce((max, s) => Math.max(max, s.end_ms), 0);
  const durationSec = Math.max(0, Math.round(lastEndMs / 1000));
  const { decisions, actionItems } = extractDecisionsAndActions(params.summary);

  const tags = Array.from(
    new Set([
      'granola-import',
      ...(params.granolaId ? [`granola:${params.granolaId}`] : []),
      ...(params.tags ?? []),
    ])
  );

  return {
    id: makeId('note'),
    title: params.title.trim() || '無題のノート（Granola）',
    created_at: createdAt,
    updated_at: updatedAt,
    duration_sec: durationSec,
    folder_id: params.folderId,
    tags,
    participants: Array.from(new Set(params.participants.filter(Boolean))),
    manual_notes: params.manualNotes.trim(),
    segments: params.segments,
    summary: params.summary.trim(),
    decisions,
    action_items: actionItems,
    follow_up_draft: '',
    asr_model_id: 'granola-import',
    asr_provider_label: 'Granola インポート',
    language: 'auto',
    diarization_supported: params.segments.some((s) => s.speaker && s.speaker !== '話者'),
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

/**
 * RFC 4180 compliant CSV parser supporting multiline quoted fields and escaped quotes.
 */
function parseCsvRows(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (cleaned[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function parseGranolaCsv(content: string, folderId: string): { notes: Note[]; warnings: string[] } {
  const rows = parseCsvRows(content);
  if (rows.length < 2) {
    return { notes: [], warnings: ['CSV にデータ行が含まれていません。'] };
  }

  const headers = rows[0].map((h) =>
    h
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_')
  );

  const findCol = (candidates: string[]): number => {
    for (const c of candidates) {
      const idx = headers.indexOf(c);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idIdx = findCol(['id', 'note_id', 'document_id', 'meeting_id']);
  const titleIdx = findCol(['title', 'meeting_title', 'name', 'subject']);
  const createdIdx = findCol(['created_at', 'date', 'meeting_date', 'start_time', 'started_at', 'created']);
  const updatedIdx = findCol(['updated_at', 'updated']);
  const participantsIdx = findCol(['participants', 'attendees', 'people', 'members']);
  const summaryIdx = findCol([
    'summary',
    'ai_notes',
    'notes_markdown',
    'enhanced_notes',
    'notes',
    'content',
    'body',
  ]);
  const manualIdx = findCol(['manual_notes', 'user_notes', 'notes_plain', 'raw_notes', 'my_notes']);
  const transcriptIdx = findCol(['transcript', 'transcripts', 'raw_transcript', 'full_transcript']);
  const tagsIdx = findCol(['tags', 'folder', 'folders', 'labels']);

  const notes: Note[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    const get = (idx: number) => (idx >= 0 && idx < r.length ? r[idx].trim() : '');

    const title = get(titleIdx) || `Granola ノート #${i}`;
    const summary = get(summaryIdx);
    const manualNotes = get(manualIdx);
    const transcriptRaw = get(transcriptIdx);

    if (!title && !summary && !manualNotes && !transcriptRaw) continue;

    let segments: TranscriptSegment[] = [];
    if (transcriptRaw) {
      if (transcriptRaw.startsWith('[')) {
        try {
          const parsed = JSON.parse(transcriptRaw);
          if (Array.isArray(parsed)) {
            segments = parseTranscriptArray(parsed, get(createdIdx));
          }
        } catch {
          segments = parseTranscriptTextToSegments(transcriptRaw);
        }
      } else {
        segments = parseTranscriptTextToSegments(transcriptRaw);
      }
    }

    notes.push(
      buildNote({
        granolaId: get(idIdx) || undefined,
        title,
        createdAt: get(createdIdx) || new Date().toISOString(),
        updatedAt: get(updatedIdx) || undefined,
        folderId,
        participants: parseListField(get(participantsIdx)),
        manualNotes,
        summary,
        segments,
        tags: parseListField(get(tagsIdx)),
      })
    );
  }

  return { notes, warnings: [] };
}

function parseTranscriptArray(rawArr: unknown[], baseCreatedAt?: string): TranscriptSegment[] {
  const baseMs = baseCreatedAt ? Date.parse(baseCreatedAt) : NaN;
  const segments: TranscriptSegment[] = [];
  let cursorMs = 0;

  for (const item of rawArr) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const text =
      (typeof obj.text === 'string' ? obj.text : '') ||
      (typeof obj.content === 'string' ? obj.content : '') ||
      (typeof obj.utterance === 'string' ? obj.utterance : '');
    if (!text.trim()) continue;

    let startMs = cursorMs;
    if (typeof obj.start_ms === 'number') {
      startMs = obj.start_ms;
    } else if (typeof obj.start_time === 'number') {
      startMs = obj.start_time > 1e6 ? obj.start_time : obj.start_time * 1000;
    } else if (typeof obj.start_timestamp === 'string') {
      const parsed = Date.parse(obj.start_timestamp);
      if (!Number.isNaN(parsed)) {
        startMs = !Number.isNaN(baseMs) ? Math.max(0, parsed - baseMs) : 0;
      }
    }

    let endMs = startMs + 4000;
    if (typeof obj.end_ms === 'number') {
      endMs = Math.max(startMs + 500, obj.end_ms);
    } else if (typeof obj.end_time === 'number') {
      const rawEnd = obj.end_time > 1e6 ? obj.end_time : obj.end_time * 1000;
      endMs = Math.max(startMs + 500, rawEnd);
    } else if (typeof obj.end_timestamp === 'string') {
      const parsed = Date.parse(obj.end_timestamp);
      if (!Number.isNaN(parsed) && !Number.isNaN(baseMs)) {
        endMs = Math.max(startMs + 500, parsed - baseMs);
      }
    }

    let speaker = '話者';
    if (typeof obj.speaker === 'string' && obj.speaker.trim()) {
      speaker = obj.speaker.trim();
    } else if (typeof obj.source === 'string') {
      speaker = obj.source === 'microphone' ? '自分' : obj.source === 'system' ? '相手' : obj.source;
    }

    segments.push({
      id: makeId('seg'),
      start_ms: Math.max(0, Math.round(startMs)),
      end_ms: Math.max(0, Math.round(endMs)),
      speaker,
      text: text.trim(),
    });
    cursorMs = Math.max(cursorMs, endMs);
  }

  return segments;
}

function unwrapGranolaCache(rawObj: unknown, depth = 0): unknown {
  if (depth > 3 || !rawObj || typeof rawObj !== 'object') return rawObj;
  const obj = rawObj as Record<string, unknown>;
  if (typeof obj.cache === 'string') {
    try {
      const inner = JSON.parse(obj.cache);
      return unwrapGranolaCache(inner, depth + 1);
    } catch {
      return rawObj;
    }
  }
  if (obj.cache && typeof obj.cache === 'object') {
    return unwrapGranolaCache(obj.cache, depth + 1);
  }
  if (obj.state && typeof obj.state === 'object') {
    return obj.state;
  }
  return rawObj;
}

function extractProseMirrorOrString(val: unknown): string {
  if (typeof val === 'string') return val.trim();
  if (val && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (obj.type === 'doc') {
      return prosemirrorToMarkdown(obj);
    }
    if (obj.content && typeof obj.content === 'object') {
      return extractProseMirrorOrString(obj.content);
    }
  }
  return '';
}

function parseGranolaJson(content: string, folderId: string): { notes: Note[]; warnings: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch (err) {
    return {
      notes: [],
      warnings: [`JSON の解析に失敗しました: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const root = unwrapGranolaCache(parsed);
  const warnings: string[] = [];

  if (root && typeof root === 'object' && !Array.isArray(root)) {
    const rootObj = root as Record<string, unknown>;
    if (rootObj.encrypted === true || (typeof rootObj.ciphertext === 'string' && !rootObj.documents)) {
      warnings.push(
        'この Granola ファイルは暗号化されているため直接読み込めません。Granola の Settings > Profile > Generate CSV から CSV をエクスポートしてインポートしてください。'
      );
      return { notes: [], warnings };
    }
  }

  let docList: Record<string, unknown>[] = [];
  let transcriptsMap: Record<string, unknown[]> = {};

  if (Array.isArray(root)) {
    docList = root.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  } else if (root && typeof root === 'object') {
    const obj = root as Record<string, unknown>;
    const rawDocs = obj.documents ?? obj.notes ?? obj.meetings;
    const rawTranscripts = obj.transcripts;

    if (rawTranscripts && typeof rawTranscripts === 'object' && !Array.isArray(rawTranscripts)) {
      transcriptsMap = rawTranscripts as Record<string, unknown[]>;
    }

    if (Array.isArray(rawDocs)) {
      docList = rawDocs.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
    } else if (rawDocs && typeof rawDocs === 'object') {
      docList = Object.entries(rawDocs as Record<string, unknown>)
        .filter(([, val]) => Boolean(val && typeof val === 'object'))
        .map(([key, val]) => ({ id: key, ...(val as Record<string, unknown>) }));
    } else if ('title' in obj || 'notes_markdown' in obj || 'notes' in obj || 'summary' in obj) {
      docList = [obj];
    }
  }

  const notes: Note[] = [];
  for (const doc of docList) {
    if (doc.deleted_at) continue;

    const docId = typeof doc.id === 'string' ? doc.id : undefined;
    const title =
      (typeof doc.title === 'string' ? doc.title : '') ||
      (doc.google_calendar_event &&
      typeof doc.google_calendar_event === 'object' &&
      typeof (doc.google_calendar_event as Record<string, unknown>).summary === 'string'
        ? ((doc.google_calendar_event as Record<string, unknown>).summary as string)
        : '') ||
      '無題のノート（Granola）';

    const createdAt =
      (doc.created_at as string | number | undefined) ||
      (doc.google_calendar_event &&
      typeof doc.google_calendar_event === 'object' &&
      ((doc.google_calendar_event as Record<string, unknown>).start as Record<string, unknown> | undefined)
        ?.dateTime) ||
      new Date().toISOString();

    const updatedAt = (doc.updated_at as string | number | undefined) ?? undefined;

    // Summary / AI notes
    let summary =
      (typeof doc.notes_markdown === 'string' ? doc.notes_markdown : '') ||
      (typeof doc.summary === 'string' ? doc.summary : '') ||
      (typeof doc.overview === 'string' ? doc.overview : '');

    if (!summary && doc.last_viewed_panel && typeof doc.last_viewed_panel === 'object') {
      const panel = doc.last_viewed_panel as Record<string, unknown>;
      summary = extractProseMirrorOrString(panel.content ?? panel);
    }
    if (!summary && doc.notes) {
      summary = extractProseMirrorOrString(doc.notes);
    }

    const manualNotes =
      (typeof doc.notes_plain === 'string' ? doc.notes_plain : '') ||
      (typeof doc.manual_notes === 'string' ? doc.manual_notes : '');

    // Participants
    let participants = parseListField(doc.participants ?? doc.attendees);
    if (participants.length === 0 && doc.people && typeof doc.people === 'object') {
      const people = doc.people as Record<string, unknown>;
      participants = parseListField(people.attendees);
    }
    if (
      participants.length === 0 &&
      doc.google_calendar_event &&
      typeof doc.google_calendar_event === 'object'
    ) {
      const gcal = doc.google_calendar_event as Record<string, unknown>;
      participants = parseListField(gcal.attendees);
    }

    // Transcript
    let segments: TranscriptSegment[] = [];
    const docTranscript =
      (docId && Array.isArray(transcriptsMap[docId]) ? transcriptsMap[docId] : null) ??
      (Array.isArray(doc.transcript) ? doc.transcript : null) ??
      (Array.isArray(doc.transcripts) ? doc.transcripts : null);

    if (docTranscript) {
      segments = parseTranscriptArray(docTranscript, typeof createdAt === 'string' ? createdAt : undefined);
    } else if (typeof doc.transcript === 'string') {
      segments = parseTranscriptTextToSegments(doc.transcript);
    }

    notes.push(
      buildNote({
        granolaId: docId,
        title,
        createdAt: String(createdAt),
        updatedAt: updatedAt !== undefined ? String(updatedAt) : undefined,
        folderId,
        participants,
        manualNotes: manualNotes === summary ? '' : manualNotes,
        summary,
        segments,
        tags: parseListField(doc.tags),
      })
    );
  }

  if (notes.length === 0 && warnings.length === 0) {
    warnings.push('JSON 内にインポート可能な Granola ノートが見つかりませんでした。');
  }

  return { notes, warnings };
}

function parseGranolaMarkdown(fileName: string, content: string, folderId: string): Note[] {
  const cleaned = content.replace(/^\uFEFF/, '');
  let body = cleaned;
  let title = '';
  let createdAt = new Date().toISOString();
  let updatedAt: string | undefined;
  let granolaId: string | undefined;
  let participants: string[] = [];
  let tags: string[] = [];

  // Parse YAML frontmatter if present
  const fmMatch = cleaned.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (fmMatch) {
    const fm = fmMatch[1];
    body = fmMatch[2];
    const lines = fm.split(/\r?\n/);
    let currentArrayKey: string | null = null;
    const arrayAccum: Record<string, string[]> = {};

    for (const line of lines) {
      const arrItem = line.match(/^\s+-\s+(.+)$/);
      if (arrItem && currentArrayKey) {
        arrayAccum[currentArrayKey] = arrayAccum[currentArrayKey] || [];
        arrayAccum[currentArrayKey].push(arrItem[1].trim().replace(/^["']|["']$/g, ''));
        continue;
      }
      const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!kv) {
        currentArrayKey = null;
        continue;
      }
      const key = kv[1].toLowerCase();
      const val = kv[2].trim().replace(/^["']|["']$/g, '');
      currentArrayKey = val === '' ? key : null;

      if (key === 'id' || key === 'granola_id') granolaId = val;
      else if (key === 'title') title = val;
      else if (key === 'created' || key === 'created_at' || key === 'date') createdAt = val;
      else if (key === 'updated' || key === 'updated_at') updatedAt = val;
      else if (key === 'participants' || key === 'attendees') participants = parseListField(val);
      else if (key === 'tags') tags = parseListField(val);
    }

    if (arrayAccum.participants?.length) participants = arrayAccum.participants;
    if (arrayAccum.attendees?.length && participants.length === 0) participants = arrayAccum.attendees;
    if (arrayAccum.tags?.length) tags = arrayAccum.tags;
  }

  // Split summary vs transcript sections
  const lines = body.split(/\r?\n/);
  const summaryLines: string[] = [];
  const transcriptLines: string[] = [];
  let inTranscript = false;

  for (const line of lines) {
    if (!title) {
      const h1 = line.match(/^#\s+(.+)$/);
      if (h1) {
        title = h1[1].trim();
        continue;
      }
    }
    if (/^#{1,3}\s+(?:transcript|full transcript|文字起こし|トランスクリプト)/i.test(line.trim())) {
      inTranscript = true;
      continue;
    }
    if (inTranscript && /^#{1,2}\s+/.test(line.trim())) {
      inTranscript = false;
    }
    if (inTranscript) {
      transcriptLines.push(line);
    } else {
      summaryLines.push(line);
    }
  }

  if (!title) {
    title = fileName.replace(/\.(md|markdown|txt)$/i, '').replace(/[_-]+/g, ' ').trim() || '無題のノート';
  }

  const summary = summaryLines.join('\n').trim();
  const segments = parseTranscriptTextToSegments(transcriptLines.join('\n'));

  return [
    buildNote({
      granolaId,
      title,
      createdAt,
      updatedAt,
      folderId,
      participants,
      manualNotes: '',
      summary,
      segments,
      tags,
    }),
  ];
}

function isDuplicateNote(candidate: Note, existing: Note[]): boolean {
  const candidateGranolaTag = candidate.tags.find((t) => t.startsWith('granola:'));
  const candidateCreatedMs = Date.parse(candidate.created_at);

  return existing.some((ex) => {
    if (candidateGranolaTag && ex.tags.includes(candidateGranolaTag)) {
      return true;
    }
    if (ex.title.trim().toLowerCase() === candidate.title.trim().toLowerCase()) {
      const exMs = Date.parse(ex.created_at);
      if (!Number.isNaN(candidateCreatedMs) && !Number.isNaN(exMs)) {
        return Math.abs(exMs - candidateCreatedMs) < 60_000;
      }
      return ex.created_at === candidate.created_at;
    }
    return false;
  });
}

export function parseGranolaImportFiles(
  files: GranolaImportFileInput[],
  options: GranolaImportOptions = {}
): GranolaImportParseResult {
  const folderId = options.folderId ?? 'meeting';
  const existingNotes = options.existingNotes ?? [];

  const allCandidates: Note[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const lowerName = file.name.toLowerCase();
    const trimmed = file.content.replace(/^\uFEFF/, '').trim();
    if (!trimmed) {
      warnings.push(`${file.name}: ファイルが空です。`);
      continue;
    }

    if (lowerName.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
      const res = parseGranolaJson(trimmed, folderId);
      allCandidates.push(...res.notes);
      warnings.push(...res.warnings.map((w) => `${file.name}: ${w}`));
    } else if (lowerName.endsWith('.csv')) {
      const res = parseGranolaCsv(trimmed, folderId);
      allCandidates.push(...res.notes);
      warnings.push(...res.warnings.map((w) => `${file.name}: ${w}`));
    } else {
      const mdNotes = parseGranolaMarkdown(file.name, trimmed, folderId);
      allCandidates.push(...mdNotes);
    }
  }

  const dedupedNotes: Note[] = [];
  let skippedDuplicates = 0;

  for (const note of allCandidates) {
    if (isDuplicateNote(note, [...existingNotes, ...dedupedNotes])) {
      skippedDuplicates += 1;
    } else {
      dedupedNotes.push(note);
    }
  }

  return {
    notes: dedupedNotes,
    skippedDuplicates,
    warnings,
  };
}
