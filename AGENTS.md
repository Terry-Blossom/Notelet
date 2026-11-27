# Notelet エージェント向けガイドライン

## リリース作成ルール（Release Assets）

GitHub Release を作成する際は、単体バイナリ（`notelet`, `notelet.exe`）や重複パッケージ（`.msi`, `.rpm`, `amd64.AppImage` 等）、32bit ビルドを含めず、**対象 OS をファイル名に明記した以下の 6 ファイル構成**で出力すること。

| 対象 OS / アーキテクチャ | ファイル名 |
|---|---|
| Windows (64bit) | `Notelet_<VERSION>_windows_x64-setup.exe` |
| macOS (Apple Silicon) | `Notelet_<VERSION>_macos_aarch64.dmg` |
| macOS (Intel) | `Notelet_<VERSION>_macos_x64.dmg` |
| Linux x86_64 (汎用) | `Notelet_<VERSION>_linux_x86_64.AppImage` |
| Linux x86_64 (Debian / Ubuntu) | `Notelet_<VERSION>_linux_x86_64.deb` |
| Android (universal APK) | `Notelet_<VERSION>_android.apk` |

Android APK は署名付きリリースビルド（`npx tauri android build --apk`）。署名鍵は GitHub Actions secret `NOTELET_KEYSTORE_BASE64` / `NOTELET_KEYSTORE_PASSWORD` / `NOTELET_KEY_ALIAS` / `NOTELET_KEY_PASSWORD` から復元する。ローカルビルド時は `src-tauri/keystore/keystore.properties`（gitignore 済み）で指定する。

### リリース手順
1. `package.json`・`package-lock.json`・`src-tauri/Cargo.toml`・`src-tauri/Cargo.lock`・`src-tauri/tauri.conf.json` のバージョンを更新する。
2. `npm test`・`npm run build`・`npm run check:ui` がすべて通ることを確認する。
3. `main` へコミット＆プッシュし、`v<VERSION>` タグをプッシュして `.github/workflows/release.yml`（`Release Notelet`）を実行する。
4. 手動でアセットをアップロードする場合も、必ず上記 6 ファイル名に揃えること。
