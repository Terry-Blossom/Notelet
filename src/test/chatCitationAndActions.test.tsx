import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StreamingMarkdownArticle } from '../components/StreamingMarkdownArticle';
import { ChatView } from '../components/ChatView';
import { createEmptyNote } from '../lib/format';
import { AppSettings, ChatCitation } from '../types';

describe('Inline citation badges and AI chat actions', () => {
  it('renders clickable inline citation badges at the end of sentences', () => {
    const onCitationClick = vi.fn();
    const citations: ChatCitation[] = [
      {
        note_id: 'note-1',
        note_title: 'Q4 ロードマップ会議',
        timestamp: '02:15',
        excerpt: 'リリース日は12月10日に決定しました。',
      },
      {
        note_id: 'note-2',
        note_title: 'デザインレビュー',
        timestamp: '要約',
        excerpt: '配色コントラストを改善する。',
      },
    ];

    render(
      <StreamingMarkdownArticle
        content={'リリース日は12月10日に決まりました [1]\n\n- 配色コントラストを改善します [2]'}
        citations={citations}
        onCitationClick={onCitationClick}
      />
    );

    const badge1 = screen.getByRole('button', { name: '引用 1: Q4 ロードマップ会議' });
    const badge2 = screen.getByRole('button', { name: '引用 2: デザインレビュー' });
    expect(badge1).toHaveTextContent('1');
    expect(badge2).toHaveTextContent('2');

    fireEvent.click(badge2);
    expect(onCitationClick).toHaveBeenCalledWith(citations[1]);
  });

  it('displays executed AI chat actions and inline citations in ChatView history', async () => {
    const note = createEmptyNote();
    note.id = 'note-a';
    note.title = '週次定例';
    const onOpenNote = vi.fn();

    render(
      <ChatView
        notes={[note]}
        folders={[{ id: 'meeting', name: '会議', is_shared: false, permission: 'owner' }]}
        chatHistory={[
          {
            id: 'h-1',
            timestamp: '2026-11-22T12:00:00Z',
            question: 'タイトルを「週次定例」に変更して要約を教えて',
            answer: 'タイトルを変更し、要約を確認しました [1]',
            citations: [
              {
                note_id: 'note-a',
                note_title: '週次定例',
                timestamp: '00:10',
                excerpt: '今週の進捗を共有します。',
              },
            ],
            actions: [
              {
                action: 'rename_note',
                target_id: 'note-a',
                description: 'ノート「無題」のタイトルを「週次定例」に変更しました',
                success: true,
              },
            ],
          },
        ]}
        settings={{} as AppSettings}
        onChatAcrossNotes={vi.fn()}
        onOpenNote={onOpenNote}
        onClearHistory={vi.fn()}
        onDeleteHistoryItems={vi.fn()}
        onGoSettings={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText('タイトルを「週次定例」に変更して要約を教えて'));
    expect(screen.getByText('ノート「無題」のタイトルを「週次定例」に変更しました')).toBeInTheDocument();

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const inlineBadge = screen.getByRole('button', { name: '引用 1: 週次定例' });
    fireEvent.click(inlineBadge);
    await vi.waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(onOpenNote).toHaveBeenCalledWith('note-a', '00:10', '今週の進捗を共有します。');
    });
    confirmSpy.mockRestore();
  });

  it('requires explicit approval before applying AI-proposed destructive actions', async () => {
    const note = createEmptyNote();
    note.id = 'note-danger';
    note.title = '重要ノート';
    const proposal = {
      id: 'proposal-1',
      action: 'delete_note',
      target_id: 'note-danger',
      description: 'ノート「重要ノート」を削除',
      spec: { type: 'delete_note', note_id: 'note-danger' },
    };
    const onChatAcrossNotes = vi.fn().mockResolvedValue({
      answer: 'このノートを削除しますか？',
      citations: [],
      proposed_actions: [proposal],
    });
    const onApplyChatActions = vi.fn().mockResolvedValue([
      {
        action: 'delete_note',
        target_id: 'note-danger',
        description: 'ノート「重要ノート」を削除しました',
        success: true,
      },
    ]);

    render(
      <ChatView
        notes={[note]}
        folders={[]}
        chatHistory={[]}
        settings={{} as AppSettings}
        onChatAcrossNotes={onChatAcrossNotes}
        onApplyChatActions={onApplyChatActions}
        onOpenNote={vi.fn()}
        onClearHistory={vi.fn()}
        onGoSettings={vi.fn()}
      />
    );

    fireEvent.change(screen.getByPlaceholderText(/何でも質問/), {
      target: { value: '古いノートを削除して' },
    });
    fireEvent.click(screen.getByRole('button', { name: '質問を送信' }));

    expect(await screen.findByText(/AI が提案した変更/)).toBeInTheDocument();
    // 承認前には何も実行されない
    expect(onApplyChatActions).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '承認' }));
    await vi.waitFor(() => expect(onApplyChatActions).toHaveBeenCalledWith([proposal]));
    expect(await screen.findByText('ノート「重要ノート」を削除しました')).toBeInTheDocument();
  });
});
