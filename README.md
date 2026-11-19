# KoeNote

録音ボタンを押して話し、ローカルまたはクラウドの音声認識で文字に起こし、確認・編集してコピー／貼り付け・Notion保存までを最短で行うデスクトップノートアプリです。

## 対応OS

- Windows 10 / 11（x64 / arm64）
- macOS 13 以降（Apple Silicon / Intel）

## 主な機能

- **録音**: 画面上の録音ボタンとグローバルショートカット（既定 `CommandOrControl+Shift+R`）で開始。マイク、PCシステム音声、両方を選択できます。会議へBotとして自動参加する方式は使いません。
- **録音中の保護**: 経過時間、入力デバイス、リアルタイム波形、無音検知を表示。一時停止・再開ができ、デバイス切断や権限エラー時も途中までのWAV録音をローカルに保持します。
- **ローカルファーストの文字起こし**: Whisper（`whisper.cpp`）を既定にし、Parakeet（NVIDIA FastConformer TDT/CTC）にも対応。クラウドASR（OpenAI / Deepgram / Groq）はユーザーがAPIキーを登録して明示的に選択したときだけ送信し、ローカルからクラウドへの自動フォールバックは行いません。
- **編集と出力**: タイトル・話者・タイムスタンプ・本文の編集、ユーザー辞書への登録、Markdown／プレーンテキストでのコピー、OS権限案内付きの貼り付け支援。
- **Notion 連携**: OAuth 2.0 または Integration Token で接続し、保存先データベース／ページとプロパティを対応付けます。保存前にプレビューを表示し、既存ページのIDを保持して重複ページ作成を防ぎます。
- **補助機能**: 手入力メモ、AI要約・決定事項・アクション項目抽出、フォローアップメール下書き、Recipes（カスタムAI指示）、根拠タイムスタンプ付きAIチャット、Slack / 汎用Webhook共有、MCP設定生成。

## Granola 公開機能との対応表

課金・決済機能は含まず、機能範囲は設定画面の「プラン機能設定」から切り替えられます。古いローカルデータをプラン制限を理由に自動削除することはありません。

| プラン相当 | 機能 | 状態 | 備考 |
|---|---|---|---|
| Basic | Botなしのデバイス録音（マイク／システム音声／両方） | 実装済み | Windows WASAPI / macOS CoreAudio |
| Basic | 手入力メモ＋文字起こし・話者タグ・編集 | 実装済み | 自動話者識別非対応モデルでは手動割り当て |
| Basic | グローバルショートカット / ユーザー辞書 / コピー・貼り付け支援 | 実装済み | 貼り付けはユーザー操作で実行 |
| Basic | カスタムAI指示 (Recipes) / テンプレート | 実装済み | LLM設定時に実行可能 |
| Basic | 直近30日の履歴表示（古いデータは保持） | 実装済み | Business以上で全期間表示 |
| Business | 無制限の履歴閲覧 / 共有辞書 / アクション抽出 / メール下書き | 実装済み | 送信は必ずユーザーが手動確認 |
| Business | Notion 保存（OAuth・DB選択・マッピング・重複防止） | 実装済み | 失敗時はローカル保持して再試行 |
| Business | Slack / 汎用Webhook（Zapier等）共有 | 実装済み | 明示操作時のみ送信 |
| Business | Google / Outlook Calendar 会議前ブリーフ自動取得 | 未実装 | カレンダー連携アダプター枠を用意 |
| Business | HubSpot / Attio / Salesforce / Jira / Linear / GitHub 等 | 未実装 | 連携アダプター状況一覧で状態を表示 |
| All | MCP 連携（Claude / ChatGPT / Cursor 等） | 一部実装 | プラン別の範囲を含む設定JSONを生成（専用MCPバイナリは別構成） |
| Enterprise | 音声自動削除・暗号化保存・学習オプトアウト・ローカル利用集計 | 実装済み | 音声暗号化は AES-256-GCM |
| Enterprise | SSO (SAML/OIDC) / SCIM / Audit API / 集中請求サーバー | 未実装 | 専用サーバーインフラが別途必要 |

## モデルの取得とライセンス

重いモデルや外部バイナリはアプリに無断で同梱していません。設定画面の「ASRモデル」タブから選んで取得・指定します。

