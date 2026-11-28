export const dict: Record<string, string> = {
  // Settings navigation
  AIモデル: 'AI models',
  データ管理: 'Data',
  一般: 'General',
  'ショートカット・再生': 'Shortcuts & playback',
  設定メニュー: 'Settings menu',

  // Microphone test / audio status
  'マイクテスト失敗: {0}': 'Microphone test failed: {0}',
  'マイク入力元の更新に失敗しました: {0}': 'Failed to refresh microphone inputs: {0}',
  設定を保存しました: 'Settings saved',
  'APIキーを保存し、クラウド音声認識を有効化しました': 'API key saved and cloud speech recognition enabled',
  'APIキーを暗号化して保存しました': 'API key encrypted and saved',
  'APIキーの保存に失敗しました: {0}': 'Failed to save API key: {0}',
  '録音音声を軽量化しました': 'Recording audio compressed',
  'JSON バックアップを復元・マージしました': 'JSON backup restored and merged',
  '全ノートを消去しました': 'All notes erased',
  '同期済みノートを Notion オンラインのみに整理しました': 'Synced notes now live only in Notion online',

  // ASR models
  '高精度・推奨': 'High accuracy · Recommended',
  '最高精度 (FP16)': 'Best accuracy (FP16)',
  上位モデル: 'Higher-tier model',
  '軽量・省メモリ': 'Lightweight · low memory',
  '日本語対応・推奨': 'Japanese support · Recommended',
  '中英特化（日本語時は3-Maxへ自動切替）': 'Chinese/English focused (switches to 3-Max for Japanese)',
  '多言語対応・自動判定': 'Multilingual · auto-detect',
  クラウドAPI: 'Cloud API',
  リアルタイム対応: 'Live support',
  ダウンロード: 'Download',
  使用中: 'In use',
  選択する: 'Select',
  'モデル容量 {0}MB': 'Model size {0} MB',
  'メモリ目安 {0}MB': 'Memory ~{0} MB',
  キー保存済み: 'Key saved',
  キー未設定: 'No key set',
  '{0}（更新する場合のみ入力）': '{0} (enter only to update)',
  '{0} を入力': 'Enter {0}',
  '確認中...': 'Checking...',
  接続テスト: 'Test connection',
  'OpenAI互換 API Key': 'OpenAI-compatible API Key',

  // ASR tab headings
  '音声認識 (ASR) モデル': 'Speech recognition (ASR) models',
  'エンジン別にカテゴリ分けされています。用途に合わせて選択してください。':
    'Models are grouped by engine. Choose the one that fits your use.',
  'ASRモデルが未選択です。利用するモデルを選択してください。': 'No ASR model selected. Choose a model to use.',
  '認識言語（全モデル共通）': 'Recognition language (all models)',
  '日本語 (ja)': 'Japanese (ja)',
  '英語 (en)': 'English (en)',
  自動判定: 'Auto-detect',
  'ローカル文字起こしで簡易話者分離を行う（無音の間隔と疑問文から話者A/Bを推定）':
    'Estimate speakers in local transcription (infers speaker A/B from silence gaps and questions)',
  'マイク入力テスト & 音量バランス': 'Microphone test & level balance',
  '録音前にマイクの反応と、マイク／PC音声（両方録音時）の音量倍率を確認・調整できます':
    'Check microphone response and mic/system audio gain (when recording both) before recording',
  'テストを停止': 'Stop test',
  'マイクをテスト': 'Test microphone',
  マイク入力元: 'Microphone input',
  '既定のマイク (自動)': 'Default microphone (auto)',
  マイク入力元を再読み込み: 'Reload microphone inputs',
  'テスト中 {0}s': 'Testing {0}s',
  '入力なし/極小': 'No/very low input',
  正常に検出: 'Detected',
  'マイク音量倍率: {0}x': 'Mic gain: {0}x',
  'システム音声倍率: {0}x': 'System audio gain: {0}x',
  音声認識エンジンカテゴリ: 'Speech recognition engine categories',
  'クラウド API ({0})': 'Cloud API ({0})',

  // Local runtimes
  'whisper.cpp 実行エンジン': 'whisper.cpp runtime',
  導入済み: 'Installed',
  未導入: 'Not installed',
  '導入中 ({0}%)': 'Installing ({0}%)',
  'GPU/OpenBLAS版へ更新・再導入': 'Update/reinstall GPU/OpenBLAS build',
  ワンクリック導入: 'One-click install',
  'GPU アクセラレータを有効にする（CUDA / Metal・エラー時は自動でCPUへフォールバック）':
    'Enable GPU acceleration (CUDA / Metal; falls back to CPU on error)',
  '検出: {0}': 'Detected: {0}',
  実行バイナリのパスを手動で指定する: 'Specify the executable path manually',
  '例: {0}': 'e.g. {0}',
  'sherpa-onnx 実行エンジン': 'sherpa-onnx runtime',
  '実行エンジン（sherpa-onnx-offline）': 'Runtime (sherpa-onnx-offline)',
  '設定済み: {0}': 'Configured: {0}',
  'Qwen3-ASR は Parakeet と共通の sherpa-onnx-offline 実行エンジンが必要です':
    'Qwen3-ASR needs the sherpa-onnx-offline runtime shared with Parakeet',

  // Cloud ASR
  'クラウド音声認識の使い方（3ステップ）': 'Using cloud speech recognition (3 steps)',
  '① 下のスイッチを ON（または下のAPIキーを保存すると自動ON） → ② 使いたいサービスのAPIキーを保存 → ③「選択する」をクリック':
    '① Turn on the switch below (saving an API key below also turns it on) → ② Save the API key for the service you want → ③ Click "Select"',
  'クラウド音声認識を有効にする': 'Enable cloud speech recognition',
  '有効時のみ、選択したクラウドAPIへ音声を送信します（録音中は約3秒ごとにリアルタイム文字起こし、停止時に全体で最終確定します）':
    'Audio is sent to the selected cloud API only when enabled (realtime transcription about every 3 seconds while recording, finalized on stop)',

  // LLM tab
  'エージェント (LLM) 設定': 'Agent (LLM) settings',
  '要約・チャット検索・ノート操作エージェントで使用するプロバイダーを選択してください（音声ファイルは送信されません）。':
    'Choose the provider used for summaries, chat search, and note actions (audio files are never sent).',
  LLMプロバイダー選択: 'Select LLM provider',
  'OpenAI互換 (OpenRouter等)': 'OpenAI-compatible (OpenRouter etc.)',
  'ローカル Ollama': 'Local Ollama',
  オフ: 'Off',
  'AI機能はオフになっています。チャット画面ではノート内のキーワード検索結果が表示されます。':
    'AI features are off. Chat shows keyword search results from your notes.',
  'ベース URL': 'Base URL',
  'LM Studio (ローカル)': 'LM Studio (local)',
  'Ollama エンドポイント URL': 'Ollama endpoint URL',
  モデル名: 'Model name',
  '例: openai/gpt-4o-mini / google/gemini-2.5-flash': 'e.g. openai/gpt-4o-mini / google/gemini-2.5-flash',
  モデル名を入力: 'Enter a model name',
  保存済み: 'Saved',
  未設定: 'Not set',
  '保存済み（更新する場合のみ新しいキーを入力）': 'Saved (enter a new key only to update)',
  'APIキーを入力（入力後に保存を押してください）': 'Enter API key (press Save after entering)',

  // Custom prompt
  '独自ルール・カスタムプロンプト（事前設定可）': 'Custom rules & prompt (can be set in advance)',
  'AIプロバイダー設定前でも事前にルールを保存できます。要約・チャット実行時に毎回適用されます。':
    'You can save rules before configuring an AI provider. They apply to every summary and chat run.',
  '独自ルール・カスタムプロンプト': 'Custom rules & prompt',
  '例: 回答は常に結論から箇条書きで記述してください。専門用語には簡単な補足を添えてください。':
    'e.g. Always lead with the conclusion in bullet points. Add a brief note for technical terms.',

  // Summary presets
  '要約プリセットの作成・編集': 'Create & edit summary presets',
  'ノートの要約生成時に選べるプリセットを自由に作成・編集できます。':
    'Create and edit the presets you can choose from when summarizing notes.',
  新しいプリセット: 'New preset',
  'summaryフィールドには「## 概要」「## 重要ポイント」「## ネクストアクション」の見出しを使って整理してください。':
    'Organize the summary field with the headings "## Overview", "## Key points", and "## Next actions".',
  プリセットを追加: 'Add preset',
  デフォルトに戻す: 'Reset to defaults',
  'プリセット名 ({0})': 'Preset name ({0})',
  プリセット名: 'Preset name',
  既定のプリセット: 'Default preset',
  既定にする: 'Make default',
  '{0}を削除': 'Delete {0}',
  'プリセット指示 ({0})': 'Preset instructions ({0})',
  '要約の構成やフォーマットの指示を入力...': 'Enter instructions for summary structure and format...',

  // Shortcuts / appearance
  ショートカットキー: 'Keyboard shortcuts',
  'どのアプリを開いていても録音や音声入力を呼び出せます。': 'Trigger recording or voice typing from any app.',
  '録音開始 / 停止': 'Start / stop recording',
  '音声入力 (Voice Typing)': 'Voice typing',
  '外観・通知・音声再生設定': 'Appearance, notifications & playback',
  カラーテーマ: 'Color theme',
  ライト: 'Light',
  ダーク: 'Dark',
  OS設定に合わせる: 'Match system',
  'カレンダー予定の開始前に録音リマインダーを表示する': 'Show a recording reminder before calendar events start',
  '無音スキップ機能を有効にする（クラウド送信時の無音トリミング・再生時早送り）':
    'Enable silence skipping (trims silence sent to the cloud; fast-forwards during playback)',

  // Storage
  ストレージ管理: 'Storage',
  '録音ファイルの容量管理・軽量化やデータの暗号化・バックアップを管理します。':
    'Manage recording size and compression, plus encryption and backups.',
  ストレージ使用状況: 'Storage usage',
  保存フォルダを開く: 'Open storage folder',
  '{0} 件の録音を軽量化しました（-{1}）': 'Compressed {0} recordings (-{1})',
  'すべての録音ファイルは既に最適化されています': 'All recording files are already optimized',
  '軽量化中...': 'Compressing...',
  '録音音声を軽量化（容量圧縮）': 'Compress recording audio',
  '録音音声: {0} ({1}件)': 'Recording audio: {0} ({1} files)',
  'ローカルモデル: {0}': 'Local models: {0}',
  'Notion オンラインビュワーモード': 'Notion online viewer mode',
  'Google Keep のように、同期済みノートの本体や録音音声をローカルから削除し、Notion 上のデータを直接閲覧します。':
    'Like Google Keep, delete synced notes and audio locally and view the data directly on Notion.',
  '同期済みノートのローカルデータを削除して「Notionのみ」にしますか？':
    'Delete local data for synced notes and keep them "Notion only"?',
  'Notion 上のデータは保持され、Notelet からオンライン閲覧できます。':
    'Data stays in Notion and can be viewed online from Notelet.',
  整理する: 'Clean up',
  '同期済みノートのローカルデータを整理': 'Clean up local data of synced notes',
  'Notion 同期後にローカルの本文・音声を自動削除する':
    'Automatically delete local text and audio after Notion sync',
  '保持する音声ファイルを AES-256-GCM で暗号化する': 'Encrypt retained audio files with AES-256-GCM',
  '文字起こし完了後に保持音声を削除する（テキストのみ保存）':
    'Delete retained audio after transcription (keep text only)',
  '全データをJSONエクスポート': 'Export all data as JSON',
  'Markdown / Obsidian 一括エクスポート (ZIP)': 'Bulk export Markdown / Obsidian (ZIP)',
  'JSON バックアップから復元': 'Restore from JSON backup',
  全ノートを初期化: 'Reset all notes',
  消去を確定: 'Confirm erase',
  キャンセル: 'Cancel',

  // Import
  データインポート: 'Import data',
  '外部ノートアプリ（Granola 等）からのデータ移行を行います。': 'Migrate data from other note apps (Granola etc.).',

  // App updates
  アプリ更新: 'App updates',
  'GitHub Releases から最新バージョンを確認してワンクリックで更新できます。':
    'Check the latest version on GitHub Releases and update in one click.',
  '現在のバージョン:': 'Current version:',
  最新リリースを確認: 'Check for latest release',
  '新しいバージョン v{0} が利用可能です': 'Version v{0} is available',
  '最新の状態です (v{0})': 'Up to date (v{0})',
  'ダウンロード中 ({0}%)': 'Downloading ({0}%)',
  '更新中...': 'Updating...',
  'v{0} に今すぐアップデート': 'Update to v{0} now',
  リリースページを開く: 'Open release page',
  'この形式（deb など）ではアプリ内で自動更新できません。リリースページから新しいパッケージを入れてください。':
    'This format (deb, etc.) cannot auto-update in the app. Install the new package from the release page.',
};
