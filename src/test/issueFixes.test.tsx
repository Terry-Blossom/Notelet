import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { AppDataSnapshot, AppSettings, ChatAnswer, Note, PopupChatSession } from '../types';
import { createEmptyNote } from '../lib/format';

const { invokeMock, listenHandlers, callbackMap, registerCallback } = vi.hoisted(() => {
  let seq = 1;
  const callbackMap = new Map<number, (event: { payload: unknown }) => void>();
  return {
    invokeMock: vi.fn(),
    listenHandlers: new Map<string, Array<(event: { payload: unknown }) => void>>(),
    callbackMap,
    registerCallback: vi.fn((cb: (event: { payload: unknown }) => void) => {
      const id = seq++;
      callbackMap.set(id, cb);
      return id;
    }),
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
  transformCallback: registerCallback,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (eventName: string, cb: (event: { payload: unknown }) => void) => {
    const arr = listenHandlers.get(eventName) ?? [];
    arr.push(cb);
    listenHandlers.set(eventName, arr);
    return () => {
      const list = listenHandlers.get(eventName);
      if (list) {
        listenHandlers.set(
          eventName,
          list.filter((fn) => fn !== cb)
        );
      }
    };
  }),
}));

import { App } from '../App';
import { NoteEditorView } from '../components/NoteEditorView';
import { SettingsView } from '../components/SettingsView';
import { ErrorBoundary } from '../components/ErrorBoundary';

const baseSettings: AppSettings = {
  plan_tier: 'enterprise',
  active_asr_model_id: 'whisper-small-q5',
  active_asr_provider: 'local_whisper',
  language: 'ja',
  allow_cloud_asr: false,
  llm_provider: 'openai',
  llm_model: 'gpt-4o-mini',
  llm_endpoint: '',
  record_shortcut: 'CommandOrControl+Shift+R',
  voice_typing_shortcut: 'CommandOrControl+Shift+V',
  delete_audio_after_transcribe: false,
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
  parakeet_cli_path: 'C:\\tools\\sherpa-onnx-offline.exe',
  slack_webhook_configured: true,
  generic_webhook_url: 'https://example.com/hook',
  mcp_enabled: false,
  mcp_scope: 'workspace',
  active_template_id: 'standard',
};

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    ...createEmptyNote('personal'),
    id: 'note-1',
    title: '元のタイトル',
    audio_path: 'C:\\tmp\\prev.wav',
    segments: [
      { id: 'seg-1', speaker: '話者1', start_ms: 0, end_ms: 1000, text: '最初の発言' },
      { id: 'seg-2', speaker: '話者2', start_ms: 1000, end_ms: 2000, text: '二番目の発言' },
    ],
    summary: '最初の要約テキスト',
    ...overrides,
  };
}

