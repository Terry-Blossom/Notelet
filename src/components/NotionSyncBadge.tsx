import React from 'react';
import { Loader2 } from 'lucide-react';
import { NotionSyncState } from '../types';

interface NotionSyncBadgeProps {
  status: NotionSyncState['status'];
}

const NotionLogoSvg: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.85"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <path d="M8.5 16.5V7.5l7 9V7.5" />
  </svg>
);

export const NotionSyncBadge: React.FC<NotionSyncBadgeProps> = ({ status }) => {
  if (status === 'synced') {
    return (
      <span
        title="Notion 同期済み"
        aria-label="Notion 同期済み"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '24px',
          height: '24px',
          color: 'var(--text-primary)',
          flexShrink: 0,
        }}
      >
        <NotionLogoSvg />
      </span>
    );
  }

  if (status === 'syncing') {
    return (
      <span
        title="Notion 同期中"
        aria-label="Notion 同期中"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--text-secondary)',
          flexShrink: 0,
        }}
      >
        <Loader2 size={14} strokeWidth={1.75} className="spin" />
        <span>同期中</span>
      </span>
    );
  }

  return (
    <span
      title="Notion 未同期"
      aria-label="Notion 未同期"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '12px',
        fontWeight: 600,
        color: 'var(--danger)',
        flexShrink: 0,
      }}
    >
      <NotionLogoSvg />
      <span>{status === 'failed' ? '同期失敗' : '未同期'}</span>
    </span>
  );
};
