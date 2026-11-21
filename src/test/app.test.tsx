import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { formatMs, formatNoteTimer, formatNoteForCopy, createEmptyNote } from '../lib/format';
import { App } from '../App';
import { NoteEditorView } from '../components/NoteEditorView';
import { HistoryView } from '../components/HistoryView';
import { AppSettings, Note } from '../types';

const baseSettings: AppSettings = {
  plan_tier: 'enterprise',
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
  mcp_scope: 'workspace',
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
  it('renders sidebar navigation items and bottom controls', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'ホーム' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'チャット' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ノート' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'アップロード' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '辞書' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '連携' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '設定' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '録音' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新規ノート' }));
    expect(screen.getByLabelText('ノートタイトル')).toBeInTheDocument();
  });

  it('formats note timer into MM:SS and H:MM:SS', () => {
    expect(formatNoteTimer(0)).toBe('00:00');
    expect(formatNoteTimer(18_000)).toBe('00:18');
    expect(formatNoteTimer(3_723_000)).toBe('1:02:03');
  });

  it('shows idle state, tabs, LLM notice, and Notion duplicate-prevention preview', () => {
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
          llm_openai_compatible_api_key: false,
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
        onSaveRecipe={vi.fn()}
        onChatNote={vi.fn()}
        onShareSlack={vi.fn()}
        onSendWebhook={vi.fn()}
        onAddDictionaryTerm={vi.fn()}
        onGoSettings={vi.fn()}
      />
    );

    expect(screen.getByText('まだ文字起こしがありません')).toBeInTheDocument();
    expect(screen.getByText('他の人を録音するときは必ず同意を得てください')).toBeInTheDocument();

    // Switch to あなたのノート tab via keyboard
    const transcriptTab = screen.getByRole('tab', { name: '文字起こし' });
    fireEvent.keyDown(transcriptTab, { key: 'ArrowRight' });
    expect(screen.getByLabelText('要約内容')).toBeInTheDocument();
    expect(screen.getByText('LLMが未設定です')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('tab', { name: '要約' }), { key: 'ArrowRight' });
    expect(screen.getByRole('textbox', { name: '自由メモ帳' })).toBeInTheDocument();

    // Open share popover and Notion preview
    fireEvent.click(screen.getByRole('button', { name: '共有' }));
    fireEvent.click(screen.getByRole('button', { name: /Notion を更新/ }));
    expect(screen.getByText('Notion 保存前の確認')).toBeInTheDocument();
    expect(screen.getByText(/既存ページを更新（重複ページを作成しません）/)).toBeInTheDocument();
  });

  it('transitions idle -> recording -> processing -> completed and confirms re-record', async () => {
    vi.useFakeTimers();
    const note: Note = {
      ...createEmptyNote(),
      title: '',
    };
    const onUpdateNote = vi.fn();
    const { rerender } = render(
      <NoteEditorView
        note={note}
        settings={baseSettings}
        recipes={[]}
        secretStatus={null}
        transcribing={false}
        transcribeError={null}
        onUpdateNote={onUpdateNote}
        onCopyText={vi.fn()}
        onPastePrepare={vi.fn()}
        onSaveToNotion={vi.fn()}
        onSummarize={vi.fn()}
        onDraftFollowup={vi.fn()}
        onRunRecipe={vi.fn()}
        onSaveRecipe={vi.fn()}
        onChatNote={vi.fn()}
        onShareSlack={vi.fn()}
        onSendWebhook={vi.fn()}
        onAddDictionaryTerm={vi.fn()}
        onGoSettings={vi.fn()}
      />
    );

    // Start recording
    const startBtn = screen.getByRole('button', { name: '録音を開始' });
    expect(startBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(startBtn);

    const stopBtn = screen.getByRole('button', { name: '録音を停止' });
    expect(stopBtn).toHaveAttribute('aria-pressed', 'true');

    // Stop recording -> processing -> completed
    fireEvent.click(stopBtn);
    expect(screen.getByText('文字起こし中…')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(onUpdateNote).toHaveBeenCalled();
    const updatedNote = onUpdateNote.mock.calls[0][0] as Note;
    expect(updatedNote.segments.length).toBeGreaterThan(0);

    rerender(
      <NoteEditorView
        note={updatedNote}
        settings={baseSettings}
        recipes={[]}
        secretStatus={null}
        transcribing={false}
        transcribeError={null}
        onUpdateNote={onUpdateNote}
        onCopyText={vi.fn()}
        onPastePrepare={vi.fn()}
        onSaveToNotion={vi.fn()}
        onSummarize={vi.fn()}
        onDraftFollowup={vi.fn()}
        onRunRecipe={vi.fn()}
        onSaveRecipe={vi.fn()}
        onChatNote={vi.fn()}
        onShareSlack={vi.fn()}
        onSendWebhook={vi.fn()}
        onAddDictionaryTerm={vi.fn()}
        onGoSettings={vi.fn()}
      />
    );

    expect(screen.queryByText('文字起こし済み')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '録音を再生' })).toBeInTheDocument();

    // Re-record starts recording directly without confirmation popup
    fireEvent.click(screen.getByRole('button', { name: '再録音' }));
    expect(screen.queryByText('録音をやり直しますか？')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '録音を停止' })).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('shows all notes and Notion sync status indicators', () => {
    const syncedNote: Note = {
      ...createEmptyNote(),
      id: 'old-1',
      title: '45日前の会議',
      created_at: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
      notion_sync: {
        page_id: 'p1',
        page_url: null,
        database_id: null,
        last_synced_at: null,
        status: 'synced',
        last_error: null,
      },
    };
    const unsyncedNote: Note = {
      ...createEmptyNote(),
      id: 'new-1',
      title: '昨日の会議',
      created_at: new Date().toISOString(),
    };
    const syncingNote: Note = {
      ...createEmptyNote(),
      id: 'sync-1',
      title: '同期中の会議',
      created_at: new Date().toISOString(),
      notion_sync: {
        page_id: null,
        page_url: null,
        database_id: null,
        last_synced_at: null,
        status: 'syncing',
        last_error: null,
      },
    };
    render(
      <HistoryView
        notes={[unsyncedNote, syncedNote, syncingNote]}
        folders={[{ id: 'personal', name: '個人ノート', is_shared: false, permission: 'owner' }]}
        onOpenNote={vi.fn()}
        onDeleteNote={vi.fn()}
      />
    );
    expect(screen.getByText('昨日の会議')).toBeInTheDocument();
    expect(screen.getByText('45日前の会議')).toBeInTheDocument();
    expect(screen.getByLabelText('Notion 同期済み')).toBeInTheDocument();
    expect(screen.getByText('未同期')).toBeInTheDocument();
    expect(screen.getByText('同期中')).toBeInTheDocument();
  });

  it('keeps parent folder (Space) and child file (Note) separate when browsing another Space during recording', () => {
    const recNote: Note = {
      ...createEmptyNote('personal'),
      id: 'rec-note-1',
      title: '録音中のメモ',
    };
    const otherNote: Note = {
      ...createEmptyNote('work'),
      id: 'work-note-1',
      title: '業務ミーティング議事録',
    };
    const onUpdateNote = vi.fn();
    const onSelectNote = vi.fn();

    render(
      <NoteEditorView
        note={recNote}
        allNotes={[recNote, otherNote]}
        folders={[
          { id: 'personal', name: '個人ノート', is_shared: false, permission: 'owner' },
          { id: 'work', name: '業務スペース', is_shared: false, permission: 'owner' },
        ]}
        recordingNoteId="rec-note-1"
        settings={baseSettings}
        recipes={[]}
        secretStatus={null}
        transcribing={false}
        transcribeError={null}
        onUpdateNote={onUpdateNote}
        onSelectNote={onSelectNote}
        onCopyText={vi.fn()}
        onPastePrepare={vi.fn()}
        onSaveToNotion={vi.fn()}
        onSummarize={vi.fn()}
        onDraftFollowup={vi.fn()}
        onRunRecipe={vi.fn()}
        onSaveRecipe={vi.fn()}
        onChatNote={vi.fn()}
        onShareSlack={vi.fn()}
        onSendWebhook={vi.fn()}
        onAddDictionaryTerm={vi.fn()}
        onGoSettings={vi.fn()}
      />
    );

    // Clicking another Space (parent folder) opens the folder view with its child files without changing recNote.folder_id
    fireEvent.click(screen.getByTitle('業務スペース（スペースを開く）'));
    expect(onUpdateNote).not.toHaveBeenCalled();
    expect(screen.getByText('1 件のノート')).toBeInTheDocument();

    // Clicking a child note opens that child note
    fireEvent.click(screen.getAllByText('業務ミーティング議事録')[0]);
    expect(onSelectNote).toHaveBeenCalledWith('work-note-1');
  });

  it('suggests category ("もしかして：授業"), auto-switches to summary tab without blocking other notes, and preserves memo across tab switches', async () => {
    const noteA: Note = {
      ...createEmptyNote('personal'),
      id: 'note-a',
      title: '心理学の授業ノート（教授の講義と期末レポート課題）',
      manual_notes: '<p>来週までにレポート提出</p>',
      segments: [{ id: 'seg-a', start_ms: 0, end_ms: 1500, speaker: '', text: '認知心理学の導入講義です。' }],
    };
    const noteB: Note = {
      ...createEmptyNote('personal'),
      id: 'note-b',
      title: '別のメモ',
      segments: [{ id: 'seg-b', start_ms: 0, end_ms: 1200, speaker: '', text: '別ノートの文字起こし。' }],
    };
    const onUpdateNote = vi.fn();
    let resolveSummarizeA: () => void = () => {};
    const onSummarize = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSummarizeA = resolve;
        })
    );

    const { rerender } = render(
      <NoteEditorView
        note={noteA}
        allNotes={[noteA, noteB]}
        folders={[
          { id: 'personal', name: '個人', is_shared: false, permission: 'owner' },
          { id: 'class-1', name: '授業', is_shared: false, permission: 'owner' },
        ]}
        settings={{ ...baseSettings, llm_provider: 'openai', llm_model: 'gpt-4o-mini' }}
        recipes={[]}
        secretStatus={null}
        transcribing={false}
        transcribeError={null}
        onUpdateNote={onUpdateNote}
        onCopyText={vi.fn()}
        onPastePrepare={vi.fn()}
        onSaveToNotion={vi.fn()}
        onSummarize={onSummarize}
        onDraftFollowup={vi.fn()}
        onRunRecipe={vi.fn()}
        onSaveRecipe={vi.fn()}
        onChatNote={vi.fn()}
        onShareSlack={vi.fn()}
        onSendWebhook={vi.fn()}
        onAddDictionaryTerm={vi.fn()}
        onGoSettings={vi.fn()}
      />
    );

    // 1. Category suggestion "もしかして：授業" is shown and moves note on click
    const suggestBtn = screen.getByText('もしかして：授業');
    expect(suggestBtn).toBeInTheDocument();
    fireEvent.click(suggestBtn);
    expect(onUpdateNote).toHaveBeenCalledWith(expect.objectContaining({ folder_id: 'class-1' }));

    // 2. Switching to Memo tab restores manual_notes
    fireEvent.click(screen.getByRole('tab', { name: 'メモ' }));
    expect(screen.getByRole('textbox', { name: '自由メモ帳' }).innerHTML).toContain('来週までにレポート提出');

    // 3. Clicking "要約を生成" immediately switches to summary tab and starts summarizing Note A
    fireEvent.click(screen.getByRole('button', { name: '要約を生成' }));
    expect(screen.getByRole('tab', { name: '要約' })).toHaveAttribute('aria-selected', 'true');

    // 4. Switching to Note B while Note A is summarizing does NOT lock Note B in "生成中"
    rerender(
      <NoteEditorView
        note={noteB}
        allNotes={[noteA, noteB]}
        folders={[
          { id: 'personal', name: '個人', is_shared: false, permission: 'owner' },
          { id: 'class-1', name: '授業', is_shared: false, permission: 'owner' },
        ]}
        settings={{ ...baseSettings, llm_provider: 'openai', llm_model: 'gpt-4o-mini' }}
        recipes={[]}
        secretStatus={null}
        transcribing={false}
        transcribeError={null}
        onUpdateNote={onUpdateNote}
        onCopyText={vi.fn()}
        onPastePrepare={vi.fn()}
        onSaveToNotion={vi.fn()}
        onSummarize={onSummarize}
        onDraftFollowup={vi.fn()}
        onRunRecipe={vi.fn()}
        onSaveRecipe={vi.fn()}
        onChatNote={vi.fn()}
        onShareSlack={vi.fn()}
        onSendWebhook={vi.fn()}
        onAddDictionaryTerm={vi.fn()}
        onGoSettings={vi.fn()}
      />
    );
    const summarizeButtonsOnB = screen.getAllByRole('button', { name: '要約を生成' });
    expect(summarizeButtonsOnB[0]).not.toBeDisabled();
    resolveSummarizeA();
  });
});
