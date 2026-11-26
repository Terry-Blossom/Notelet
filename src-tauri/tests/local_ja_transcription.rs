//! ローカル Whisper（whisper.cpp）経由の日本語文字起こしを実環境で確認する。
//!
//! 次の環境変数がすべて設定されているときだけ実行し、無いときは何もせず成功する。
//! - NOTELET_TEST_WHISPER_BIN_DIR: whisper-cli と whisper-server があるディレクトリ
//! - NOTELET_TEST_WHISPER_MODEL: ggml-small-q5_1.bin の絶対パス
//! - NOTELET_TEST_JA_AUDIO: ja1.wav（16kHz mono）の絶対パス。同じ場所の ja1.mp3 も使う
//!
//! 実行例:
//! cargo test --test local_ja_transcription -- --nocapture --test-threads=1

use notelet_lib::asr::{
    resolve_installed_whisper_runtime, transcribe_wav, whisper_runtime_dest_dir,
};
use notelet_lib::models::{AppSettings, AsrProviderKind, TranscriptSegment};
use std::fs;
use std::path::{Path, PathBuf};

fn env_path(name: &str) -> Option<PathBuf> {
    match std::env::var(name) {
        Ok(v) if !v.trim().is_empty() => Some(PathBuf::from(v.trim())),
        _ => None,
    }
}

/// 配布用 whisper-cpp バイナリのパスを、whisper-server の配置から推定する。
/// 用意された展開済みディレクトリ（whisper-cpp-<platform>）がある場合だけ返す。
fn sibling_openwhispr_cli(server_src: &Path) -> Option<PathBuf> {
    let fname = server_src.file_name()?.to_str()?;
    let suffix = fname.strip_prefix("whisper-server")?;
    let cli_name = format!("whisper-cpp{suffix}");
    let dir_name = cli_name.strip_suffix(".exe").unwrap_or(&cli_name);
    let parent = server_src.parent()?.parent()?;
    let cand = parent.join(dir_name).join(&cli_name);
    cand.is_file().then_some(cand)
}

fn link_or_copy(src: &Path, dst: &Path) {
    if dst.exists() {
        let _ = fs::remove_file(dst);
    }
    #[cfg(unix)]
    {
        if std::os::unix::fs::symlink(src, dst).is_ok() {
            return;
        }
    }
    fs::copy(src, dst).expect("テスト用バイナリ/モデルのコピーに失敗しました");
}

fn joined_text(segments: &[TranscriptSegment]) -> String {
    segments
        .iter()
        .map(|s| s.text.trim())
        .collect::<Vec<_>>()
        .join("")
}

fn assert_japanese(label: &str, text: &str) {
    println!("[{label}] {text}");
    for keyword in ["こんにちは", "天気", "会議"] {
        assert!(
            text.contains(keyword),
            "{label}: 期待する語「{keyword}」が文字起こし結果に含まれていません: {text}"
        );
    }
}

fn base_settings(model_id: &str, whisper_path: &Path) -> AppSettings {
    let mut settings = AppSettings::default();
    settings.active_asr_provider = AsrProviderKind::LocalWhisper;
    settings.active_asr_model_id = model_id.to_string();
    settings.language = "ja".to_string();
    settings.allow_cloud_asr = false;
    settings.enable_gpu_asr = false;
    settings.whisper_cli_path = whisper_path.to_string_lossy().to_string();
    settings
}

