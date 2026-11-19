import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { formatMs, formatNoteForCopy, createEmptyNote } from '../lib/format';
import { App } from '../App';
import { NoteEditorView } from '../components/NoteEditorView';
import { HistoryView } from '../components/HistoryView';
import { AppSettings, Note } from '../types';

const baseSettings: AppSettings = {
  plan_tier: 'basic',
  active_asr_model_id: 'whisper-small-q5',
  active_asr_provider: 'local_whisper',
  language: 'ja',
  allow_cloud_asr: false,
  llm_provider: 'none',
  llm_model: '',
  llm_endpoint: '',
  record_shortcut: 'CommandOrControl+Shift+R',
  voice_typing_shortcut: 'CommandOrControl+Shift+V',
  delete_audio_after_transcribe: true,
  encrypt_retained_audio: true,
  retention_days: 0,
  participant_notice_enabled: false,
  participant_notice_text: '録音しています。',
  admin_enforced_notice: false,
  opt_out_model_training: true,
  org_opt_out_model_training: true,
  copy_format: 'markdown',
  notion_target_id: 'db-123',
  notion_target_type: 'database',
  notion_target_name: '議事録DB',
  notion_mapping: {
    title_prop: 'Name',
    date_prop: 'Date',
    participants_prop: 'Participants',
    summary_prop: 'Summary',
    actions_prop: 'Action Items',
  },
  whisper_cli_path: '',
  parakeet_cli_path: '',
  slack_webhook_configured: false,
  generic_webhook_url: '',
  mcp_enabled: false,
  mcp_scope: 'personal_30d',
  active_template_id: 'standard',
};

describe('format utilities', () => {
  it('formats milliseconds into MM:SS and HH:MM:SS', () => {
    expect(formatMs(0)).toBe('00:00');
    expect(formatMs(65_000)).toBe('01:05');
    expect(formatMs(3_661_000)).toBe('01:01:01');
  });

  it('formats note to markdown and plain text', () => {
    const note = createEmptyNote();
    note.title = '定例ミーティング';
    note.summary = '来週のリリースを確認した。';
    note.segments = [
      { id: '1', start_ms: 12_000, end_ms: 15_000, speaker: '田中', text: '準備は完了しています。' },
    ];
    const md = formatNoteForCopy(note, 'markdown');
    expect(md).toContain('# 定例ミーティング');
    expect(md).toContain('`00:12` **田中**: 準備は完了しています。');

    const plain = formatNoteForCopy(note, 'plain');
    expect(plain).toContain('定例ミーティング');
    expect(plain).toContain('[00:12] 田中: 準備は完了しています。');
  });
});

describe('App & Views', () => {
  it('renders home view with record button and empty note creation', () => {
    render(<App />);
    expect(screen.getByText('録音と文字起こし')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /録音を開始/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '空のノートを作成' }));
    expect(screen.getByLabelText('ノートタイトル')).toBeInTheDocument();
  });

  it('shows LLM unconfigured reason and Notion duplicate-prevention preview', () => {
    const note: Note = {
      ...createEmptyNote(),
      title: '設計レビュー',
      notion_sync: {
        page_id: 'page-existing-1',
        page_url: null,
        database_id: 'db-123',
        last_synced_at: null,
        status: 'synced',
        last_error: null,
      },
    };
    render(
      <NoteEditorView
        note={note}
        settings={baseSettings}
        recipes={[]}
        secretStatus={{
          openai_api_key: false,
          deepgram_api_key: false,
          groq_api_key: false,
          llm_openai_api_key: false,
          llm_anthropic_api_key: false,
          llm_gemini_api_key: false,
          notion_access_token: true,
          slack_webhook_url: false,
        }}
        transcribing={false}
        transcribeError={null}
        onUpdateNote={vi.fn()}
        onCopyText={vi.fn()}
        onPastePrepare={vi.fn()}
        onSaveToNotion={vi.fn()}
        onSummarize={vi.fn()}
        onDraftFollowup={vi.fn()}
        onRunRecipe={vi.fn()}
        onChatNote={vi.fn()}
        onShareSlack={vi.fn()}
        onSendWebhook={vi.fn()}
        onAddDictionaryTerm={vi.fn()}
        onGoSettings={vi.fn()}
      />
    );
    expect(screen.getByText('LLMが未設定です')).toBeInTheDocument();
    expect(screen.getByText(/自動話者識別: 未対応/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Notion を更新/ }));
    expect(screen.getByText('Notion 保存前の確認')).toBeInTheDocument();
    expect(screen.getByText(/既存ページを更新（重複ページを作成しません）/)).toBeInTheDocument();
  });

  it('hides >30d notes in Basic view without deleting them and supports search', () => {
    const oldNote: Note = {
      ...createEmptyNote(),
      id: 'old-1',
      title: '45日前の会議',
      created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const newNote: Note = {
      ...createEmptyNote(),
      id: 'new-1',
      title: '昨日の会議',
      created_at: new Date().toISOString(),
    };
    render(
      <HistoryView
        notes={[newNote, oldNote]}
        folders={[{ id: 'personal', name: '個人ノート', is_shared: false, permission: 'owner' }]}
        settings={baseSettings}
        onOpenNote={vi.fn()}
        onDeleteNote={vi.fn()}
        onChatAcrossNotes={vi.fn()}
      />
    );
    expect(screen.getByText('昨日の会議')).toBeInTheDocument();
    expect(screen.queryByText('45日前の会議')).not.toBeInTheDocument();
    expect(screen.getByText(/30日以前の 1 件はローカルに保持されており、削除されません/)).toBeInTheDocument();
  });
});
