export const dict: Record<string, string> = {
  // ChatView
  '「{0}」に移動しますか？': 'Go to "{0}"?',
  '該当箇所 [{0}]: {1}': 'Excerpt [{0}]: {1}',
  '該当箇所: {0}': 'Excerpt: {0}',
  'ノートを開く': 'Open note',
  'すべてのスペース': 'All spaces',
  'スペース': 'Space',
  'AI が提案した変更（内容を確認して承認してください）':
    'Changes proposed by AI (review before approving)',
  '承認': 'Approve',
  '却下': 'Dismiss',
  '引用元のノート・該当箇所': 'Sources and excerpts',
  '会話履歴 ({0})': 'Chat history ({0})',
  'チャット履歴を選択': 'Select chat history',
  '選択を終了': 'Exit selection',
  '複数選択して削除': 'Select multiple to delete',
  'すべて解除': 'Deselect all',
  'すべて選択': 'Select all',
  '{0} 件のチャット履歴を削除しますか？': 'Delete {0} chat history items?',
  '選択した会話履歴を削除します。この操作は取り消せません。':
    'This deletes the selected chat history. It cannot be undone.',
  '削除 ({0})': 'Delete ({0})',
  '会話履歴を検索': 'Search chat history',
  '履歴を検索...': 'Search history...',
  '履歴はありません': 'No history yet',
  '思考中...': 'Thinking...',
  '{0}を選択': 'Select {0}',
  'すべて': 'All',
  '新しいチャットを作成': 'Create a new chat',
  '新規チャット': 'New chat',
  'AIプロバイダが未設定のため、ローカル検索ベースで回答します。':
    'No AI provider is configured, so answers come from local search.',
  '設定へ': 'Go to settings',
  '下の入力欄から「{0}」について何でも質問するか、左側の履歴から過去の会話を引き継げます。':
    'Ask anything about "{0}" below, or continue a past conversation from the history on the left.',
  '全ノートへの質問': 'Ask about all notes',
  '{0}について何でも質問': 'Ask anything about {0}',
  '質問を送信': 'Send question',

  // IntegrationsView
  '設定を保存しました': 'Settings saved',
  'トークンを暗号化して保存しました': 'Token encrypted and saved',
  'Notion 同期': 'Notion sync',
  '文字起こし・要約・メモを Notion データベースまたはページへ同期します。':
    'Sync transcripts, summaries, and notes to a Notion database or page.',
  'トークン保存済み': 'Token saved',
  'トークン未設定': 'Token not set',
  'Notion Integration Token（保存済み・更新する場合のみ入力）':
    'Notion Integration Token (saved; enter only to update)',
  '同期先データベース / ページ': 'Target database / page',
  '現在: {0} ({1})': 'Current: {0} ({1})',
  'データベース名またはページ名で検索（空欄で一覧取得）':
    'Search by database or page name (leave blank to list all)',
  '取得中': 'Loading',
  '同期先を検索': 'Find targets',
  '同期中...': 'Syncing...',
  'Notionから今すぐ同期': 'Sync from Notion now',
  'Notion から同期先候補を取得中...': 'Loading Notion targets...',
  '保存先を「{0}」に設定しました': 'Destination set to "{0}"',
  '{0}（{1}）': '{0} ({1})',
  '選択中': 'Selected',
  'プロパティ名のマッピング設定・OAuth 2.0 接続':
    'Property mapping and OAuth 2.0 connection',
  'タイトルプロパティ': 'Title property',
  '要約プロパティ': 'Summary property',
  '日時プロパティ': 'Date property',
  'OAuth 2.0 で接続する場合': 'Connect with OAuth 2.0',
  '認可URLを生成': 'Generate authorization URL',
  'ブラウザで開く': 'Open in browser',
  '取得した認可 code': 'Authorization code',
  '交換': 'Exchange',
  '{0} に接続しました': 'Connected to {0}',
  'Webhook / MCP 連携': 'Webhook / MCP integrations',
  'Slack Incoming Webhook URL（保存済み）': 'Slack Incoming Webhook URL (saved)',
  '要約完了時に Slack へ自動共有するスペース（選択したスペースのノートのみ自動送信）':
    'Spaces auto-shared to Slack when a summary completes (only notes in the selected spaces are sent)',
  '汎用 Webhook URL（任意）': 'Generic Webhook URL (optional)',
  'MCP サーバー設定（Claude Desktop / Cursor 用）を表示':
    'Show MCP server config (for Claude Desktop / Cursor)',
  'カレンダー連携 (ICS URL)': 'Calendar integration (ICS URL)',
  'Google Calendar や Outlook の非公開 ICS URL を登録すると、ホーム画面の予定リストに会議予定と参加者が自動反映されます。':
    'Register a private Google Calendar or Outlook ICS URL to show meetings and attendees automatically on the Home schedule.',
  'Issue / タスク起票連携 (GitHub / Linear / Jira)':
    'Issue / task tracking (GitHub / Linear / Jira)',
  'ノート内のアクション項目からワンクリックで Issue を作成できます。':
    'Create issues in one click from action items in a note.',
  'owner/repo (例: Terry-Blossom/Notelet)': 'owner/repo (e.g. Terry-Blossom/Notelet)',
  'GitHub PAT（保存済み）': 'GitHub PAT (saved)',
  'Linear API Key（保存済み）': 'Linear API Key (saved)',
  'Jira API Token（保存済み）': 'Jira API Token (saved)',
  'Granola API キー（インポート用）': 'Granola API key (for import)',
  'Granola API Key（保存済み）': 'Granola API Key (saved)',

  // RecordingView
  '録音エラー（途中データを保護）': 'Recording error (partial data preserved)',
  '一時停止中': 'Paused',
  '録音中': 'Recording',
  '再開': 'Resume',
  '一時停止': 'Pause',
  '途中までの録音を確認': 'Review partial recording',
  '録音を停止して文字起こし': 'Stop and transcribe',
  '入力デバイス: ': 'Input device: ',
  '既定デバイス': 'Default device',
  'ローカルWAVへ逐次保存中': 'Saving continuously to local WAV',
  '音声入力が検出されていません（無音状態）。マイクのミュートや入力デバイスの選択を確認してください。':
    'No audio input detected (silent). Check whether your mic is muted or the wrong input device is selected.',
  '参加者への案内文': 'Participant notice',
  '（管理者設定）': ' (set by admin)',
  'コピー済み': 'Copied',
  '案内文をコピー': 'Copy notice',
  'リアルタイム文字起こし': 'Live transcription',
  'リアルタイム対応': 'Live support',
  '録音後に文字起こし': 'Transcribe after recording',
  '選択中のモデルは録音停止後に文字起こしを実行します':
    'The selected model transcribes after you stop recording',
  '録音中の手入力メモ': 'Notes while recording',
  '話しながら気になった点やキーワードを残すと、文字起こしと合わせて整理できます':
    'Jot down points or keywords as you talk; they are organized alongside the transcript',
  '議題、決定したこと、確認したい項目を入力': 'Agenda, decisions, follow-ups',

  // UploadView
  '手元にある音声ファイルを読み込み、選択中の音声認識モデルで文字起こしします':
    'Load an audio file and transcribe it with the selected speech model',
  '使用中のASRモデル: ': 'Active ASR model: ',
  'モデル未選択': 'No model selected',
  'モデルを変更': 'Change model',
  '音声ファイルを選択（WAV / MP3 / M4A / OGG / FLAC）':
    'Choose an audio file (WAV / MP3 / M4A / OGG / FLAC)',
  'ローカルモデルは16kHz WAV形式に最適化されています（クラウドASRはMP3/M4A等も直接処理できます）':
    'Local models are optimized for 16kHz WAV (cloud ASR also handles MP3, M4A, and more directly)',
  '文字起こし中': 'Transcribing',
  '文字起こしを開始': 'Start transcription',
  '動画・音声リンク (URL) から文字起こし': 'Transcribe from a video or audio URL',
  'https://example.com/meeting.mp4 または動画URL':
    'https://example.com/meeting.mp4 or a video URL',
  'リンクから文字起こし': 'Transcribe from link',

  // DictionaryView
  'カスタム辞書 ({0})': 'Custom dictionary ({0})',
  '固有名詞や専門用語を登録すると、文字起こし時の認識精度が向上します。':
    'Add proper nouns and technical terms to improve transcription accuracy.',
  '登録語を検索...': 'Search entries...',
  '表記（例: Notelet / 製品名 / 人名）': 'Term (e.g. Notelet / product / person)',
  '読み・補足（任意）': 'Reading or note (optional)',
  '追加': 'Add',
  '登録された単語はありません。': 'No entries yet.',
  '「{0}」を辞書から削除しますか？': 'Remove "{0}" from the dictionary?',
  '削除した登録語は元に戻せません。': 'Removed entries cannot be restored.',

  // GranolaImportCard
  'Granola からインポート': 'Import from Granola',
  'Granola のエクスポートファイル（CSV / JSON / Markdown / ZIP）またはローカルキャッシュ（':
    'Load a Granola export (CSV / JSON / Markdown / ZIP) or the local cache (',
  '）を読み込みます。': ').',
  '保存先:': 'Destination:',
  '{0} 件のソースを選択中: {1}': '{0} sources selected: {1}',
  'CSV / JSON / Markdown / ZIP ファイルを選択またはドロップ（複数選択可）':
    'Choose or drop CSV / JSON / Markdown / ZIP files (multiple allowed)',
  'Granola: Settings ＞ Profile ＞ Generate CSV、または ':
    'In Granola: Settings ＞ Profile ＞ Generate CSV, or use ',
  '（macOS: ~/Library/Application Support/Granola/ / Windows: %APPDATA%\\Granola\\）':
    ' (macOS: ~/Library/Application Support/Granola/ / Windows: %APPDATA%\\Granola\\)',
  'Granola API キー（保存済みなら空欄で取得可）':
    'Granola API key (leave blank if already saved)',
  'API から取得': 'Fetch from API',
  'Granola から {0} 件のノートをインポートしました': 'Imported {0} notes from Granola',
  '取り込みプレビュー: 新規 {0} 件': 'Import preview: {0} new',
  '（重複スキップ {0} 件）': '({0} duplicates skipped)',
  'クリア': 'Clear',
  'インポート中...': 'Importing...',
  '{0} 件をインポート': 'Import {0}',
  ' · {0}発話': ' · {0} segments',
  ' · 要約あり': ' · Summary',
  'ほか {0} 件...': 'and {0} more...',

  // HistoryView
  'すべて ({0})': 'All ({0})',
  'ノートを検索': 'Search notes',
  'キーワード、決定事項、文字起こしを検索':
    'Search keywords, decisions, transcripts',
  '条件に一致するノートはありません': 'No matching notes',
  '個人': 'Personal',
  '無題のノート': 'Untitled note',
  '文字起こしなし': 'No transcript',
  '{0} ・ {1} ・ {2} セグメント': '{0} · {1} · {2} segments',
  '削除する': 'Delete',
  'キャンセル': 'Cancel',

  // StreamingMarkdownArticle
  '「{0}」を Wikipedia で調べる': 'Look up "{0}" on Wikipedia',
  '用語「{0}」を Wikipedia で調べる': 'Look up term "{0}" on Wikipedia',
  '引用 {0}: {1}': 'Citation {0}: {1}',
  '思考プロセス': 'Reasoning',

  // ErrorBoundary
  '画面の表示中にエラーが発生しました': 'Something went wrong while rendering this screen',
  '再試行': 'Try again',

  // WaveformMeter
  '入力音量 {0}%': 'Input level {0}%',
};
