import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChatCitation } from '../types';

interface StreamingMarkdownArticleProps {
  content: string;
  isGenerating?: boolean;
  animateOnChange?: boolean;
  placeholder?: string;
  citations?: ChatCitation[];
  onCitationClick?: (citation: ChatCitation) => void;
  thinking?: string | null;
}

function renderInlineMarkdown(
  text: string,
  citations?: ChatCitation[],
  onCitationClick?: (citation: ChatCitation) => void
): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d+\])/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={idx} className="md-inline-code">
          {part.slice(1, -1)}
        </code>
      );
    }
    const citeMatch = part.match(/^\[(\d+)\]$/);
    if (citeMatch && citations && citations.length > 0) {
      const num = Number(citeMatch[1]);
      const citation = citations[num - 1];
      if (citation) {
        const tooltip = `${citation.note_title} [${citation.timestamp}]: ${citation.excerpt}`;
        return (
          <button
            key={idx}
            type="button"
            className="inline-citation-badge"
            title={tooltip}
            aria-label={`引用 ${num}: ${citation.note_title}`}
            onClick={(e) => {
              e.stopPropagation();
              onCitationClick?.(citation);
            }}
          >
            {num}
          </button>
        );
      }
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const StreamingMarkdownArticle: React.FC<StreamingMarkdownArticleProps> = ({
  content,
  isGenerating = false,
  animateOnChange = false,
  placeholder = '',
  citations,
  onCitationClick,
  thinking,
}) => {
  const [displayedText, setDisplayedText] = useState(content);
  const [isAnimating, setIsAnimating] = useState(false);
  const prevContentRef = useRef(content);

  useEffect(() => {
    if (!content) {
      setDisplayedText('');
      setIsAnimating(false);
      prevContentRef.current = '';
      return;
    }

    if (animateOnChange && content !== prevContentRef.current) {
      prevContentRef.current = content;
      setDisplayedText('');
      setIsAnimating(true);
    } else if (!isAnimating) {
      prevContentRef.current = content;
      setDisplayedText(content);
    }
  }, [content, animateOnChange, isAnimating]);

  useEffect(() => {
    if (!isAnimating) return;
    if (displayedText.length >= content.length) {
      setIsAnimating(false);
      return;
    }
    const diff = content.length - displayedText.length;
    const step = diff > 120 ? Math.ceil(diff / 12) : diff > 30 ? 4 : 2;
    const timer = setTimeout(() => {
      setDisplayedText(content.slice(0, displayedText.length + step));
    }, 16);
    return () => clearTimeout(timer);
  }, [isAnimating, displayedText, content]);

  const blocks = useMemo(() => {
    const raw = displayedText.trim();
    if (!raw) return [];
    const lines = raw.split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: string[] = [];
    let orderedItems: string[] = [];
    let codeLines: string[] = [];
    let inCode = false;

    const flushLists = (keyPrefix: string) => {
      if (listItems.length > 0) {
        elements.push(
          <ul key={`${keyPrefix}-ul`} className="md-article-list">
            {listItems.map((item, idx) => (
              <li key={idx}>{renderInlineMarkdown(item, citations, onCitationClick)}</li>
            ))}
          </ul>
        );
        listItems = [];
      }
      if (orderedItems.length > 0) {
        elements.push(
          <ol key={`${keyPrefix}-ol`} className="md-article-list">
            {orderedItems.map((item, idx) => (
              <li key={idx}>{renderInlineMarkdown(item, citations, onCitationClick)}</li>
            ))}
          </ol>
        );
        orderedItems = [];
      }
    };

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith('```')) {
        flushLists(`code-${idx}`);
        if (inCode) {
          elements.push(
            <pre key={`pre-${idx}`} className="md-article-code">
              <code>{codeLines.join('\n')}</code>
            </pre>
          );
          codeLines = [];
          inCode = false;
        } else {
          inCode = true;
        }
        return;
      }

      if (inCode) {
        codeLines.push(line);
        return;
      }

      if (!trimmed) {
        flushLists(`empty-${idx}`);
        return;
      }

      if (trimmed === '---' || trimmed === '***') {
        flushLists(`hr-${idx}`);
        elements.push(<hr key={`hr-${idx}`} className="md-article-hr" />);
        return;
      }

      if (trimmed.startsWith('### ')) {
        flushLists(`h3-${idx}`);
        elements.push(
          <h4 key={`h3-${idx}`} className="md-article-h3">
            {renderInlineMarkdown(trimmed.slice(4), citations, onCitationClick)}
          </h4>
        );
        return;
      }

      if (trimmed.startsWith('## ')) {
        flushLists(`h2-${idx}`);
        elements.push(
          <h3 key={`h2-${idx}`} className="md-article-h2">
            {renderInlineMarkdown(trimmed.slice(3), citations, onCitationClick)}
          </h3>
        );
        return;
      }

      if (trimmed.startsWith('# ')) {
        flushLists(`h1-${idx}`);
        elements.push(
          <h2 key={`h1-${idx}`} className="md-article-h1">
            {renderInlineMarkdown(trimmed.slice(2), citations, onCitationClick)}
          </h2>
        );
        return;
      }

      if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('・')) {
        const itemText = trimmed.startsWith('・') ? trimmed.slice(1).trim() : trimmed.slice(2).trim();
        listItems.push(itemText);
        return;
      }

      const orderedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
      if (orderedMatch) {
        orderedItems.push(orderedMatch[1]);
        return;
      }

      if (trimmed.startsWith('> ')) {
        flushLists(`bq-${idx}`);
        elements.push(
          <blockquote key={`bq-${idx}`} className="md-article-quote">
            {renderInlineMarkdown(trimmed.slice(2), citations, onCitationClick)}
          </blockquote>
        );
        return;
      }

      flushLists(`p-${idx}`);
      elements.push(
        <p key={`p-${idx}`} className="md-article-p">
          {renderInlineMarkdown(trimmed, citations, onCitationClick)}
        </p>
      );
    });

    flushLists('final');
    if (codeLines.length > 0) {
      elements.push(
        <pre key="pre-final" className="md-article-code">
          <code>{codeLines.join('\n')}</code>
        </pre>
      );
    }

    return elements;
  }, [displayedText, citations, onCitationClick]);

  if (isGenerating && !displayedText.trim()) {
    return (
      <div className="md-stream-skeleton" aria-live="polite">
        <div className="md-stream-status">
          <span className="md-stream-pulse" />
          <span>思考中...</span>
        </div>
        <div className="md-shimmer-line" style={{ width: '88%' }} />
        <div className="md-shimmer-line" style={{ width: '72%' }} />
        <div className="md-shimmer-line" style={{ width: '60%' }} />
      </div>
    );
  }

  if (!displayedText.trim() && !thinking) {
    return placeholder ? (
      <p className="text-muted" style={{ margin: '0px' }}>
        {placeholder}
      </p>
    ) : null;
  }

  return (
    <div className={`md-article ${isGenerating || isAnimating ? 'streaming' : ''}`}>
      {thinking && thinking.trim() && (
        <div
          className="ai-thinking-block"
          style={{
            marginBottom: '10px',
            padding: '8px 10px',
            borderRadius: '8px',
            backgroundColor: 'var(--bg-canvas)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-muted, #6b7280)',
            fontSize: '12px',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: '2px', fontSize: '11px' }}>思考プロセス</div>
          {thinking}
        </div>
      )}
      {blocks}
      {(isGenerating || isAnimating) && <span className="ai-stream-cursor" aria-hidden="true" />}
    </div>
  );
};
