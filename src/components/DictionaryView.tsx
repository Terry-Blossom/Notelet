import React, { useMemo, useState } from 'react';
import { Plus, Search, Trash2 } from 'lucide-react';
import { DictionaryEntry } from '../types';
import { confirmDeleteDialog } from './ConfirmDialog';

interface DictionaryViewProps {
  dictionary: DictionaryEntry[];
  onSaveEntry: (entry: DictionaryEntry) => Promise<void>;
  onDeleteEntry: (id: string) => Promise<void>;
}

export const DictionaryView: React.FC<DictionaryViewProps> = ({
  dictionary,
  onSaveEntry,
  onDeleteEntry,
}) => {
  const [term, setTerm] = useState('');
  const [reading, setReading] = useState('');
  const [filterQuery, setFilterQuery] = useState('');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim()) return;
    await onSaveEntry({
      id: crypto.randomUUID(),
      term: term.trim(),
      reading: reading.trim(),
      note: '',
      scope: 'personal',
    });
    setTerm('');
    setReading('');
  };

  const filtered = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return dictionary;
    return dictionary.filter(
      (d) => d.term.toLowerCase().includes(q) || d.reading.toLowerCase().includes(q)
    );
  }, [dictionary, filterQuery]);

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h2 className="section-title">カスタム辞書 ({dictionary.length})</h2>
          <p className="text-muted" style={{ margin: '4px 0 0' }}>
            固有名詞や専門用語を登録すると、文字起こし時の認識精度が向上します。
          </p>
        </div>

        {dictionary.length > 0 && (
          <div style={{ position: 'relative', width: '240px' }}>
            <Search
              size={14}
              strokeWidth={1.5}
              style={{
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
              }}
            />
            <input
              type="text"
              className="input"
              style={{ height: '32px', paddingLeft: '32px', borderRadius: '999px', backgroundColor: 'var(--bg-subtle)' }}
              placeholder="登録語を検索..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
            />
          </div>
        )}
      </div>

      <form onSubmit={handleAdd} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input
          type="text"
          className="input"
          style={{ flex: '2 1 220px' }}
          placeholder="表記（例: Notelet / 製品名 / 人名）"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <input
          type="text"
          className="input"
          style={{ flex: '2 1 220px' }}
          placeholder="読み・補足（任意）"
          value={reading}
          onChange={(e) => setReading(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={!term.trim()}>
          <Plus size={14} strokeWidth={1.5} />
          追加
        </button>
      </form>

      {filtered.length === 0 ? (
        <div style={{ padding: '24px 0', borderTop: '1px solid var(--border-subtle)' }}>
          <p className="text-muted" style={{ margin: '0px' }}>
            登録された単語はありません。
          </p>
        </div>
      ) : (
        <div className="flat-list">
          {filtered.map((d) => (
            <div key={d.id} className="flat-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                <strong style={{ fontWeight: 600 }}>{d.term}</strong>
                {d.reading && <span className="text-muted">{d.reading}</span>}
              </div>
              <button
                type="button"
                aria-label={`${d.term}を削除`}
                className="btn btn-ghost"
                style={{ width: '28px', height: '28px', padding: 0 }}
                onClick={async () => {
                  const ok = await confirmDeleteDialog(
                    `「${d.term}」を辞書から削除しますか？`,
                    '削除した登録語は元に戻せません。'
                  );
                  if (!ok) return;
                  await onDeleteEntry(d.id);
                }}
              >
                <Trash2 size={14} strokeWidth={1.5} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
