# Notelet（旧 KoeNote）

録音ボタンを押して話し、ローカルまたはクラウドの音声認識で文字に起こし、AIによる要約・ノート整理・Notion保存・外部ツール連携までを最短で行うローカルファーストのデスクトップノートアプリです。

## 対応OS

- Windows 10 / 11（x64 / arm64）
- macOS 13 以降（Apple Silicon / Intel）

## 主な機能

- **録音と会議検出**: 画面上の録音ボタンとグローバルショートカット（既定 `CommandOrControl+Shift+R`）で開始。マイク、PCシステム音声、両方を選択できます。Zoom / Teams / Google Meet 等の起動を検知して通知し、会議へ Bot として自動参加する方式は使いません。
- **録音中の保護**: 経過時間、入力デバイス、リアルタイム波形、無音検知、フローティングオーバーレイを表示。一時停止・再開ができ、デバイス切断や権限エラー時も途中までの WAV 録音をローカルに保持します。
- **ローカルファーストの文字起こし & 簡易話者分離**: Whisper（`whisper.cpp`）を既定にし、Parakeet（NVIDIA FastConformer TDT/CTC）や Qwen ASR にも対応。ローカル ASR 向けに無音ギャップとターン交代に基づく簡易話者分離オプションも搭載しています。クラウド ASR（OpenAI / Deepgram / Groq）はユーザーが API キーを登録して明示的に選択したときだけ送信し、ローカルからクラウドへの自動フォールバックは行いません。
- **編集と出力**: タイトル・話者一括変更・タイムスタンプ・本文の編集、再生速度変更・無音スキップ、ユーザー辞書登録、Markdown／プレーンテキスト／Slack／LINE 形式でのコピー、OS 権限案内付きの貼り付け支援。
- **AI チャットエージェント & インライン引用**:
  - ノート横断・カテゴリ指定・単一ノートでの質問応答に対応し、**根拠となった引用元ノート・該当箇所への番号バッジ（`[1]`, `[2]`）を文末に表示**。クリックで該当ノートへジャンプできます。
  - チャット経由で **ノートのタイトル訂正、カテゴリ（フォルダ）の作成・移動・名前変更・削除、タグ追加/削除、要約・メモの書き換え、話者名の一括変更、アクション項目追加、ノート作成・削除** などの操作を直接指示できます。
- **Granola からのインポート & データ移行**:
  - Granola の公式 CSV エクスポート、ローカルキャッシュ（`cache-v3.json` 自動読み込み・二重 JSON / ProseMirror 変換対応）、Markdown（`.md`）、ZIP アーカイブ（`.zip`）、Granola API からの直接取得に対応（重複自動スキップ付き）。
  - 全ノートの **Markdown / Obsidian 一括エクスポート（YAML frontmatter 付き ZIP）**、および **JSON バックアップからの復元・マージ** に対応。
- **外部サービス連携**:
  - **Notion 連携**: OAuth 2.0 または Integration Token で接続し、保存先データベース／ページとプロパティを対応付け。重複ページ防止と双方向同期（Pull）に対応。
  - **カレンダー連携 (ICS URL)**: Google Calendar や Outlook の非公開 ICS URL を登録し、会議予定・参加者を自動取得。
  - **Issue / タスク起票**: ノート内のアクション項目から **GitHub Issues / Linear / Jira** へワンクリックで Issue を起票。
  - **MCP サーバー同梱**: Node.js 18+ で動作する読み取り専用 MCP サーバー（`mcp-server/index.mjs`）を同梱し、Claude Desktop / Cursor 等からローカルノートを検索・参照可能。
  - **Slack / 汎用 Webhook**: 要約・アクション項目を明示操作で共有。

## Granola 公開機能との対応表

課金・決済機能は含まず、機能範囲は設定画面の「プラン機能設定」から切り替えられます。古いローカルデータをプラン制限を理由に自動削除することはありません。

