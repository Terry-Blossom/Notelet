import React, { useEffect, useState } from 'react';
import { t } from '../i18n';

interface ConfirmRequest {
  title: string;
  detail?: string;
  confirmLabel?: string;
  isDanger?: boolean;
  resolve: (confirmed: boolean) => void;
}

let activeListener: ((req: ConfirmRequest) => void) | null = null;

export function confirmDeleteDialog(title: string, detail?: string): Promise<boolean> {
  return confirmActionDialog(title, detail, t('削除する'), true);
}

export function confirmActionDialog(
  title: string,
  detail?: string,
  confirmLabel = t('開く'),
  isDanger = false
): Promise<boolean> {
  if (activeListener) {
    return new Promise<boolean>((resolve) => {
      activeListener?.({ title, detail, confirmLabel, isDanger, resolve });
    });
  }
  if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
    return Promise.resolve(window.confirm(detail ? `${title}\n${detail}` : title));
  }
  return Promise.resolve(true);
}

export const ConfirmDialogHost: React.FC = () => {
  const [req, setReq] = useState<ConfirmRequest | null>(null);

  useEffect(() => {
    activeListener = (nextReq) => setReq(nextReq);
    return () => {
      activeListener = null;
    };
  }, []);

  if (!req) return null;

  const handleClose = (result: boolean) => {
    const r = req;
    setReq(null);
    r.resolve(result);
  };

  return (
    <div
      className="settings-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t('確認')}
      style={{ zIndex: 300 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose(false);
      }}
    >
      <div
        className="surface-card"
        style={{
          width: 'min(380px, calc(100vw - 24px))',
          maxWidth: 'calc(100vw - 24px)',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>{req.title}</strong>
        {req.detail && (
          <div className="text-secondary" style={{ fontSize: '13px' }}>
            {req.detail}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => handleClose(false)}
          >
            {t('キャンセル')}
          </button>
          <button
            type="button"
            className={`btn ${req.isDanger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => handleClose(true)}
            autoFocus
          >
            {req.confirmLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
};
