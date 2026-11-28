import React, { useState } from 'react';
import { AlertTriangle, Check, CloudDownload, FileSpreadsheet, FileText, Loader2, Upload } from 'lucide-react';
import { Folder, Note } from '../types';
import { GranolaImportFileInput, GranolaImportParseResult, parseGranolaImportFiles } from '../lib/granolaImport';
import { formatDateTime } from '../lib/format';
import { unzipTextFiles } from '../lib/zip';
import { apiFetchGranolaNotes, isTauriRuntime } from '../lib/tauri';
import { t } from '../i18n';

interface GranolaImportCardProps {
  folders: Folder[];
  existingNotes: Note[];
  onImportNotes: (notes: Note[]) => Promise<void>;
}

export const GranolaImportCard: React.FC<GranolaImportCardProps> = ({
  folders,
  existingNotes,
  onImportNotes,
}) => {
  const defaultFolderId =
    folders.find((f) => f.id === 'meeting')?.id ?? folders[0]?.id ?? 'meeting';

  const [targetFolderId, setTargetFolderId] = useState<string>(defaultFolderId);
  const [parseResult, setParseResult] = useState<GranolaImportParseResult | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loadingSource, setLoadingSource] = useState(false);
  const [granolaApiKey, setGranolaApiKey] = useState('');
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setError(null);
    setImportedCount(null);
    setLoadingSource(true);

    try {
      const inputs: GranolaImportFileInput[] = [];
      for (const f of files) {
        if (f.name.toLowerCase().endsWith('.zip')) {
          const buf = await f.arrayBuffer();
          const entries = await unzipTextFiles(buf);
          for (const entry of entries) {
            const lower = entry.name.toLowerCase();
            if (lower.endsWith('.csv') || lower.endsWith('.json') || lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) {
              inputs.push({ name: entry.name, content: entry.content });
            }
          }
        } else {
          inputs.push({ name: f.name, content: await f.text() });
        }
      }
      const res = parseGranolaImportFiles(inputs, {
        folderId: targetFolderId,
        existingNotes,
      });
      setFileNames(files.map((f) => f.name));
      setParseResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSource(false);
    }
  };

  const handleFetchApi = async () => {
    setError(null);
    setImportedCount(null);
    setLoadingSource(true);
    try {
      const raw = await apiFetchGranolaNotes(granolaApiKey.trim() || undefined);
      const res = parseGranolaImportFiles([{ name: 'granola-api.json', content: raw }], {
        folderId: targetFolderId,
        existingNotes,
      });
      setFileNames(['Granola API']);
      setParseResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSource(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!parseResult || parseResult.notes.length === 0 || importing) return;
    setImporting(true);
    setError(null);
    try {
      const notesWithFolder = parseResult.notes.map((n) => ({
        ...n,
        folder_id: targetFolderId,
      }));
      await onImportNotes(notesWithFolder);
      setImportedCount(notesWithFolder.length);
      setParseResult(null);
      setFileNames([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', flexWrap: 'wrap' }}>
        <div>
          <h3 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FileSpreadsheet size={16} strokeWidth={1.5} color="var(--accent)" />
            {t('Granola からインポート')}
          </h3>
          <p className="text-muted" style={{ margin: '4px 0 0' }}>
            {t('Granola のエクスポートファイル（CSV / JSON / Markdown / ZIP）またはローカルキャッシュ（')}<code>cache-v3.json</code>{t('）を読み込みます。')}
          </p>
        </div>
        {folders.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label className="text-muted" htmlFor="granola-target-folder">
              {t('保存先:')}
            </label>
            <select
              id="granola-target-folder"
              className="select"
              value={targetFolderId}
              onChange={(e) => setTargetFolderId(e.target.value)}
            >
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          if (e.dataTransfer.files.length > 0) {
            void handleFiles(e.dataTransfer.files);
          }
        }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '20px 16px',
          borderRadius: 'var(--radius-md)',
          border: `1px dashed ${dragging ? 'var(--accent)' : 'var(--border-strong)'}`,
          backgroundColor: dragging ? 'var(--bg-hover)' : 'var(--bg-subtle)',
          cursor: 'pointer',
          textAlign: 'center',
        }}
      >
        <Upload size={20} strokeWidth={1.5} color="var(--accent)" />
        <div style={{ fontWeight: 600, fontSize: '14px' }}>
          {fileNames.length > 0
            ? t('{0} 件のソースを選択中: {1}', [fileNames.length, fileNames.join(', ')])
            : t('CSV / JSON / Markdown / ZIP ファイルを選択またはドロップ（複数選択可）')}
        </div>
        <div className="text-muted" style={{ fontSize: '12px' }}>
          {t('Granola: Settings ＞ Profile ＞ Generate CSV、または ')}<code>cache-v3.json</code>{t('（macOS: ~/Library/Application Support/Granola/ / Windows: %APPDATA%\\Granola\\）')}
        </div>
        <input
          type="file"
          multiple
          accept=".csv,.json,.md,.markdown,.txt,.zip,text/csv,application/json,text/markdown,application/zip"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              void handleFiles(e.target.files);
              e.target.value = '';
            }
          }}
        />
      </label>

      {isTauriRuntime() && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="password"
            className="input"
            style={{ flex: '1 1 200px' }}
            placeholder={t('Granola API キー（保存済みなら空欄で取得可）')}
            value={granolaApiKey}
            onChange={(e) => setGranolaApiKey(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loadingSource || importing}
            onClick={handleFetchApi}
          >
            <CloudDownload size={14} strokeWidth={1.5} />
            {t('API から取得')}
          </button>
        </div>
      )}

      {importedCount !== null && (
        <div className="status-chip ok" style={{ alignSelf: 'flex-start' }}>
          <Check size={14} strokeWidth={1.5} />
          {t('Granola から {0} 件のノートをインポートしました', [importedCount])}
        </div>
      )}

      {error && (
        <div className="surface-subtle" style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {parseResult && (
        <div className="surface-subtle" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>
              {t('取り込みプレビュー: 新規 {0} 件', [parseResult.notes.length])}
              {parseResult.skippedDuplicates > 0 && (
                <span className="text-muted" style={{ fontWeight: 400, marginLeft: '8px' }}>
                  {t('（重複スキップ {0} 件）', [parseResult.skippedDuplicates])}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={importing}
                onClick={() => {
                  setParseResult(null);
                  setFileNames([]);
                }}
              >
                {t('クリア')}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={importing || parseResult.notes.length === 0}
                onClick={handleConfirmImport}
              >
                {importing ? <Loader2 size={14} strokeWidth={1.5} className="spin" /> : <Check size={14} strokeWidth={1.5} />}
                {importing ? t('インポート中...') : t('{0} 件をインポート', [parseResult.notes.length])}
              </button>
            </div>
          </div>

          {parseResult.warnings.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', color: 'var(--warning, #b45309)', fontSize: '12px' }}>
              {parseResult.warnings.map((w, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlertTriangle size={13} strokeWidth={1.5} />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}

          {parseResult.notes.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '220px', overflowY: 'auto' }}>
              {parseResult.notes.slice(0, 30).map((note) => (
                <div
                  key={note.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '13px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                    <FileText size={14} strokeWidth={1.5} color="var(--text-muted)" />
                    <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {note.title}
                    </span>
                  </div>
                  <div className="text-muted mono-num" style={{ fontSize: '12px', flexShrink: 0 }}>
                    {formatDateTime(note.created_at)}
                    {note.segments.length > 0 ? t(' · {0}発話', [note.segments.length]) : ''}
                    {note.summary ? t(' · 要約あり') : ''}
                  </div>
                </div>
              ))}
              {parseResult.notes.length > 30 && (
                <div className="text-muted" style={{ fontSize: '12px', textAlign: 'center' }}>
                  {t('ほか {0} 件...', [parseResult.notes.length - 30])}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