#[tokio::test]
async fn local_ja_transcription_three_paths() {
    let (Some(bin_dir), Some(model_src), Some(wav_src)) = (
        env_path("NOTELET_TEST_WHISPER_BIN_DIR"),
        env_path("NOTELET_TEST_WHISPER_MODEL"),
        env_path("NOTELET_TEST_JA_AUDIO"),
    ) else {
        eprintln!(
            "skip: NOTELET_TEST_WHISPER_BIN_DIR / NOTELET_TEST_WHISPER_MODEL / NOTELET_TEST_JA_AUDIO が未設定です"
        );
        return;
    };

    let cli_name = if cfg!(windows) { "whisper-cli.exe" } else { "whisper-cli" };
    let server_name = if cfg!(windows) { "whisper-server.exe" } else { "whisper-server" };
    let cli_src = bin_dir.join(cli_name);
    let server_src = bin_dir.join(server_name);
    assert!(cli_src.is_file(), "whisper-cli が見つかりません: {}", cli_src.display());
    assert!(server_src.is_file(), "whisper-server が見つかりません: {}", server_src.display());
    assert!(model_src.is_file(), "モデルが見つかりません: {}", model_src.display());
    assert!(wav_src.is_file(), "WAV が見つかりません: {}", wav_src.display());
    assert_eq!(
        model_src.file_name().and_then(|n| n.to_str()),
        Some("ggml-small-q5_1.bin"),
        "NOTELET_TEST_WHISPER_MODEL は ggml-small-q5_1.bin を指定してください"
    );

    let mp3_src = wav_src.with_extension("mp3");
    assert!(mp3_src.is_file(), "MP3 が見つかりません: {}", mp3_src.display());

    let root = std::env::temp_dir().join(format!("notelet-ja-test-{}", uuid::Uuid::new_v4()));
    let data_dir = root.join("data");
    let models_dir = data_dir.join("models");
    let cli_only_dir = root.join("cli-only");
    fs::create_dir_all(&models_dir).expect("モデルディレクトリの作成に失敗しました");
    fs::create_dir_all(&cli_only_dir).expect("CLI ディレクトリの作成に失敗しました");
    link_or_copy(&model_src, &models_dir.join("ggml-small-q5_1.bin"));

    // CLI 単体経路を作る。共有ライブラリ（.so/.dylib/.dll）は残し、
    // whisper-server だけを置かないディレクトリにする。
    for entry in fs::read_dir(&bin_dir).expect("bin ディレクトリの読み込みに失敗しました") {
        let entry = entry.expect("bin ディレクトリの項目読み込みに失敗しました");
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with("whisper-server") {
            continue;
        }
        link_or_copy(&path, &cli_only_dir.join(&name));
    }

    // storage::app_data_dir() / models_dir() をこのテスト専用のディレクトリへ向ける。
    std::env::set_var("NOTELET_DATA_DIR", &data_dir);

    let model_id = "whisper-small-q5";

    // (a) whisper-server 経路
    let server_text = {
        let settings = base_settings(model_id, &server_src);
        let (segments, _, name) = transcribe_wav(&wav_src, &settings, &[])
            .await
            .expect("whisper-server 経路の文字起こしに失敗しました");
        println!("server model: {name}");
        joined_text(&segments)
    };
    assert_japanese("server/wav", &server_text);

    // (b) whisper-cli のみの経路（whisper-server が見つからない状態）
    let cli_text = {
        let settings = base_settings(model_id, &cli_only_dir.join(cli_name));
        let (segments, _, name) = transcribe_wav(&wav_src, &settings, &[])
            .await
            .expect("whisper-cli 経路の文字起こしに失敗しました");
        println!("cli model: {name}");
        joined_text(&segments)
    };
    assert_japanese("cli/wav", &cli_text);

    // (c) mp3 入力（ffmpeg で 16kHz mono WAV に変換される経路）
    let mp3_work = root.join("ja1.mp3");
    fs::copy(&mp3_src, &mp3_work).expect("MP3 のコピーに失敗しました");
    let mp3_text = {
        let settings = base_settings(model_id, &server_src);
        let (segments, _, name) = transcribe_wav(&mp3_work, &settings, &[])
            .await
            .expect("mp3 入力の文字起こしに失敗しました");
        println!("server mp3 model: {name}");
        joined_text(&segments)
    };
    assert_japanese("server/mp3", &mp3_text);

    // (d) OpenWhispr/whisper.cpp 0.0.11 の配布 whisper-server を、
    //     install_runtime_binary と同じ <app_data>/bin/whisper/ 直下へ置き、
    //     settings.whisper_cli_path は空（アプリの既定状態）のまま解決・文字起こしする。
    if let Some(openwhispr_server) = env_path("NOTELET_TEST_OPENWHISPR_SERVER") {
        assert!(
            openwhispr_server.is_file(),
            "NOTELET_TEST_OPENWHISPR_SERVER が見つかりません: {}",
            openwhispr_server.display()
        );
        let dest_dir = whisper_runtime_dest_dir();
        assert_eq!(dest_dir, data_dir.join("bin").join("whisper"));
        fs::create_dir_all(&dest_dir).expect("ランタイム配置先の作成に失敗しました");
        let placed = dest_dir.join(
            openwhispr_server
                .file_name()
                .expect("配布バイナリのファイル名がありません"),
        );
        link_or_copy(&openwhispr_server, &placed);

        let resolved = resolve_installed_whisper_runtime(&dest_dir)
            .expect("配布 whisper-server のパス解決に失敗しました");
        assert_eq!(
            fs::canonicalize(&resolved).expect("解決パスの正規化に失敗しました"),
            fs::canonicalize(&placed).expect("配置パスの正規化に失敗しました"),
            "解決された実行ファイルが配置した配布バイナリではありません: {}",
            resolved.display()
        );

        let settings = base_settings(model_id, Path::new(""));
        assert!(settings.whisper_cli_path.is_empty());
        let (segments, _, name) = transcribe_wav(&wav_src, &settings, &[])
            .await
            .expect("OpenWhispr 配布 whisper-server（パス未設定）経路の文字起こしに失敗しました");
        println!("openwhispr server model: {name}");
        let openwhispr_text = joined_text(&segments);
        assert_japanese("openwhispr/server/wav", &openwhispr_text);
    } else {
        eprintln!("skip (d): NOTELET_TEST_OPENWHISPR_SERVER が未設定です");
    }

    // (e) whisper-cpp-<platform> という名前の配布 CLI しか無い場合でも
    //     resolve_whisper_cli が拾い、whisper-cli 経路で文字起こしできるか。
    if let Some(openwhispr_server) = env_path("NOTELET_TEST_OPENWHISPR_SERVER") {
        if let Some(cli_src) = sibling_openwhispr_cli(&openwhispr_server) {
            let cli_root = root.join("cli-dist-data");
            let cli_dest = cli_root.join("bin").join("whisper");
            fs::create_dir_all(&cli_dest).expect("CLI 配置先の作成に失敗しました");
            fs::create_dir_all(cli_root.join("models")).expect("モデルディレクトリの作成に失敗しました");
            link_or_copy(
                &model_src,
                &cli_root.join("models").join("ggml-small-q5_1.bin"),
            );
            let cli_name = cli_src
                .file_name()
                .expect("配布 CLI のファイル名がありません");
            assert!(cli_name.to_string_lossy().starts_with("whisper-cpp"));
            link_or_copy(&cli_src, &cli_dest.join(cli_name));

            std::env::set_var("NOTELET_DATA_DIR", &cli_root);
            assert!(
                notelet_lib::whisper_server::resolve_whisper_server("").is_none(),
                "CLI 単独経路の検証前に whisper-server が解決されています"
            );
            let settings = base_settings(model_id, Path::new(""));
            let (segments, _, name) = transcribe_wav(&wav_src, &settings, &[])
                .await
                .expect("whisper-cpp 配布 CLI 単独経路の文字起こしに失敗しました");
            println!("openwhispr cli model: {name}");
            let cli_dist_text = joined_text(&segments);
            assert_japanese("openwhispr/cli/wav", &cli_dist_text);
            std::env::set_var("NOTELET_DATA_DIR", &data_dir);
        } else {
            eprintln!("skip (e): 隣接する whisper-cpp 配布バイナリが見つかりません");
        }
    } else {
        eprintln!("skip (e): NOTELET_TEST_OPENWHISPR_SERVER が未設定です");
    }

    notelet_lib::whisper_server::stop_server_async().await;
    std::env::remove_var("NOTELET_DATA_DIR");
    let _ = fs::remove_dir_all(&root);
}
