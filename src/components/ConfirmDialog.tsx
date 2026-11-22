import React, { useEffect, useState } from 'react';

interface ConfirmRequest {
  title: string;
  detail?: string;
  resolve: (confirmed: boolean) => void;
}

let activeListener: ((req: ConfirmRequest) => void) | null = null;

export function confirmDeleteDialog(title: string, detail?: string): Promise<boolean> {
  if (activeListener) {
    return new Promise<boolean>((resolve) => {
      activeListener?.({ title, detail, resolve });
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
      aria-label="削除の確認"
      style={{ zIndex: 300 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose(false);
      }}
    >
      <div
        className="surface-card"
        style={{
          width: '380px',
          maxWidth: 'calc(100vw - 32px)',
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
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => handleClose(true)}
            autoFocus
          >
            削除する
          </button>
        </div>
      </div>
    </div>
  );
};
