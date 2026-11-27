use crate::llm;
use crate::models::{self, AppDataSnapshot, Folder, Note};
use crate::storage;

fn note_title(data: &AppDataSnapshot, id: Option<&str>) -> String {
    id.and_then(|nid| data.notes.iter().find(|n| n.id == nid))
        .map(|n| n.title.clone())
        .or_else(|| id.map(str::to_string))
        .unwrap_or_else(|| "対象ノート".to_string())
}

fn describe_action(
    data: &AppDataSnapshot,
    spec: &llm::ChatActionSpec,
    target_note_id: Option<&str>,
) -> Option<String> {
    let folder_label = spec
        .folder_name
        .as_deref()
        .or(spec.name.as_deref())
        .unwrap_or("カテゴリ");
    Some(match spec.kind.as_str() {
        "rename_note" => format!(
            "ノート「{}」のタイトルを「{}」に変更",
            note_title(data, target_note_id),
            spec.title.as_deref().unwrap_or("").trim()
        ),
        "move_note_folder" => format!(
            "ノート「{}」をカテゴリ「{}」へ移動",
            note_title(data, target_note_id),
            folder_label
        ),
        "create_folder" => format!("カテゴリ「{folder_label}」を作成"),
        "rename_folder" => format!("カテゴリ「{folder_label}」に名前を変更"),
        "delete_folder" => format!("カテゴリ「{folder_label}」を削除"),
        "add_tags" => format!(
            "ノート「{}」にタグ [{}] を追加",
            note_title(data, target_note_id),
            spec.tags.as_deref().unwrap_or(&[]).join(", ")
        ),
        "remove_tags" => format!(
            "ノート「{}」からタグ [{}] を削除",
            note_title(data, target_note_id),
            spec.tags.as_deref().unwrap_or(&[]).join(", ")
        ),
        "update_summary" => format!(
            "ノート「{}」の要約を上書き",
            note_title(data, target_note_id)
        ),
        "update_manual_notes" => format!(
            "ノート「{}」のメモを上書き",
            note_title(data, target_note_id)
        ),
        "rename_speaker" => format!(
            "ノート「{}」の話者「{}」を「{}」に変更",
            note_title(data, target_note_id),
            spec.from_speaker.as_deref().unwrap_or(""),
            spec.to_speaker.as_deref().unwrap_or("")
        ),
        "add_action_item" => format!(
            "ノート「{}」にアクション項目「{}」を追加",
            note_title(data, target_note_id),
            spec.text.as_deref().unwrap_or("").trim()
        ),
        "create_note" => format!(
            "新規ノート「{}」を作成",
            spec.title.as_deref().unwrap_or("新規ノート").trim()
        ),
        "delete_note" => format!(
            "ノート「{}」を削除",
            note_title(data, target_note_id)
        ),
        _ => return None,
    })
}

/// 破壊的・上書き操作を含むアクションは実行せず、ユーザー承認用の提案として返す。
pub(super) fn propose_chat_actions(
    data: &AppDataSnapshot,
    specs: &[llm::ChatActionSpec],
    default_note_id: Option<&str>,
) -> Vec<models::ChatActionProposal> {
    specs
        .iter()
        .filter_map(|spec| {
            let target_note_id = spec
                .note_id
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .or(default_note_id)
                .map(|s| s.to_string());
            let description = describe_action(data, spec, target_note_id.as_deref())?;
            let spec_value = serde_json::to_value(spec).ok()?;
            Some(models::ChatActionProposal {
                id: format!("proposal-{}", uuid::Uuid::new_v4()),
                action: spec.kind.clone(),
                target_id: target_note_id,
                description,
                spec: spec_value,
            })
        })
        .collect()
}

