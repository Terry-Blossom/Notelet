import React, { useState } from 'react';
import { Upload, FileAudio, Loader2, Link2 } from 'lucide-react';
import { AppSettings, AsrModelInfo } from '../types';

interface UploadViewProps {
  settings: AppSettings;
  models: AsrModelInfo[];
  busy: boolean;
  error: string | null;
  onUploadAndTranscribe: (file: File) => Promise<void>;
  onUploadUrlAndTranscribe?: (url: string) => Promise<void>;
  onGoSettings: () => void;
}

export const UploadView: React.FC<UploadViewProps> = ({
  settings,
  models,
  busy,
  error,
  onUploadAndTranscribe,
  onUploadUrlAndTranscribe,
  onGoSettings,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState('');
  const activeModel = models.find((m) => m.id === settings.active_asr_model_id);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
  };

  return (
    <div className="page-container">
      <div>
        <h1 className="page-title">アップロード</h1>
        <p className="text-secondary" style={{ margin: '4px 0 0' }}>
          手元にある音声ファイルを読み込み、選択中の音声認識モデルで文字起こしします
        </p>
      </div>

      <section className="surface-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ fontSize: '14px' }}>
            使用中のASRモデル: <strong>{activeModel ? activeModel.name : settings.active_asr_model_id}</strong>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onGoSettings}>
            モデルを変更
          </button>
        </div>

        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            padding: '32px 24px',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--border-strong)',
            backgroundColor: 'var(--bg-subtle)',
            cursor: 'pointer',
          }}
        >
          <Upload size={24} strokeWidth={1.5} color="var(--accent)" />
          <div style={{ fontWeight: 600 }}>
            {selectedFile ? selectedFile.name : '音声ファイルを選択（WAV / MP3 / M4A / OGG / FLAC）'}
          </div>
          <div className="text-muted">
            ローカルモデルは16kHz WAV形式に最適化されています（クラウドASRはMP3/M4A等も直接処理できます）
          </div>
          <input
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </label>

        {selectedFile && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileAudio size={16} strokeWidth={1.5} />
              <span>{selectedFile.name}</span>
              <span className="mono-num text-muted">
                ({(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => onUploadAndTranscribe(selectedFile)}
            >
              {busy ? <Loader2 size={16} strokeWidth={1.5} /> : <Upload size={16} strokeWidth={1.5} />}
              {busy ? '文字起こし中' : '文字起こしを開始'}
            </button>
          </div>
        )}

        {onUploadUrlAndTranscribe && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!videoUrl.trim() || busy) return;
              await onUploadUrlAndTranscribe(videoUrl.trim());
            }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              paddingTop: '12px',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <label className="text-muted" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Link2 size={13} strokeWidth={1.5} />
              <span>動画・音声リンク (URL) から文字起こし</span>
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                type="url"
                className="input"
                style={{ flex: '1 1 260px' }}
                placeholder="https://example.com/meeting.mp4 または動画URL"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                disabled={busy}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={busy || !videoUrl.trim()}
              >
                {busy ? <Loader2 size={15} strokeWidth={1.5} className="spin" /> : <Link2 size={15} strokeWidth={1.5} />}
                {busy ? '文字起こし中' : 'リンクから文字起こし'}
              </button>
            </div>
          </form>
        )}

        {error && (
          <div className="surface-subtle" style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}
      </section>
    </div>
  );
};