| モデル / ランタイム | 言語 | 必要メモリ目安 | サイズ目安 | ライセンス | リアルタイム | 自動話者識別 |
|---|---|---|---|---|---|---|
| Whisper Base (`ggml-base.bin`) | 日本語・英語・多言語 | 約 500 MB | 142 MB | MIT (`whisper.cpp` / OpenAI Whisper) | 録音後処理 | 未対応（手動） |
| Whisper Small Q5_1 (`ggml-small-q5_1.bin`) | 日本語・英語・多言語 | 約 850 MB | 181 MB | MIT | 録音後処理 | 未対応（手動） |
| Whisper Large v3 Turbo Q5_0 | 日本語・英語・多言語 | 約 1.8 GB | 547 MB | MIT | 録音後処理 | 未対応（手動） |
| NVIDIA Parakeet TDT/CTC 0.6B 日本語 | 日本語（句読点対応） | 約 2.4 GB | 640 MB | CC-BY-4.0 (NVIDIA) / Apache-2.0 (`sherpa-onnx`) | 録音後処理 | 未対応（手動） |
| NVIDIA Parakeet TDT 0.6B v3 | 英語・欧州25言語 | 約 2.4 GB | 640 MB | CC-BY-4.0 / Apache-2.0 | 録音後処理 | 未対応（手動） |
| Deepgram Nova-2 (クラウド・BYOK) | 日本語・英語・多言語 | - | - | 商用 API | 録音後処理 | 対応 |

### ローカルランタイムの準備

- **Whisper**: `whisper.cpp` の `whisper-cli`（Windows: `whisper-cli.exe`）を PATH に通すか、設定＞ASRモデルで実行ファイルのパスを指定してください。モデルは設定画面からワンクリックで Hugging Face より取得できます。
- **Parakeet**: `sherpa-onnx-offline` を導入してパスを指定し、`nvidia/parakeet-tdt_ctc-0.6b-ja` 等の ONNX エクスポート済みディレクトリをローカルモデルフォルダに配置してください。未導入環境では設定画面に理由が表示されます。

## Notion 設定

1. 設定＞「Notion・連携・MCP」を開きます。
2. Internal Integration Token を直接保存するか、OAuth 2.0（Client ID / Client Secret / Redirect URI）で認可コードを取得してトークンを交換します。
3. 「保存先を検索」からデータベースまたはページを選択します。
4. 必要に応じてタイトル・要約・日時のプロパティ名を調整します。

## プライバシーとセキュリティ

- **ローカルファースト**: 文字起こし本文・手入力メモ・録音データはローカルに保存され、監査ログや解析イベントには文字起こし内容を含めません。
- **資格情報の保護**: APIキーと OAuth トークンは OS の資格情報ストア（Windows 資格情報マネージャ / macOS Keychain）に保存します。
- **音声の扱い**: 文字起こし完了後に音声ファイルを削除する設定が既定です。保持する場合は AES-256-GCM で暗号化して保存できます。
- **外部送信の透明性**: クラウドASRには音声ファイル、クラウドLLMには文字起こしテキストと手入力メモのみを送信します。
- **コンプライアンス表示**: HIPAA、SOC 2、DPA 等の認証・契約は取得していないため、準拠済みとは表示しません。

## 既知の制限

- Windows で Rust バックエンド (`src-tauri`) をビルドするには、Visual Studio Build Tools（C++ によるデスクトップ開発）が必要です。
- macOS で PC のシステム音声を単体録音するには、BlackHole などの仮想オーディオデバイスの導入が必要です。
- カレンダー自動同期、CRM・タスク管理API、SSO/SCIM サーバー連携は未実装です。

## 開発・テスト方法

```bash
# 依存パッケージのインストール
npm install

# フロントエンドの型チェック・ビルド
npm run build

# テスト実行（音声・APIはモック）
npm test

# UIコード検査
npm run check:ui

# Tauri デスクトップアプリ起動（Visual Studio C++ Build Tools / Xcode CLT が必要）
npm run tauri dev
```

## クレジット

UIデザインの構成・トークン設計は Uber Design による Figma コミュニティファイル「Base Gallery」（CC BY 4.0）および Base Design System を参照しています。
