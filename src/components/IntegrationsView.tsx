import React, { useState } from 'react';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import {
  AppSettings,
  IntegrationAdapterInfo,
  NotionTarget,
  SecretStatus,
} from '../types';

interface IntegrationsViewProps {
  settings: AppSettings;
  adapters: IntegrationAdapterInfo[];
  secretStatus: SecretStatus | null;
  mcpPreview: string;
  onSaveSettings: (next: AppSettings) => Promise<void>;
  onSetSecret: (key: string, value: string) => Promise<void>;
  onNotionSearchTargets: (query: string) => Promise<NotionTarget[]>;
  onNotionOAuthUrl: (clientId: string, redirectUri: string) => Promise<string>;
  onNotionExchangeCode: (
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string
  ) => Promise<string>;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  settings,
  adapters,
  secretStatus,
  mcpPreview,
  onSaveSettings,
  onSetSecret,
  onNotionSearchTargets,
  onNotionOAuthUrl,
  onNotionExchangeCode,
}) => {
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [notionClientId, setNotionClientId] = useState('');
  const [notionClientSecret, setNotionClientSecret] = useState('');
  const [notionRedirectUri, setNotionRedirectUri] = useState('http://localhost:1420/oauth/notion');
  const [notionAuthUrl, setNotionAuthUrl] = useState('');
  const [notionCode, setNotionCode] = useState('');
  const [notionQuery, setNotionQuery] = useState('');
  const [notionTargets, setNotionTargets] = useState<NotionTarget[]>([]);
  const [notionFetching, setNotionFetching] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const update = (patch: Partial<AppSettings>) => {
    void onSaveSettings({ ...settings, ...patch });
  };

  const saveKey = async (keyName: string) => {
    await onSetSecret(keyName, secretInputs[keyName] || '');
    setSecretInputs((p) => ({ ...p, [keyName]: '' }));
    flash('OS資格情報ストアに保存しました');
  };

  return (
    <div className="page-container">
      <div>
        <h1 className="page-title">連携</h1>
        <p className="text-secondary" style={{ margin: '4px 0 0' }}>
          Notion、Slack、Webhook、MCP、外部サービスとの接続を管理します
        </p>
      </div>

      {toast && (
        <div className="status-chip ok" style={{ alignSelf: 'flex-start' }}>
          <Check size={14} strokeWidth={1.5} />
          {toast}
        </div>
      )}

      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 className="section-title">Notion</h2>
          <span className={`status-chip ${secretStatus?.notion_access_token ? 'ok' : ''}`}>
            {secretStatus?.notion_access_token ? '接続済み' : '未接続'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="password"
            className="input"
            placeholder="Notion Integration Token (secret_...)"
            value={secretInputs['notion_access_token'] || ''}
            onChange={(e) => setSecretInputs((p) => ({ ...p, notion_access_token: e.target.value }))}
          />
          <button type="button" className="btn btn-secondary" onClick={() => saveKey('notion_access_token')}>
            トークン保存
          </button>
        </div>

        <details className="surface-subtle">
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>OAuth 2.0 で接続する場合</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
              <input className="input" placeholder="Client ID" value={notionClientId} onChange={(e) => setNotionClientId(e.target.value)} />
              <input className="input" type="password" placeholder="Client Secret" value={notionClientSecret} onChange={(e) => setNotionClientSecret(e.target.value)} />
              <input className="input" placeholder="Redirect URI" value={notionRedirectUri} onChange={(e) => setNotionRedirectUri(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={async () => {
                  const url = await onNotionOAuthUrl(notionClientId, notionRedirectUri);
                  setNotionAuthUrl(url);
                }}
              >
                認可URLを生成
              </button>
              {notionAuthUrl && (
                <a href={notionAuthUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
                  <ExternalLink size={14} strokeWidth={1.5} />
                  ブラウザで認可を開く
                </a>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input className="input" placeholder="取得した認可 code" value={notionCode} onChange={(e) => setNotionCode(e.target.value)} />
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const ws = await onNotionExchangeCode(notionClientId, notionClientSecret, notionCode, notionRedirectUri);
                  flash(`${ws} に接続しました`);
                }}
              >
                コード交換
              </button>
            </div>
          </div>
        </details>

        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className="input"
            placeholder="保存先のデータベースまたはページ名で検索"
            value={notionQuery}
            onChange={(e) => setNotionQuery(e.target.value)}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={notionFetching}
            onClick={async () => {
              setNotionFetching(true);
              try {
                const res = await onNotionSearchTargets(notionQuery);
                setNotionTargets(res);
              } finally {
                setNotionFetching(false);
              }
            }}
          >
            {notionFetching && <Loader2 size={15} strokeWidth={1.5} className="spin" />}
            {notionFetching ? '取り込み中' : '保存先を検索'}
          </button>
        </div>

        {notionFetching && (
          <div className="surface-subtle" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Loader2 size={16} strokeWidth={1.5} className="spin" />
            <span>Notion からデータを取り込み中...</span>
          </div>
        )}

        {notionTargets.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {notionTargets.map((t) => (
              <button
                key={t.id}
                type="button"
                className="surface-subtle"
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left' }}
                onClick={() => {
                  update({
                    notion_target_id: t.id,
                    notion_target_type: t.object_type,
                    notion_target_name: t.title,
                  });
                  flash(`保存先を「${t.title}」に設定しました`);
                }}
              >
                <span>{t.title}（{t.object_type}）</span>
                <span className="text-muted mono-num">{t.id.slice(0, 8)}</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
          <div>
            <label className="text-muted">タイトルプロパティ</label>
            <input
              className="input"
              value={settings.notion_mapping.title_prop}
              onChange={(e) => update({ notion_mapping: { ...settings.notion_mapping, title_prop: e.target.value } })}
            />
          </div>
          <div>
            <label className="text-muted">要約プロパティ</label>
            <input
              className="input"
              value={settings.notion_mapping.summary_prop}
              onChange={(e) => update({ notion_mapping: { ...settings.notion_mapping, summary_prop: e.target.value } })}
            />
          </div>
          <div>
            <label className="text-muted">日時プロパティ</label>
            <input
              className="input"
              value={settings.notion_mapping.date_prop}
              onChange={(e) => update({ notion_mapping: { ...settings.notion_mapping, date_prop: e.target.value } })}
            />
          </div>
        </div>
      </section>

      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 className="section-title">Slack / Webhook / MCP</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="password"
            className="input"
            placeholder="Slack Incoming Webhook URL"
            value={secretInputs['slack_webhook_url'] || ''}
            onChange={(e) => setSecretInputs((p) => ({ ...p, slack_webhook_url: e.target.value }))}
          />
          <button type="button" className="btn btn-secondary" onClick={() => saveKey('slack_webhook_url')}>
            保存
          </button>
        </div>
        <input
          type="url"
          className="input"
          placeholder="汎用 Webhook / Zapier URL"
          value={settings.generic_webhook_url}
          onChange={(e) => update({ generic_webhook_url: e.target.value })}
        />
        <div>
          <div className="text-muted" style={{ marginBottom: '4px' }}>MCP サーバー設定例（Claude / Cursor 等）</div>
          <pre className="surface-subtle mono-num" style={{ margin: 0, fontSize: '12px', overflowX: 'auto' }}>
            {mcpPreview}
          </pre>
        </div>
      </section>

      <section className="surface-card">
        <h2 className="section-title" style={{ marginBottom: '12px' }}>外部サービス連携状況</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>サービス</th>
              <th>状態</th>
              <th>説明</th>
            </tr>
          </thead>
          <tbody>
            {adapters.map((a) => (
              <tr key={a.id}>
                <td style={{ fontWeight: 600 }}>{a.name}</td>
                <td>
                  <span className={`status-chip ${a.status === 'implemented' ? 'ok' : a.status === 'adapter_ready' ? 'accent' : ''}`}>
                    {a.status === 'implemented' ? '実装済み' : a.status === 'adapter_ready' ? '設定生成対応' : '未実装'}
                  </span>
                </td>
                <td>{a.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
};
