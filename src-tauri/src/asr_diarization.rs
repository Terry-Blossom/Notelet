use crate::models::TranscriptSegment;

/// ローカルASR（単一話者出力）に対して、無音ギャップとターン交代ヒューリスティックに基づく簡易話者分離を適用する
pub fn apply_local_heuristic_diarization(
    segments: &mut [TranscriptSegment],
    user_label: &str,
    remote_label: &str,
) -> bool {
    if segments.is_empty() {
        return false;
    }
    let primary = if user_label.trim().is_empty() {
        "話者A"
    } else {
        user_label.trim()
    };
    let secondary = if remote_label.trim().is_empty() {
        "話者B"
    } else {
        remote_label.trim()
    };

    let mut use_primary = true;
    let mut prev_end_ms = segments[0].start_ms;
    let mut prev_ended_with_question = false;

    for (idx, seg) in segments.iter_mut().enumerate() {
        if idx > 0 {
            let gap_ms = seg.start_ms.saturating_sub(prev_end_ms);
            if gap_ms >= 1500 || (prev_ended_with_question && gap_ms >= 400) {
                use_primary = !use_primary;
            }
        }
        if seg.speaker.trim().is_empty() || seg.speaker == "話者" || seg.speaker == primary {
            seg.speaker = if use_primary {
                primary.to_string()
            } else {
                secondary.to_string()
            };
        }
        prev_end_ms = seg.end_ms;
        let trimmed = seg.text.trim();
        prev_ended_with_question = trimmed.ends_with('?') || trimmed.ends_with('？');
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(id: &str, start_ms: u64, end_ms: u64, text: &str) -> TranscriptSegment {
        TranscriptSegment {
            id: id.to_string(),
            start_ms,
            end_ms,
            speaker: "話者".to_string(),
            text: text.to_string(),
        }
    }

    #[test]
    fn empty_segments_returns_false() {
        let mut segs: Vec<TranscriptSegment> = vec![];
        assert!(!apply_local_heuristic_diarization(&mut segs, "私", "相手"));
    }

    #[test]
    fn switches_speaker_on_long_gap_or_question() {
        let mut segs = vec![
            seg("1", 0, 1000, "進捗はどうですか？"),
            seg("2", 1500, 3000, "順調です"),
            seg("3", 3100, 4000, "了解です"),
            seg("4", 6000, 7000, "次の話題です"),
        ];
        assert!(apply_local_heuristic_diarization(&mut segs, "Alice", "Bob"));
        assert_eq!(segs[0].speaker, "Alice");
        assert_eq!(segs[1].speaker, "Bob");
        assert_eq!(segs[2].speaker, "Bob");
        assert_eq!(segs[3].speaker, "Alice");
    }
}
