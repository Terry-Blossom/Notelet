export const dict: Record<string, string> = {
  // Note labels & placeholders
  '無題のノート': 'Untitled note',
  '無題のノート（Granola）': 'Untitled note (Granola)',
  '録音ノート {0}': 'Recording note {0}',
  '未文字起こし': 'Not transcribed',
  'Granola インポート': 'Granola import',
  'Granola ノート #{0}': 'Granola note #{0}',
  '11月20日': 'Nov 20',
  '{0}月{1}日': '{0}/{1}',

  // Export / copy sections
  日時: 'Date',
  参加者: 'Participants',
  要約: 'Summary',
  決定事項: 'Decisions',
  アクション項目: 'Action items',
  ネクストアクション: 'Next actions',
  メモ: 'Notes',
  手入力メモ: 'Manual notes',
  文字起こし: 'Transcript',
  '文字起こし {0}': 'Transcript {0}',
  発言: 'Speaker',
  話者: 'Speaker',
  タイトル: 'Title',
  済: 'Done',
  未: 'Open',
  自分: 'Me',
  相手: 'Them',
  '（担当: {0}）': ' (Assignee: {0})',
  '■ {0}': '{0}',
  '【{0}】': '[{0}]',
  '*■ {0}*': '*{0}*',
  '*【{0}】* ({1})': '*[{0}]* ({1})',

  // Wikipedia link dialog
  '「{0}」の Wikipedia ページを開きますか？': 'Open the Wikipedia page for "{0}"?',
  'Wikipedia で開く': 'Open in Wikipedia',

  // ZIP errors
  'この環境は DEFLATE ZIP 展開 (DecompressionStream) に対応していません。':
    'This environment does not support DEFLATE ZIP extraction (DecompressionStream).',
  'ZIP エントリの展開サイズが上限 ({0} bytes) を超えました。':
    'ZIP entry exceeds the maximum extracted size ({0} bytes).',
  'ZIP エントリの展開サイズが上限 ({0} bytes) を超えています。':
    'ZIP entry exceeds the maximum extracted size ({0} bytes).',
  'ZIP エントリの展開サイズが上限を超えています: {0}':
    'ZIP entry exceeds the maximum extracted size: {0}',
  'ZIP エントリのデータ範囲が不正です: {0}': 'Invalid data range for ZIP entry: {0}',
  'ZIP エントリの CRC が一致しません: {0}': 'CRC mismatch for ZIP entry: {0}',
  'ZIP 全体の展開サイズが上限 ({0} bytes) を超えました。':
    'ZIP archive exceeds the maximum total extracted size ({0} bytes).',
  'ZIP のエントリ数が上限 ({0}) を超えています。': 'ZIP archive exceeds the entry limit ({0}).',
  'ZIP の中央ディレクトリが破損しています。': 'The ZIP central directory is corrupted.',
  'ZIP64 形式には対応していません。': 'ZIP64 archives are not supported.',
  '有効な ZIP ファイルではありません（EOCD が見つかりません）。':
    'Not a valid ZIP file (end of central directory not found).',

  // Notelet backup errors
  'JSON バックアップの解析に失敗しました: {0}': 'Failed to parse the JSON backup: {0}',
  '有効な Notelet バックアップ JSON オブジェクトではありません。':
    'This is not a valid Notelet backup JSON object.',
  'バックアップ JSON に notes 配列が含まれていません。':
    'The backup JSON does not contain a notes array.',

  // Granola import warnings
  'CSV にデータ行が含まれていません。': 'The CSV contains no data rows.',
  'JSON の解析に失敗しました: {0}': 'Failed to parse JSON: {0}',
  'JSON 内にインポート可能な Granola ノートが見つかりませんでした。':
    'No importable Granola notes were found in the JSON.',
  'この Granola ファイルは暗号化されているため直接読み込めません。Granola の Settings > Profile > Generate CSV から CSV をエクスポートしてインポートしてください。':
    'This Granola file is encrypted and cannot be read directly. Export a CSV from Granola Settings > Profile > Generate CSV, then import it.',
  '{0}: ファイルが空です。': '{0}: the file is empty.',
};
