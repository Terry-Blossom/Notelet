use notelet_lib::updater;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::PathBuf;

const LATEST_RELEASE_API_URL: &str =
    "https://api.github.com/repos/Terry-Blossom/Notelet/releases/latest";

struct TempDirGuard(PathBuf);

impl TempDirGuard {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "notelet_{}_{}",
            label,
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).expect("create temp dir");
        Self(dir)
    }

    fn path(&self) -> &std::path::Path {
        &self.0
    }
}

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[tokio::test]
#[ignore]
async fn appimage_update_end_to_end_against_latest_github_release() {
    // 1. Fetch latest GitHub release metadata
    let client = reqwest::Client::builder()
        .user_agent("Notelet-Updater-E2E/0.1")
        .build()
        .expect("build reqwest client");

    let resp = client
        .get(LATEST_RELEASE_API_URL)
        .send()
        .await
        .expect("fetch latest release from GitHub API");
    assert!(
        resp.status().is_success(),
        "GitHub API returned non-success status: {}",
        resp.status()
    );

    let release: Value = resp.json().await.expect("parse release JSON");
    let assets = release["assets"]
        .as_array()
        .expect("release JSON must contain assets array");

    // 2. Select linux x86_64 AppImage asset and verify name & sha256
    let selected = updater::select_release_asset(assets, "linux", "x86_64", "appimage", false)
        .expect("select linux x86_64 appimage asset");
    assert!(
        selected.name.ends_with("_linux_x86_64.AppImage"),
        "expected asset ending with _linux_x86_64.AppImage, got: {}",
        selected.name
    );
    let expected_sha256 = selected
        .sha256
        .as_deref()
        .expect("selected AppImage asset should include sha256 digest");

    let expected_size = assets
        .iter()
        .find(|a| a["name"].as_str() == Some(selected.name.as_str()))
        .and_then(|a| a["size"].as_u64())
        .expect("selected asset JSON should include numeric size");
    assert!(expected_size > 0, "asset size must be > 0");

    // 3. Place dummy old AppImage ("old"), download real AppImage, and replace atomically
    let temp = TempDirGuard::new("appimage_update_e2e");
    let dummy_name = "Notelet.AppImage";
    let dummy_old = temp.path().join(dummy_name);
    fs::write(&dummy_old, b"old").expect("write dummy old AppImage");

    let downloaded_path = temp.path().join("downloaded.AppImage");
    let mut dl_resp = client
        .get(&selected.download_url)
        .send()
        .await
        .expect("download AppImage asset");
    assert!(
        dl_resp.status().is_success(),
        "AppImage download returned non-success status: {}",
        dl_resp.status()
    );
    {
        let mut file = fs::File::create(&downloaded_path).expect("create download file");
        while let Some(chunk) = dl_resp.chunk().await.expect("read download chunk") {
            file.write_all(&chunk).expect("write download chunk");
        }
        file.sync_all().expect("sync downloaded file");
    }

    updater::replace_appimage_file(&downloaded_path, &dummy_old, Some(expected_sha256))
        .expect("replace_appimage_file should succeed with valid sha256");

    // 4. Verify replaced file size, SHA-256, executable mode (0o755), and no leftover staging file
    let meta = fs::metadata(&dummy_old).expect("stat replaced AppImage");
    assert_eq!(
        meta.len(),
        expected_size,
        "replaced AppImage size must match release asset size"
    );

    let actual_sha256 =
        updater::compute_file_sha256(&dummy_old).expect("compute sha256 of replaced AppImage");
    assert_eq!(
        actual_sha256, expected_sha256,
        "replaced AppImage SHA-256 must match release digest"
    );

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            meta.permissions().mode() & 0o777,
            0o755,
            "replaced AppImage must have 0o755 permissions"
        );
    }

    let staged_file = temp.path().join(format!(".{dummy_name}.new"));
    assert!(
        !staged_file.exists(),
        "staging file {} must not remain after replacement",
        staged_file.display()
    );

    // 5. Verify mismatched SHA-256 returns Err and preserves old file ("old")
    let mismatch_name = "Notelet_mismatch.AppImage";
    let mismatch_old = temp.path().join(mismatch_name);
    fs::write(&mismatch_old, b"old").expect("write dummy old AppImage for mismatch test");

    let wrong_sha256 = if expected_sha256.starts_with('0') {
        format!("1{}", &expected_sha256[1..])
    } else {
        format!("0{}", &expected_sha256[1..])
    };
    let err = updater::replace_appimage_file(&downloaded_path, &mismatch_old, Some(&wrong_sha256))
        .expect_err("replace_appimage_file must fail on sha256 mismatch");
    assert!(
        err.contains("SHA-256"),
        "expected SHA-256 error message, got: {err}"
    );
    assert_eq!(
        fs::read(&mismatch_old).expect("read preserved old file"),
        b"old",
        "old file must remain untouched on sha256 mismatch"
    );
    assert!(
        !temp.path().join(format!(".{mismatch_name}.new")).exists(),
        "staging file must not exist after sha256 mismatch"
    );
}
