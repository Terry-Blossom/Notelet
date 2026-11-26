import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/**
 * UI ツリー内の描画時エラーを捕捉し、アプリ全体が白画面で停止するのを防ぐエラー境界。
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown): void {
    console.error('ErrorBoundary caught render error:', error);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, message: '' });
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="surface-card"
          style={{
            margin: '24px',
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}
        >
          <strong style={{ fontSize: '15px' }}>
            {this.props.fallbackTitle || '画面の表示中にエラーが発生しました'}
          </strong>
          {this.state.message && (
            <div
              className="text-muted"
              style={{ fontSize: '13px', wordBreak: 'break-word' }}
            >
              {this.state.message}
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="button" className="btn btn-primary" onClick={this.handleReset}>
              再試行
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