pub(super) fn apply_chat_actions(
    data: &mut AppDataSnapshot,
    specs: &[llm::ChatActionSpec],
    default_note_id: Option<&str>,
) -> Vec<models::ChatActionResult> {
    let mut results = Vec::new();
    let now = chrono::Utc::now().to_rfc3339();

    for spec in specs {
        let target_note_id = spec
            .note_id
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .or(default_note_id)
            .map(|s| s.to_string());

        match spec.kind.as_str() {
            "rename_note" => {
                if let (Some(nid), Some(new_title)) = (
                    target_note_id,
                    spec.title
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty()),
                ) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        let old = note.title.clone();
                        note.title = new_title.to_string();
                        note.updated_at = now.clone();
                        storage::append_audit(
                            data,
                            "chat_rename_note",
                            &format!("{nid}: {old} -> {new_title}"),
                        );
                        results.push(models::ChatActionResult {
                            action: "rename_note".into(),
                            target_id: Some(nid),
                            description: format!(
                                "ノート「{old}」のタイトルを「{new_title}」に変更しました"
                            ),
                            success: true,
                        });
                    }
                }
            }
            "move_note_folder" => {
                if let Some(nid) = target_note_id {
                    let resolved_folder = if let Some(fid) =
                        spec.folder_id.as_deref().filter(|s| !s.trim().is_empty())
                    {
                        data.folders
                            .iter()
                            .find(|f| f.id == fid)
                            .map(|f| (f.id.clone(), f.name.clone()))
                    } else if let Some(fname) = spec
                        .folder_name
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                    {
                        if let Some(existing) = data
                            .folders
                            .iter()
                            .find(|f| f.name == fname || f.id == fname)
                        {
                            Some((existing.id.clone(), existing.name.clone()))
                        } else {
                            let new_fid = format!("folder-{}", uuid::Uuid::new_v4());
                            data.folders.push(Folder {
                                id: new_fid.clone(),
                                name: fname.to_string(),
                                is_shared: false,
                                permission: "owner".to_string(),
                            });
                            Some((new_fid, fname.to_string()))
                        }
                    } else {
                        None
                    };

                    if let Some((fid, fname)) = resolved_folder {
                        if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                            note.folder_id = fid;
                            note.updated_at = now.clone();
                            let note_title = note.title.clone();
                            storage::append_audit(
                                data,
                                "chat_move_folder",
                                &format!("{nid} -> {fname}"),
                            );
                            results.push(models::ChatActionResult {
                                action: "move_note_folder".into(),
                                target_id: Some(nid),
                                description: format!(
                                    "ノート「{note_title}」をカテゴリ「{fname}」へ移動しました"
                                ),
                                success: true,
                            });
                        }
                    }
                }
            }
            "create_folder" => {
                if let Some(fname) = spec
                    .name
                    .as_deref()
                    .or(spec.folder_name.as_deref())
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                {
                    if let Some(existing) = data.folders.iter().find(|f| f.name == fname) {
                        results.push(models::ChatActionResult {
                            action: "create_folder".into(),
                            target_id: Some(existing.id.clone()),
                            description: format!("カテゴリ「{fname}」は既に存在します"),
                            success: true,
                        });
                    } else {
                        let new_fid = format!("folder-{}", uuid::Uuid::new_v4());
                        data.folders.push(Folder {
                            id: new_fid.clone(),
                            name: fname.to_string(),
                            is_shared: false,
                            permission: "owner".to_string(),
                        });
                        storage::append_audit(data, "chat_create_folder", fname);
                        results.push(models::ChatActionResult {
                            action: "create_folder".into(),
                            target_id: Some(new_fid),
                            description: format!("カテゴリ「{fname}」を作成しました"),
                            success: true,
                        });
                    }
                }
            }
            "rename_folder" => {
                if let (Some(fid), Some(new_name)) = (
                    spec.folder_id.as_deref(),
                    spec.name
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty()),
                ) {
                    if let Some(folder) = data
                        .folders
                        .iter_mut()
                        .find(|f| f.id == fid || f.name == fid)
                    {
                        let old = folder.name.clone();
                        let actual_id = folder.id.clone();
                        folder.name = new_name.to_string();
                        storage::append_audit(
                            data,
                            "chat_rename_folder",
                            &format!("{old} -> {new_name}"),
                        );
                        results.push(models::ChatActionResult {
                            action: "rename_folder".into(),
                            target_id: Some(actual_id),
                            description: format!("カテゴリ「{old}」を「{new_name}」に変更しました"),
                            success: true,
                        });
                    }
                }
            }
            "delete_folder" => {
                if let Some(fid) = spec.folder_id.as_deref().or(spec.folder_name.as_deref()) {
                    if let Some(pos) = data
                        .folders
                        .iter()
                        .position(|f| f.id == fid || f.name == fid)
                    {
                        let removed = data.folders.remove(pos);
                        for note in &mut data.notes {
                            if note.folder_id == removed.id {
                                note.folder_id = "personal".to_string();
                            }
                        }
                        storage::append_audit(data, "chat_delete_folder", &removed.name);
                        results.push(models::ChatActionResult {
                            action: "delete_folder".into(),
                            target_id: Some(removed.id),
                            description: format!("カテゴリ「{}」を削除しました", removed.name),
                            success: true,
                        });
                    }
                }
            }
            "add_tags" => {
                if let (Some(nid), Some(tags)) = (target_note_id, spec.tags.as_ref()) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        for tag in tags {
                            let clean = tag.trim();
                            if !clean.is_empty()
                                && !note.tags.iter().any(|existing| existing == clean)
                            {
                                note.tags.push(clean.to_string());
                            }
                        }
                        note.updated_at = now.clone();
                        results.push(models::ChatActionResult {
                            action: "add_tags".into(),
                            target_id: Some(nid),
                            description: format!("タグ [{}] を追加しました", tags.join(", ")),
                            success: true,
                        });
                    }
                }
            }
            "remove_tags" => {
                if let (Some(nid), Some(tags)) = (target_note_id, spec.tags.as_ref()) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        note.tags
                            .retain(|tag| !tags.iter().any(|t| t.trim() == tag));
                        note.updated_at = now.clone();
                        results.push(models::ChatActionResult {
                            action: "remove_tags".into(),
                            target_id: Some(nid),
                            description: format!("タグ [{}] を削除しました", tags.join(", ")),
                            success: true,
                        });
                    }
                }
            }
            "update_summary" => {
                if let (Some(nid), Some(summary)) = (target_note_id, spec.summary.as_deref()) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        note.summary = summary.trim().to_string();
                        note.updated_at = now.clone();
                        results.push(models::ChatActionResult {
                            action: "update_summary".into(),
                            target_id: Some(nid),
                            description: format!("ノート「{}」の要約を更新しました", note.title),
                            success: true,
                        });
                    }
                }
            }
            "update_manual_notes" => {
                if let (Some(nid), Some(memo)) = (target_note_id, spec.manual_notes.as_deref()) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        note.manual_notes = memo.trim().to_string();
                        note.updated_at = now.clone();
                        results.push(models::ChatActionResult {
                            action: "update_manual_notes".into(),
                            target_id: Some(nid),
                            description: format!("ノート「{}」のメモを更新しました", note.title),
                            success: true,
                        });
                    }
                }
            }
            "rename_speaker" => {
                if let (Some(nid), Some(from), Some(to)) = (
                    target_note_id,
                    spec.from_speaker.as_deref().map(str::trim),
                    spec.to_speaker.as_deref().map(str::trim),
                ) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        let mut count = 0usize;
                        for segment in &mut note.segments {
                            if segment.speaker.trim() == from {
                                segment.speaker = to.to_string();
                                count += 1;
                            }
                        }
                        note.updated_at = now.clone();
                        results.push(models::ChatActionResult {
                            action: "rename_speaker".into(),
                            target_id: Some(nid),
                            description: format!(
                                "話者「{from}」を「{to}」に変更しました（{count}件）"
                            ),
                            success: true,
                        });
                    }
                }
            }
            "add_action_item" => {
                if let (Some(nid), Some(text)) = (
                    target_note_id,
                    spec.text
                        .as_deref()
                        .map(str::trim)
                        .filter(|s| !s.is_empty()),
                ) {
                    if let Some(note) = data.notes.iter_mut().find(|n| n.id == nid) {
                        note.action_items.push(models::ActionItem {
                            id: format!("act-{}", uuid::Uuid::new_v4()),
                            text: text.to_string(),
                            assignee: spec.assignee.clone().unwrap_or_default(),
                            done: false,
                        });
                        note.updated_at = now.clone();
                        results.push(models::ChatActionResult {
                            action: "add_action_item".into(),
                            target_id: Some(nid),
                            description: format!("アクション項目「{text}」を追加しました"),
                            success: true,
                        });
                    }
                }
            }
            "create_note" => {
                let title = spec
                    .title
                    .as_deref()
                    .unwrap_or("新規ノート")
                    .trim()
                    .to_string();
                let folder_id = spec
                    .folder_id
                    .clone()
                    .or_else(|| {
                        spec.folder_name.as_deref().and_then(|folder_name| {
                            data.folders
                                .iter()
                                .find(|folder| folder.name == folder_name)
                                .map(|folder| folder.id.clone())
                        })
                    })
                    .unwrap_or_else(|| "personal".to_string());
                let new_id = format!("note-{}", uuid::Uuid::new_v4());
                let note = Note {
                    id: new_id.clone(),
                    title: title.clone(),
                    created_at: now.clone(),
                    updated_at: now.clone(),
                    duration_sec: 0,
                    folder_id,
                    tags: spec.tags.clone().unwrap_or_default(),
                    participants: Vec::new(),
                    manual_notes: spec.manual_notes.clone().unwrap_or_default(),
                    segments: Vec::new(),
                    summary: spec.summary.clone().unwrap_or_default(),
                    decisions: Vec::new(),
                    action_items: Vec::new(),
                    follow_up_draft: String::new(),
                    asr_model_id: "chat-agent".to_string(),
                    asr_provider_label: "AIチャット作成".to_string(),
                    language: "ja".to_string(),
                    diarization_supported: false,
                    notion_sync: models::NotionSyncState::default(),
                    audio_path: None,
                    audio_encrypted: false,
                    storage_mode: "local".to_string(),
                    pinned: false,
                    summary_history: Vec::new(),
                };
                storage::upsert_note(data, note);
                results.push(models::ChatActionResult {
                    action: "create_note".into(),
                    target_id: Some(new_id),
                    description: format!("新規ノート「{title}」を作成しました"),
                    success: true,
                });
            }
            "delete_note" => {
                if let Some(nid) = target_note_id {
                    let title = data
                        .notes
                        .iter()
                        .find(|note| note.id == nid)
                        .map(|note| note.title.clone())
                        .unwrap_or_else(|| nid.clone());
                    storage::delete_note(data, &nid);
                    results.push(models::ChatActionResult {
                        action: "delete_note".into(),
                        target_id: Some(nid),
                        description: format!("ノート「{title}」を削除しました"),
                        success: true,
                    });
                }
            }
            _ => {}
        }
    }

    results
}
