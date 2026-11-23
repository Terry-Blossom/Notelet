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

  it('displays executed AI chat actions and inline citations in ChatView history', () => {
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

    const inlineBadge = screen.getByRole('button', { name: '引用 1: 週次定例' });
    fireEvent.click(inlineBadge);
    expect(onOpenNote).toHaveBeenCalledWith('note-a');
  });
});
