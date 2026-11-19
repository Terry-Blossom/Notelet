import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DictionaryEntry } from '../types';

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
  const [scope, setScope] = useState<'personal' | 'workspace'>('personal');

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim()) return;
    await onSaveEntry({
      id: crypto.randomUUID(),
      term: term.trim(),
      reading: reading.trim(),
      note: '',
      scope,
    });
    setTerm('');
    setReading('');
  };

  return (
    <div className="page-container">
      <div>
        <h1 className="page-title">辞書</h1>
        <p className="text-secondary" style={{ margin: '4px 0 0' }}>
          固有名詞や社内用語を登録すると、文字起こし時の認識ヒントとして利用されます
        </p>
      </div>

      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <form onSubmit={handleAdd} style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr auto', gap: '8px' }}>
          <input
            type="text"
            className="input"
            placeholder="表記（例: KoeNote / Tauri）"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          <input
            type="text"
            className="input"
            placeholder="読み・補足（任意）"
            value={reading}
            onChange={(e) => setReading(e.target.value)}
          />
          <select
            className="select"
            value={scope}
            onChange={(e) => setScope(e.target.value as 'personal' | 'workspace')}
          >
            <option value="personal">個人辞書</option>
            <option value="workspace">共有辞書</option>
          </select>
          <button type="submit" className="btn btn-primary" disabled={!term.trim()}>
            追加
          </button>
        </form>

        {dictionary.length === 0 ? (
          <p className="text-muted" style={{ margin: 0 }}>
            登録された単語はまだありません。
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>表記</th>
                <th>読み・補足</th>
                <th>区分</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {dictionary.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 600 }}>{d.term}</td>
                  <td>{d.reading || '-'}</td>
                  <td>{d.scope === 'workspace' ? '共有辞書' : '個人辞書'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" aria-label="削除" className="btn btn-ghost" onClick={() => onDeleteEntry(d.id)}>
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};