describe('Regression fixes for #25-#31', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    listenHandlers.clear();
    callbackMap.clear();
    localStorage.clear();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
      invoke: invokeMock,
      transformCallback: registerCallback,
      unregisterCallback: vi.fn(),
    };
    (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: vi.fn(),
    };
  });

  it('#25: pressing Escape while editing title reverts to snapshot even on synchronous blur', () => {
    const note = makeNote({ title: '元のタイトル' });
    const onUpdateNote = vi.fn();

    render(
      <NoteEditorView
        note={note}
        allNotes={[note]}
        folders={[{ id: 'personal', name: '個人', is_shared: false, permission: 'owner' }]}
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

    const input = screen.getByLabelText('ノートタイトル') as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '  編集中  ' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input.value).toBe('元のタイトル');
    expect(onUpdateNote).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: '元のタイトル' })
    );
  });

  it('#26: opening active note from Ctrl+K quick search exits space view', async () => {
    const note = makeNote({ title: '検索テストノート' });
    const snap: AppDataSnapshot = {
      settings: baseSettings,
      notes: [note],
      folders: [{ id: 'personal', name: '個人ノート', is_shared: false, permission: 'owner' }],
      dictionary: [],
      recipes: [],
      audit_logs: [],
      chat_history: [],
    };
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_snapshot') return snap;
      if (cmd === 'list_audio_devices' || cmd === 'list_integrations' || cmd === 'list_upcoming_calendar_events') return [];
      if (cmd === 'get_secret_status') return {};
      if (cmd === 'get_gpu_capabilities') return { has_nvidia: false, vram_mb: 0 };
      if (cmd === 'get_recording_status') return { state: 'idle', elapsed_ms: 0, rms_level: 0, temp_wav_path: null, source_mode: 'mic' };
      return null;
    });

    render(<App />);
    await screen.findByText('検索テストノート');
    fireEvent.click(screen.getByRole('button', { name: 'ノート' }));
    await screen.findByLabelText('ノートタイトル');

    // Open space view
    fireEvent.click(screen.getByTitle('個人ノート（スペースを開く）'));
    expect(screen.queryByLabelText('ノートタイトル')).not.toBeInTheDocument();

    // Open quick search and click the same active note
    fireEvent.click(screen.getByRole('button', { name: /ノートや会話を検索/ }));
    const searchDialog = await screen.findByRole('dialog', { name: 'クイック検索' });
    const resultBtn = searchDialog.querySelector('button.flat-row') as HTMLButtonElement;
    fireEvent.click(resultBtn);

    expect(await screen.findByLabelText('ノートタイトル')).toBeInTheDocument();
  });

  it('#27: chat popup shows errors and share actions catch rejections without unhandledRejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    const nodeProc = (globalThis as {
      process?: {
        on: (ev: string, cb: (r: unknown) => void) => void;
        off: (ev: string, cb: (r: unknown) => void) => void;
      };
    }).process;
    nodeProc?.on('unhandledRejection', onUnhandled);

    const note = makeNote();
    render(
      <NoteEditorView
        note={note}
        allNotes={[note]}
        folders={[{ id: 'personal', name: '個人', is_shared: false, permission: 'owner' }]}
        settings={baseSettings}
        recipes={[]}
        secretStatus={null}
        transcribing={false}
        transcribeError={null}
        onUpdateNote={vi.fn()}
        onCopyText={vi.fn()}
        onPastePrepare={vi.fn()}
        onSaveToNotion={vi.fn().mockRejectedValue(new Error('Notion fail'))}
        onSummarize={vi.fn()}
        onDraftFollowup={vi.fn()}
        onRunRecipe={vi.fn()}
        onSaveRecipe={vi.fn()}
        onChatNote={vi.fn().mockRejectedValue(new Error('Chat IPC error'))}
        onShareSlack={vi.fn().mockRejectedValue(new Error('Slack failure'))}
        onSendWebhook={vi.fn().mockRejectedValue(new Error('Webhook failure'))}
        onAddDictionaryTerm={vi.fn()}
        onGoSettings={vi.fn()}
      />
    );

    const chatInput = screen.getByRole('textbox', { name: 'ノートについて何でも質問' });
    fireEvent.change(chatInput, { target: { value: '質問テスト' } });
    await act(async () => {
      fireEvent.keyDown(chatInput, { key: 'Enter' });
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Chat IPC error');

    fireEvent.click(screen.getByRole('button', { name: '共有' }));
    await act(async () => {
      fireEvent.click(screen.getByText('Slack に共有'));
    });
    expect(screen.getByText('Slack failure')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Webhook 送信'));
    });
    expect(screen.getByText('Webhook failure')).toBeInTheDocument();

    await new Promise((r) => setTimeout(r, 20));
    nodeProc?.off('unhandledRejection', onUnhandled);
    expect(unhandled).toHaveLength(0);
  });

  it('migrates legacy popup chat sessions once and removes the localStorage copy', async () => {
    const note = makeNote();
    const legacy: PopupChatSession = {
      id: 'legacy-session',
      scopeKey: 'note:note-1',
      title: '旧チャット',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: [{ role: 'user', text: '以前の質問', createdAt: '2026-01-01T00:00:00.000Z' }],
    };
    localStorage.setItem('notelet_chat_sessions_v1', JSON.stringify([legacy]));
    const onSavePopupChatSessions = vi.fn().mockResolvedValue(undefined);
    const props = {
      note,
      allNotes: [note],
      settings: baseSettings,
      recipes: [],
      secretStatus: null,
      transcribing: false,
      transcribeError: null,
      onUpdateNote: vi.fn(),
      onCopyText: vi.fn(),
      onPastePrepare: vi.fn(),
      onSaveToNotion: vi.fn(),
      onSummarize: vi.fn(),
      onDraftFollowup: vi.fn(),
      onRunRecipe: vi.fn(),
      onSaveRecipe: vi.fn(),
      onChatNote: vi.fn(),
      onShareSlack: vi.fn(),
      onSendWebhook: vi.fn(),
      onAddDictionaryTerm: vi.fn(),
      onGoSettings: vi.fn(),
      popupChatSessions: [],
      onSavePopupChatSessions,
    };

    const { unmount } = render(<NoteEditorView {...props} />);
    await waitFor(() => {
      expect(onSavePopupChatSessions).toHaveBeenCalledWith([legacy]);
      expect(localStorage.getItem('notelet_chat_sessions_v1')).toBeNull();
    });
    unmount();

    render(<NoteEditorView {...props} />);
    expect(onSavePopupChatSessions).toHaveBeenCalledTimes(1);
  });

  it('persists a popup chat user message before waiting for the assistant response', async () => {
    const note = makeNote();
    let resolveAnswer!: (answer: ChatAnswer) => void;
    const onChatNote = vi.fn(
      () =>
        new Promise<ChatAnswer>((resolve) => {
          resolveAnswer = resolve;
        })
    );
    const onSavePopupChatSessions = vi.fn();
    render(
      <NoteEditorView
        note={note}
        allNotes={[note]}
        settings={baseSettings}
        recipes={[]}
        secretStatus={null}
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
        onChatNote={onChatNote}
        onShareSlack={vi.fn()}
        onSendWebhook={vi.fn()}
        onAddDictionaryTerm={vi.fn()}
        onGoSettings={vi.fn()}
        popupChatSessions={[]}
        onSavePopupChatSessions={onSavePopupChatSessions}
      />
    );

    const chatInput = screen.getByRole('textbox', { name: 'ノートについて何でも質問' });
    fireEvent.change(chatInput, { target: { value: '送信直後に保存' } });
    await act(async () => {
      fireEvent.keyDown(chatInput, { key: 'Enter' });
    });

    expect(onChatNote).toHaveBeenCalled();
    expect(onSavePopupChatSessions).toHaveBeenCalled();
    expect(onSavePopupChatSessions.mock.calls[0][0][0].messages).toEqual([
      expect.objectContaining({ role: 'user', text: '送信直後に保存' }),
    ]);

    await act(async () => {
      resolveAnswer({ answer: '回答', citations: [] });
    });
  });

  it('blocks starting a new recording when no ASR model is selected', async () => {
    const snapshot: AppDataSnapshot = {
      settings: { ...baseSettings, active_asr_model_id: '' },
      notes: [],
      folders: [{ id: 'personal', name: '個人ノート', is_shared: false, permission: 'owner' }],
      dictionary: [],
      recipes: [],
      audit_logs: [],
      chat_history: [],
    };
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_snapshot') return snapshot;
      if (cmd === 'list_asr_models' || cmd === 'list_audio_devices' || cmd === 'list_integration_adapters') return [];
      if (cmd === 'get_secret_status_cmd') return {};
      if (cmd === 'get_mcp_config_preview') return '';
      return null;
    });

    render(<App />);
    await screen.findByRole('button', { name: '録音' });
    fireEvent.click(screen.getByRole('button', { name: '録音' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ASRモデルが選択されていません');
    expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('start_recording', expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith('save_note', expect.anything());
  });

  it('blocks starting an additional recording when the selected ASR model is unavailable', async () => {
    const note = makeNote();
    const snapshot: AppDataSnapshot = {
      settings: baseSettings,
      notes: [note],
      folders: [{ id: 'personal', name: '個人ノート', is_shared: false, permission: 'owner' }],
      dictionary: [],
      recipes: [],
      audit_logs: [],
      chat_history: [],
    };
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_snapshot') return snapshot;
      if (cmd === 'list_asr_models' || cmd === 'list_audio_devices' || cmd === 'list_integration_adapters') return [];
      if (cmd === 'get_secret_status_cmd') return {};
      if (cmd === 'get_mcp_config_preview') return '';
      return null;
    });

    render(<App />);
    await screen.findByText('元のタイトル');
    fireEvent.click(screen.getByRole('button', { name: 'ノート' }));
    fireEvent.click(await screen.findByRole('button', { name: '再録音' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('選択中のASRモデルを確認できません');
    expect(screen.getByRole('dialog', { name: '設定' })).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith('start_recording', expect.anything());
  });

  it('#28 & #29: empty additional recording keeps existing segments and overlay-stop preserves live segments', async () => {
    const initialNote = makeNote();
    let currentSnap: AppDataSnapshot = {
      settings: baseSettings,
      notes: [initialNote],
      folders: [{ id: 'personal', name: '個人ノート', is_shared: false, permission: 'owner' }],
      dictionary: [],
      recipes: [],
      audit_logs: [],
      chat_history: [],
    };
    const savedNotes: Note[] = [];
    let nextTempWav: string | null = 'C:\\tmp\\rec.wav';

    invokeMock.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
      switch (cmd) {
        case 'get_snapshot':
          return currentSnap;
        case 'list_asr_models':
          return [{
            id: baseSettings.active_asr_model_id,
            name: 'Whisper Small',
            provider: 'local_whisper',
            is_local: true,
            is_compatible: true,
            compatibility_reason: null,
            installed: true,
            supports_realtime: true,
          }];
        case 'list_audio_devices':
        case 'list_integrations':
        case 'list_upcoming_calendar_events':
          return [];
        case 'get_secret_status':
          return { openai: true };
        case 'get_gpu_capabilities':
          return { has_nvidia: false, vram_mb: 0 };
        case 'get_recording_status':
          return { state: 'recording', elapsed_ms: 1000, rms_level: 0.1, temp_wav_path: nextTempWav, source_mode: 'mic' };
        case 'start_recording':
          return { state: 'recording', elapsed_ms: 0, rms_level: 0, temp_wav_path: nextTempWav, source_mode: 'mic' };
        case 'stop_recording':
          return { state: 'idle', elapsed_ms: 1000, rms_level: 0, temp_wav_path: nextTempWav, source_mode: 'mic' };
        case 'save_note': {
          const note = (args as { note: Note }).note;
          savedNotes.push(note);
          currentSnap = { ...currentSnap, notes: [note, ...currentSnap.notes.filter((n) => n.id !== note.id)] };
          return currentSnap;
        }
        case 'plugin:event|listen': {
          const { event, handler } = (args ?? {}) as { event: string; handler: number };
          const cb = callbackMap.get(handler);
          if (cb) {
            const arr = listenHandlers.get(event) ?? [];
            arr.push(cb);
            listenHandlers.set(event, arr);
          }
          return handler;
        }
        case 'plugin:event|unlisten':
          return null;
        case 'save_popup_chat_sessions': {
          const sessions = (args as { sessions: AppDataSnapshot['popup_chat_sessions'] }).sessions;
          currentSnap = { ...currentSnap, popup_chat_sessions: sessions };
          return currentSnap;
        }
        case 'transcribe_recording':
          return { ...initialNote, segments: [] };
        default:
          return null;
      }
    });

    render(<App />);
    await screen.findByText('元のタイトル');
    fireEvent.click(screen.getByRole('button', { name: 'ノート' }));
    await screen.findByRole('button', { name: '再録音' });

    // #28: Additional recording returns 0 segments -> existing 2 segments remain intact
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '再録音' }));
    });
    const stopBtn = await screen.findByRole('button', { name: '録音を停止' });
    await act(async () => {
      fireEvent.click(stopBtn);
    });
    await waitFor(() => {
      expect(savedNotes.length).toBeGreaterThanOrEqual(2);
    });
    expect(savedNotes[savedNotes.length - 1].segments).toHaveLength(2);

    // #29: New recording with live segment + overlay-stop-recording preserves live segment
    nextTempWav = null;
    const prevCount = savedNotes.length;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '録音' }));
    });
    await waitFor(() => {
      expect((listenHandlers.get('overlay-stop-recording') ?? []).length).toBeGreaterThan(0);
    });
    await act(async () => {
      for (const h of listenHandlers.get('live-transcript-segment') ?? []) {
        h({ payload: { id: 'live-1', speaker: 'You', start_ms: 0, end_ms: 1000, text: 'ライブ発言テスト' } });
      }
    });
    await act(async () => {
      for (const h of listenHandlers.get('overlay-stop-recording') ?? []) {
        h({ payload: null });
      }
    });
    await waitFor(() => {
      expect(savedNotes.length).toBeGreaterThanOrEqual(prevCount + 1);
    });
    expect(savedNotes[savedNotes.length - 1].segments.map((s) => s.text)).toContain('ライブ発言テスト');
  });

  it('#30: switching notes renders summary immediately without wiping and re-animating', () => {
    const noteA = makeNote({ id: 'n-a', title: 'ノートA', summary: 'ノートAの要約内容です' });
    const noteB = makeNote({ id: 'n-b', title: 'ノートB', summary: 'ノートBの要約内容です' });
    const props = {
      allNotes: [noteA, noteB],
      folders: [{ id: 'personal', name: '個人', is_shared: false, permission: 'owner' as const }],
      settings: baseSettings,
      recipes: [],
      secretStatus: null,
      transcribing: false,
      transcribeError: null,
      onUpdateNote: vi.fn(),
      onCopyText: vi.fn(),
      onPastePrepare: vi.fn(),
      onSaveToNotion: vi.fn(),
      onSummarize: vi.fn(),
      onDraftFollowup: vi.fn(),
      onRunRecipe: vi.fn(),
      onSaveRecipe: vi.fn(),
      onChatNote: vi.fn(),
      onShareSlack: vi.fn(),
      onSendWebhook: vi.fn(),
      onAddDictionaryTerm: vi.fn(),
      onGoSettings: vi.fn(),
    };

    const { rerender } = render(<NoteEditorView note={noteA} {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: '要約' }));
    expect(screen.getByText('ノートAの要約内容です')).toBeInTheDocument();

    rerender(<NoteEditorView note={noteB} {...props} />);
    expect(screen.getByText('ノートBの要約内容です')).toBeInTheDocument();
  });

  it('#31: Qwen runtime button is disabled when parakeet_cli_path is already set', async () => {
    const onInstallRuntime = vi.fn();
    render(
      <SettingsView
        settings={{ ...baseSettings, parakeet_cli_path: 'C:\\tools\\sherpa.exe' }}
        models={[]}
        secretStatus={null}
        downloadProgress={{}}
        updateProgress={null}
        onSaveSettings={vi.fn()}
        onDownloadModel={vi.fn()}
        onInstallRuntime={onInstallRuntime}
        onCheckUpdate={vi.fn()}
        onInstallUpdate={vi.fn()}
        onSetSecret={vi.fn()}
        onExportAll={vi.fn()}
        onPurgeAll={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByText(/Qwen/i));
    });
    const btn = screen.getByRole('button', { name: /導入済み/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(onInstallRuntime).not.toHaveBeenCalled();
  });

  it('#19: ErrorBoundary catches render errors and recovers on reset', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldThrow = true;
    const Boom = () => {
      if (shouldThrow) throw new Error('boom render failure');
      return <div>recovered ok</div>;
    };

    render(
      <ErrorBoundary fallbackTitle="テストエラー境界">
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('テストエラー境界');
    expect(screen.getByRole('alert')).toHaveTextContent('boom render failure');

    shouldThrow = false;
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(screen.getByText('recovered ok')).toBeInTheDocument();
    spy.mockRestore();
  });
});
