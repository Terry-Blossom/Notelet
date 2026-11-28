import React from 'react';
import { Loader2 } from 'lucide-react';
import { NotionSyncState } from '../types';
import { t } from '../i18n';
import { apiOpenExternalUrl, isTauriRuntime } from '../lib/tauri';

interface NotionSyncBadgeProps {
  status: NotionSyncState['status'];
  pageUrl?: string | null;
}

// Official Notion 3D cube "N" mark
export const OfficialNotionLogo: React.FC<{ size?: number }> = ({ size = 17 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 100 100"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M6.017 4.313l55.333-4.087c6.797-.583 8.543-.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277-1.553 6.807-6.99 7.193L24.467 99.967c-4.08.193-6.023-.39-8.16-3.113L3.3 79.94c-2.333-3.113-3.3-5.443-3.3-8.167V11.113c0-3.497 1.553-6.413 6.017-6.8z"
      fill="currentColor"
      fillOpacity="0.1"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M61.35.226L6.017 4.313C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257-3.89c5.433-.387 6.99-2.917 6.99-7.193V20.64c0-2.21-.873-2.847-3.443-4.733L74.167 3.143C69.893.037 68.147-.357 61.35.226zM25.727 19.226c-5.227.347-6.417.427-9.4-1.99L8.747 11.21c-.773-.773-.387-1.747 1.553-1.94l52.8-3.89c4.467-.387 6.797 1.167 8.543 2.527l9.123 6.61c.387.193 1.36 1.36.193 1.36l-54.26 3.257-.972.092zM19.327 88.627V30.367c0-2.527.777-3.693 3.107-3.887l62.313-3.693c2.137-.193 3.107 1.167 3.107 3.693v57.873c0 2.527-.387 4.667-3.883 4.86l-59.597 3.5c-3.497.193-5.047-.97-5.047-4.086zm58.843-54.99c.387 1.75 0 3.5-1.75 3.693l-2.913.583v42.77c-2.527 1.36-4.853 2.137-6.797 2.137-3.107 0-3.883-.973-6.213-3.887L41.437 48.88v29.157l6.023 1.36s0 3.5-4.857 3.5l-13.39.777c-.387-.777 0-2.723 1.357-3.11l3.497-.973V40.917l-4.857-.39c-.387-1.75.583-4.277 3.3-4.47l14.367-.97 19.6 30.13V38.193l-5.05-.583c-.387-2.14 1.167-3.693 3.107-3.887l13.597-.086z"
      fill="currentColor"
    />
  </svg>
);

export const NotionSyncBadge: React.FC<NotionSyncBadgeProps> = ({ status, pageUrl }) => {
  const handleOpenPage = (e: React.MouseEvent) => {
    if (!pageUrl) return;
    e.stopPropagation();
    e.preventDefault();
    if (isTauriRuntime()) {
      void apiOpenExternalUrl(pageUrl);
    } else {
      window.open(pageUrl, '_blank', 'noopener,noreferrer');
    }
  };

  if (status === 'synced') {
    if (pageUrl) {
      return (
        <button
          type="button"
          title={t('Notion でこのページを開く')}
          aria-label={t('Notion でこのページを開く')}
          onClick={handleOpenPage}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            color: 'var(--text-primary)',
            flexShrink: 0,
            cursor: 'pointer',
          }}
        >
          <OfficialNotionLogo />
        </button>
      );
    }
    return (
      <span
        title={t('Notion 同期済み')}
        aria-label={t('Notion 同期済み')}
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
        <OfficialNotionLogo />
      </span>
    );
  }

  if (status === 'syncing') {
    return (
      <span
        title={t('Notion 同期中')}
        aria-label={t('Notion 同期中')}
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
        <span>{t('同期中')}</span>
      </span>
    );
  }

  return (
    <span
      title={t('Notion 未同期')}
      aria-label={t('Notion 未同期')}
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
      <OfficialNotionLogo />
      <span>{status === 'failed' ? t('同期失敗') : t('未同期')}</span>
    </span>
  );
};
