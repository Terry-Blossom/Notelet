#!/usr/bin/env node
/**
 * KoeNote / Notelet Read-Only MCP Server (stdio JSON-RPC 2.0)
 * Zero external dependencies — runs on Node.js 18+.
 *
 * Usage:
 *   node mcp-server/index.mjs [--data-dir <dir>] [--scope <scope>]
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

function parseArgs(argv) {
  let dataDir = process.env.KOENOTE_DATA_DIR || '';
  let scope = process.env.KOENOTE_MCP_SCOPE || 'workspace';
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--data-dir' && argv[i + 1]) {
      dataDir = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--scope' && argv[i + 1]) {
      scope = argv[i + 1];
      i += 1;
    }
  }
  return { dataDir, scope };
}

function resolveDataFilePath(dataDir) {
  if (process.env.KOENOTE_DATA_PATH) {
    return process.env.KOENOTE_DATA_PATH;
  }
  if (dataDir) {
    return path.join(dataDir, 'koenote_data.json');
  }
  const home = os.homedir();
  const platform = process.platform;
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'KoeNote', 'koenote_data.json');
  }
  if (platform === 'win32') {
    const appData = process.env.LOCALAPPDATA || process.env.APPDATA || path.join(home, 'AppData', 'Local');
    return path.join(appData, 'KoeNote', 'koenote_data.json');
  }
  const xdgData = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  return path.join(xdgData, 'KoeNote', 'koenote_data.json');
}

function loadSnapshot(dataFilePath, scope) {
  if (!fs.existsSync(dataFilePath)) {
    return { notes: [], folders: [], dictionary: [] };
  }
  const raw = fs.readFileSync(dataFilePath, 'utf8');
  const snap = JSON.parse(raw);
  let notes = Array.isArray(snap.notes) ? snap.notes : [];

  if (scope.startsWith('personal_30d')) {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    notes = notes.filter((n) => {
      const ts = Date.parse(n.created_at || '');
      return Number.isNaN(ts) || ts >= cutoff;
    });
  }

  return {
    notes,
    folders: Array.isArray(snap.folders) ? snap.folders : [],
    dictionary: Array.isArray(snap.dictionary) ? snap.dictionary : [],
  };
}

function formatNoteFull(note) {
  const parts = [
    `# ${note.title || '無題のノート'}`,
    `- ID: ${note.id}`,
    `- 作成日時: ${note.created_at}`,
    `- 参加者: ${(note.participants || []).join(', ') || 'なし'}`,
    `- タグ: ${(note.tags || []).join(', ') || 'なし'}`,
  ];
  if (note.summary) {
    parts.push('', '## 要約', note.summary);
  }
  if (Array.isArray(note.decisions) && note.decisions.length > 0) {
    parts.push('', '## 決定事項', ...note.decisions.map((d) => `- ${d}`));
  }
  if (Array.isArray(note.action_items) && note.action_items.length > 0) {
    parts.push(
      '',
      '## アクション項目',
      ...note.action_items.map((a) => `- [${a.done ? 'x' : ' '}] ${a.text}${a.assignee ? ` (@${a.assignee})` : ''}`)
    );
  }
  if (note.manual_notes) {
    parts.push('', '## 手入力メモ', note.manual_notes);
  }
  if (Array.isArray(note.segments) && note.segments.length > 0) {
    parts.push(
      '',
      '## 文字起こし',
      ...note.segments.map((s) => `[${s.speaker || '話者'}] ${s.text}`)
    );
  }
  return parts.join('\n');
}

const { dataDir, scope } = parseArgs(process.argv);
const dataFilePath = resolveDataFilePath(dataDir);

const TOOLS = [
  {
    name: 'list_recent_notes',
    description: 'Notelet（KoeNote）の最新ノート一覧を取得します。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '取得件数（既定 20）' },
        folder_id: { type: 'string', description: 'フォルダIDで絞り込む場合に指定' },
      },
    },
  },
  {
    name: 'search_notes',
    description: 'タイトル・要約・メモ・文字起こしからキーワードでノートを検索します。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '検索キーワード' },
        limit: { type: 'number', description: '最大返却件数（既定 10）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_note',
    description: '指定した ID のノートの詳細（要約・決定事項・アクション項目・文字起こし）を取得します。',
    inputSchema: {
      type: 'object',
      properties: {
        note_id: { type: 'string', description: 'ノート ID' },
      },
      required: ['note_id'],
    },
  },
  {
    name: 'list_folders',
    description: 'ノートフォルダ一覧を取得します。',
    inputSchema: { type: 'object', properties: {} },
  },
];

function handleRequest(req) {
  const { id, method, params } = req;

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
        },
        serverInfo: {
          name: 'koenote-mcp',
          version: '0.11.0',
        },
      },
    };
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};
    const snap = loadSnapshot(dataFilePath, scope);

    if (toolName === 'list_recent_notes') {
      const limit = Number(args.limit) > 0 ? Number(args.limit) : 20;
      let notes = snap.notes;
      if (args.folder_id) {
        notes = notes.filter((n) => n.folder_id === args.folder_id);
      }
      const items = notes.slice(0, limit).map((n) => ({
        id: n.id,
        title: n.title,
        created_at: n.created_at,
        folder_id: n.folder_id,
        participants: n.participants || [],
        tags: n.tags || [],
        has_summary: Boolean(n.summary),
        segment_count: Array.isArray(n.segments) ? n.segments.length : 0,
      }));
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(items, null, 2) }] },
      };
    }

    if (toolName === 'search_notes') {
      const q = String(args.query || '').trim().toLowerCase();
      const limit = Number(args.limit) > 0 ? Number(args.limit) : 10;
      const matches = snap.notes
        .filter((n) => {
          if (!q) return true;
          const haystack = [
            n.title || '',
            n.summary || '',
            n.manual_notes || '',
            ...(n.participants || []),
            ...(n.segments || []).map((s) => s.text || ''),
          ]
            .join('\n')
            .toLowerCase();
          return haystack.includes(q);
        })
        .slice(0, limit)
        .map((n) => ({
          id: n.id,
          title: n.title,
          created_at: n.created_at,
          summary_preview: (n.summary || '').slice(0, 300),
        }));
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(matches, null, 2) }] },
      };
    }

    if (toolName === 'get_note') {
      const note = snap.notes.find((n) => n.id === args.note_id);
      if (!note) {
        return {
          jsonrpc: '2.0',
          id,
          result: { isError: true, content: [{ type: 'text', text: `ノートが見つかりません: ${args.note_id}` }] },
        };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: formatNoteFull(note) }] },
      };
    }

    if (toolName === 'list_folders') {
      return {
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: JSON.stringify(snap.folders, null, 2) }] },
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Unknown tool: ${toolName}` },
    };
  }

  if (method === 'resources/list') {
    const snap = loadSnapshot(dataFilePath, scope);
    const resources = snap.notes.slice(0, 50).map((n) => ({
      uri: `koenote://note/${n.id}`,
      name: n.title || '無題のノート',
      mimeType: 'text/markdown',
    }));
    return { jsonrpc: '2.0', id, result: { resources } };
  }

  if (method === 'resources/read') {
    const uri = String(params?.uri || '');
    const noteId = uri.replace(/^koenote:\/\/note\//, '');
    const snap = loadSnapshot(dataFilePath, scope);
    const note = snap.notes.find((n) => n.id === noteId);
    if (!note) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32002, message: `Resource not found: ${uri}` },
      };
    }
    return {
      jsonrpc: '2.0',
      id,
      result: {
        contents: [{ uri, mimeType: 'text/markdown', text: formatNoteFull(note) }],
      },
    };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const req = JSON.parse(trimmed);
    if (req.id === undefined || req.id === null) {
      // Notification — no response required
      return;
    }
    const resp = handleRequest(req);
    process.stdout.write(`${JSON.stringify(resp)}\n`);
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: `Parse error: ${err instanceof Error ? err.message : String(err)}` },
      })}\n`
    );
  }
});
