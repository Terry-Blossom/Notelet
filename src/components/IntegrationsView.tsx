import React, { useState } from 'react';
import { Check, ExternalLink, Key, Loader2, Search } from 'lucide-react';
import {
  AppSettings,
  Folder,
  IntegrationAdapterInfo,
  NotionTarget,
  SecretStatus,
} from '../types';
import { isAndroidRuntime } from '../lib/platform';

interface IntegrationsViewProps {
  settings: AppSettings;
  adapters: IntegrationAdapterInfo[];
  secretStatus: SecretStatus | null;
  mcpPreview: string;
  folders?: Folder[];
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
  onNotionPullNotes?: () => Promise<void>;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  settings,
  secretStatus,
  mcpPreview,
  folders = [],
  onSaveSettings,
  onSetSecret,
  onNotionSearchTargets,
  onNotionOAuthUrl,
  onNotionExchangeCode,
  onNotionPullNotes,
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
  const [notionPulling, setNotionPulling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const update = (patch: Partial<AppSettings>) => {
    void onSaveSettings({ ...settings, ...patch });
  };

  const saveKey = async (keyName: string) => {
    const val = (secretInputs[keyName] || '').trim();
    if (!val) {
      flash('設定を保存しました');
      return;
    }
    await onSetSecret(keyName, val);
    setSecretInputs((p) => ({ ...p, [keyName]: '' }));
    flash('トークンを暗号化して保存しました');
  };

  return (
    <div className="page-container">
      {toast && (
        <div className="status-chip ok" style={{ alignSelf: 'flex-start' }}>
          <Check size={14} strokeWidth={1.5} />
          {toast}
        </div>
      )}

      {/* Notion Primary Integration Card */}
      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div>
            <h2 className="section-title">Notion 同期</h2>
            <p className="text-muted" style={{ margin: '4px 0 0' }}>
              文字起こし・要約・メモを Notion データベースまたはページへ同期します。
            </p>
          </div>
          <span className={`status-chip ${secretStatus?.notion_access_token ? 'ok' : 'warn'}`}>
            {secretStatus?.notion_access_token ? 'トークン保存済み' : 'トークン未設定'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="password"
            className="input"
            placeholder={
              secretStatus?.notion_access_token
                ? 'Notion Integration Token（保存済み・更新する場合のみ入力）'
                : 'Notion Integration Token (secret_... / ntn_...)'
            }
            value={secretInputs['notion_access_token'] || ''}
            onChange={(e) => setSecretInputs((p) => ({ ...p, notion_access_token: e.target.value }))}
            onBlur={() => {
              if ((secretInputs['notion_access_token'] || '').trim()) {
                void saveKey('notion_access_token');
              }
            }}
          />
          <button type="button" className="btn btn-primary" onClick={() => saveKey('notion_access_token')}>
            <Key size={14} strokeWidth={1.5} />
            保存
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label className="text-muted">同期先データベース / ページ</label>
            {settings.notion_target_name && (
              <span className="status-chip accent">
                現在: {settings.notion_target_name} ({settings.notion_target_type})
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search
                size={15}
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
                style={{ paddingLeft: '36px' }}
                placeholder="データベース名またはページ名で検索（空欄で一覧取得）"
                value={notionQuery}
                onChange={(e) => setNotionQuery(e.target.value)}
              />
            </div>
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
              {notionFetching ? '取得中' : '同期先を検索'}
            </button>
            {onNotionPullNotes && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={notionPulling || !settings.notion_target_id}
                onClick={async () => {
                  setNotionPulling(true);
                  try {
                    await onNotionPullNotes();
                  } finally {
                    setNotionPulling(false);
                  }
                }}
              >
                {notionPulling && <Loader2 size={15} strokeWidth={1.5} className="spin" />}
                {notionPulling ? '同期中...' : 'Notionから今すぐ同期'}
              </button>
            )}
          </div>
        </div>

        {notionFetching && (
          <div className="surface-subtle" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Loader2 size={16} strokeWidth={1.5} className="spin" />
            <span>Notion から同期先候補を取得中...</span>
          </div>
        )}

        {notionTargets.length > 0 && (
          <div className="flat-list">
            {notionTargets.map((t) => {
              const isSelected = settings.notion_target_id === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  className="flat-row"
                  style={{
                    backgroundColor: isSelected ? 'var(--accent-tint)' : 'transparent',
                  }}
                  onClick={() => {
                    update({
                      notion_target_id: t.id,
                      notion_target_type: t.object_type,
                      notion_target_name: t.title,
                    });
                    flash(`保存先を「${t.title}」に設定しました`);
                  }}
                >
                  <span style={{ fontWeight: isSelected ? 600 : 400 }}>
                    {t.title}（{t.object_type}）
                  </span>
                  <span className="text-muted mono-num">{isSelected ? '選択中' : t.id.slice(0, 8)}</span>
                </button>
              );
            })}
          </div>
        )}

        <details style={{ fontSize: '12px' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 500 }}>
            プロパティ名のマッピング設定・OAuth 2.0 接続
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
              <div>
                <label className="text-muted">タイトルプロパティ</label>
                <input
                  className="input"
                  value={settings.notion_mapping.title_prop}
                  onChange={(e) =>
                    update({ notion_mapping: { ...settings.notion_mapping, title_prop: e.target.value } })
                  }
                />
              </div>
              <div>
                <label className="text-muted">要約プロパティ</label>
                <input
                  className="input"
                  value={settings.notion_mapping.summary_prop}
                  onChange={(e) =>
                    update({ notion_mapping: { ...settings.notion_mapping, summary_prop: e.target.value } })
                  }
                />
              </div>
              <div>
                <label className="text-muted">日時プロパティ</label>
                <input
                  className="input"
                  value={settings.notion_mapping.date_prop}
                  onChange={(e) =>
                    update({ notion_mapping: { ...settings.notion_mapping, date_prop: e.target.value } })
                  }
                />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
              <div className="text-muted">OAuth 2.0 で接続する場合</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '8px' }}>
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
                    ブラウザで開く
                  </a>
                )}
                <input className="input" placeholder="取得した認可 code" value={notionCode} onChange={(e) => setNotionCode(e.target.value)} />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={async () => {
                    const ws = await onNotionExchangeCode(notionClientId, notionClientSecret, notionCode, notionRedirectUri);
                    flash(`${ws} に接続しました`);
                  }}
                >
                  交換
                </button>
              </div>
            </div>
          </div>
        </details>
      </section>

      {/* Secondary: Webhook & MCP */}
      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 className="section-title">Webhook / MCP 連携</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="password"
            className="input"
            placeholder={
              secretStatus?.slack_webhook_url
                ? 'Slack Incoming Webhook URL（保存済み）'
                : 'Slack Incoming Webhook URL'
            }
            value={secretInputs['slack_webhook_url'] || ''}
            onChange={(e) => setSecretInputs((p) => ({ ...p, slack_webhook_url: e.target.value }))}
          />
          <button type="button" className="btn btn-secondary" onClick={() => saveKey('slack_webhook_url')}>
            保存
          </button>
        </div>
        {folders.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span className="text-muted" style={{ fontSize: '12px' }}>
              要約完了時に Slack へ自動共有するスペース（選択したスペースのノートのみ自動送信）
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {folders.map((folder) => {
                const selected = (settings.auto_share_slack_folder_ids ?? []).includes(folder.id);
                return (
                  <label
                    key={folder.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(e) => {
                        const prev = settings.auto_share_slack_folder_ids ?? [];
                        const next = e.target.checked
                          ? Array.from(new Set([...prev, folder.id]))
                          : prev.filter((id) => id !== folder.id);
                        update({ auto_share_slack_folder_ids: next });
                      }}
                    />
                    <span>{folder.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        <input
          type="url"
          className="input"
          placeholder="汎用 Webhook URL（任意）"
          value={settings.generic_webhook_url}
          onChange={(e) => update({ generic_webhook_url: e.target.value })}
        />
        {mcpPreview && !isAndroidRuntime() && (
          <details style={{ fontSize: '12px' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)' }}>
              MCP サーバー設定（Claude Desktop / Cursor 用）を表示
            </summary>
            <pre className="surface-subtle mono-num" style={{ margin: '8px 0 0', fontSize: '12px', overflowX: 'auto' }}>
              {mcpPreview}
            </pre>
          </details>
        )}
      </section>

      {/* Calendar ICS */}
      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 className="section-title">カレンダー連携 (ICS URL)</h2>
        <p className="text-muted" style={{ margin: 0 }}>
          Google Calendar や Outlook の非公開 ICS URL を登録すると、ホーム画面の予定リストに会議予定と参加者が自動反映されます。
        </p>
        <input
          type="url"
          className="input"
          placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
          value={settings.calendar_ics_url ?? ''}
          onChange={(e) => update({ calendar_ics_url: e.target.value })}
        />
      </section>

      {/* Issue Tracker: GitHub / Linear / Jira */}
      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div>
          <h2 className="section-title">Issue / タスク起票連携 (GitHub / Linear / Jira)</h2>
          <p className="text-muted" style={{ margin: '4px 0 0' }}>
            ノート内のアクション項目からワンクリックで Issue を作成できます。
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label className="text-muted">GitHub Issues</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: '1 1 180px' }}
              placeholder="owner/repo (例: Terry-Blossom/Notelet)"
              value={settings.github_repo ?? ''}
              onChange={(e) => update({ github_repo: e.target.value })}
            />
            <input
              type="password"
              className="input"
              style={{ flex: '1 1 200px' }}
              placeholder={secretStatus?.github_issue_token ? 'GitHub PAT（保存済み）' : 'GitHub Personal Access Token'}
              value={secretInputs['github_issue_token'] || ''}
              onChange={(e) => setSecretInputs((p) => ({ ...p, github_issue_token: e.target.value }))}
            />
            <button type="button" className="btn btn-secondary" onClick={() => saveKey('github_issue_token')}>
              保存
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label className="text-muted">Linear</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: '1 1 180px' }}
              placeholder="Linear Team ID"
              value={settings.linear_team_id ?? ''}
              onChange={(e) => update({ linear_team_id: e.target.value })}
            />
            <input
              type="password"
              className="input"
              style={{ flex: '1 1 200px' }}
              placeholder={secretStatus?.linear_api_key ? 'Linear API Key（保存済み）' : 'Linear API Key (lin_api_...)'}
              value={secretInputs['linear_api_key'] || ''}
              onChange={(e) => setSecretInputs((p) => ({ ...p, linear_api_key: e.target.value }))}
            />
            <button type="button" className="btn btn-secondary" onClick={() => saveKey('linear_api_key')}>
              保存
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label className="text-muted">Jira</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ flex: '1 1 200px' }}
              placeholder="https://your-domain.atlassian.net"
              value={settings.jira_base_url ?? ''}
              onChange={(e) => update({ jira_base_url: e.target.value })}
            />
            <input
              className="input"
              style={{ flex: '1 1 160px' }}
              placeholder="Jira Email"
              value={settings.jira_email ?? ''}
              onChange={(e) => update({ jira_email: e.target.value })}
            />
            <input
              className="input"
              style={{ flex: '0 1 110px' }}
              placeholder="Project Key"
              value={settings.jira_project_key ?? ''}
              onChange={(e) => update({ jira_project_key: e.target.value })}
            />
            <input
              type="password"
              className="input"
              style={{ flex: '1 1 180px' }}
              placeholder={secretStatus?.jira_api_token ? 'Jira API Token（保存済み）' : 'Jira API Token'}
              value={secretInputs['jira_api_token'] || ''}
              onChange={(e) => setSecretInputs((p) => ({ ...p, jira_api_token: e.target.value }))}
            />
            <button type="button" className="btn btn-secondary" onClick={() => saveKey('jira_api_token')}>
              保存
            </button>
          </div>
        </div>
      </section>

      {/* Granola API */}
      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h2 className="section-title">Granola API キー（インポート用）</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="password"
            className="input"
            placeholder={secretStatus?.granola_api_key ? 'Granola API Key（保存済み）' : 'Granola API Key'}
            value={secretInputs['granola_api_key'] || ''}
            onChange={(e) => setSecretInputs((p) => ({ ...p, granola_api_key: e.target.value }))}
          />
          <button type="button" className="btn btn-secondary" onClick={() => saveKey('granola_api_key')}>
            保存
          </button>
        </div>
      </section>
    </div>
  );
};