| プラン相当 | 機能 | 状態 | 備考 |
|---|---|---|---|
| Basic | Botなしのデバイス録音（マイク／システム音声／両方） | 実装済み | Windows WASAPI / macOS CoreAudio |
| Basic | 手入力メモ＋文字起こし・話者タグ・一括変更 | 実装済み | ローカル簡易話者分離オプション対応 |
| Basic | グローバルショートカット / ユーザー辞書 / コピー・貼り付け支援 | 実装済み | Slack / LINE 形式コピー対応 |
| Basic | カスタムAI指示 (Recipes) / 要約テンプレート | 実装済み | LLM設定時に実行可能 |
| Basic | Granola からのインポート（CSV / JSON / MD / ZIP / API） | 実装済み | 設定＞データ管理・アップロード画面 |
| Basic | AI チャットエージェント & インライン引用バッジ | 実装済み | ノート・カテゴリ操作に対応 |
| Basic | 直近30日の履歴表示（古いデータは保持） | 実装済み | Business以上で全期間表示 |
| Business | 無制限の履歴閲覧 / 共有辞書 / アクション抽出 / メール下書き | 実装済み | 送信は必ずユーザーが手動確認 |
| Business | Notion 双方向同期（OAuth・DB選択・マッピング・重複防止） | 実装済み | 失敗時はローカル保持して再試行 |
| Business | Slack / 汎用Webhook / GitHub・Linear・Jira Issue 起票 | 実装済み | 明示操作時のみ送信 |
| Business | Google / Outlook Calendar (ICS) 予定取得 | 実装済み | 非公開 ICS URL 購読対応 |
| All | MCP 連携（Claude / ChatGPT / Cursor 等） | 実装済み | `mcp-server/index.mjs` 同梱 |
| Enterprise | 音声自動削除・暗号化保存・学習オプトアウト・ローカル利用集計 | 実装済み | 音声暗号化は AES-256-GCM |
| Enterprise | SSO (SAML/OIDC) / SCIM / Audit API / 集中請求サーバー | 未実装 | 専用サーバーインフラが別途必要 |

## モデルの取得とライセンス

重いモデルや外部バイナリはアプリに無断で同梱していません。設定画面の「ASRモデル」タブから選んで取得・指定します。

| モデル / ランタイム | 言語 | 必要メモリ目安 | サイズ目安 | ライセンス | リアルタイム | 自動話者識別 |
|---|---|---|---|---|---|---|
| Whisper Base (`ggml-base.bin`) | 日本語・英語・多言語 | 約 500 MB | 142 MB | MIT (`whisper.cpp` / OpenAI Whisper) | 録音後処理 | 簡易話者分離（オプション） |
| Whisper Small Q5_1 (`ggml-small-q5_1.bin`) | 日本語・英語・多言語 | 約 850 MB | 181 MB | MIT | 録音後処理 | 簡易話者分離（オプション） |
| Whisper Large v3 Turbo Q5_0 | 日本語・英語・多言語 | 約 1.8 GB | 547 MB | MIT | 録音後処理 | 簡易話者分離（オプション） |
| NVIDIA Parakeet TDT/CTC 0.6B 日本語 | 日本語（句読点対応） | 約 2.4 GB | 640 MB | CC-BY-4.0 (NVIDIA) / Apache-2.0 (`sherpa-onnx`) | 録音後処理 | 簡易話者分離（オプション） |
| NVIDIA Parakeet TDT 0.6B v3 | 英語・欧州25言語 | 約 2.4 GB | 640 MB | CC-BY-4.0 / Apache-2.0 | 録音後処理 | 簡易話者分離（オプション） |
| Deepgram Nova-2 (クラウド・BYOK) | 日本語・英語・多言語 | - | - | 商用 API | 録音後処理 | 対応 |

### ローカルランタイムの準備

- **Whisper**: `whisper.cpp` の `whisper-cli`（Windows: `whisper-cli.exe`）を PATH に通すか、設定＞ASRモデルで実行ファイルのパスを指定してください。モデルは設定画面からワンクリックで Hugging Face より取得できます。
- **Parakeet**: `sherpa-onnx-offline` を導入してパスを指定し、`nvidia/parakeet-tdt_ctc-0.6b-ja` 等の ONNX エクスポート済みディレクトリをローカルモデルフォルダに配置してください。

## プライバシーとセキュリティ

- **ローカルファースト**: 文字起こし本文・手入力メモ・録音データはローカル（`koenote_data.json`）に保存され、監査ログや解析イベントには文字起こし内容を含めません。
- **資格情報の保護**: API キーと OAuth トークンは OS の資格情報ストア（Windows 資格情報マネージャ / macOS Keychain）および AES-256-GCM 暗号化ボールトに保存します。
- **音声の扱い**: 保持する音声ファイルは AES-256-GCM で暗号化して保存でき、ストレージ圧縮（16kHz モノラル再エンコード）にも対応しています。
- **外部送信の透明性**: クラウド ASR には音声ファイル、クラウド LLM には文字起こしテキストと手入力メモのみを送信します。
- **コンプライアンス表示**: HIPAA、SOC 2、DPA 等の認証・契約は取得していないため、準拠済みとは表示しません。

## 開発・テスト方法

```bash
# 依存パッケージのインストール
npm install

# フロントエンドの型チェック・ビルド
npm run build

# テスト実行（音声・APIはモック）
npm test -- --run

# Tauri デスクトップアプリ起動（Visual Studio C++ Build Tools / Xcode CLT が必要）
npm run tauri dev
```

### MCP サーバー単体テスト

```bash
printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}\n' | node mcp-server/index.mjs
```

## クレジット

UIデザインの構成・トークン設計は Uber Design による Figma コミュニティファイル「Base Gallery」（CC BY 4.0）および Base Design System を参照しています。
