use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

const MAX_REMOTE_BYTES: u64 = 500 * 1024 * 1024;

fn validate_response_size(content_length: Option<u64>, max_bytes: u64) -> Result<(), String> {
    if content_length.is_some_and(|length| length > max_bytes) {
        return Err("動画・音声データがサイズ上限 (500 MiB) を超えています。".to_string());
    }
    Ok(())
}

fn append_limited_chunk(bytes: &mut Vec<u8>, chunk: &[u8], max_bytes: u64) -> Result<(), String> {
    let new_len = bytes
        .len()
        .checked_add(chunk.len())
        .ok_or_else(|| "動画・音声データがサイズ上限 (500 MiB) を超えています。".to_string())?;
    if new_len as u64 > max_bytes {
        return Err("動画・音声データがサイズ上限 (500 MiB) を超えています。".to_string());
    }
    bytes.extend_from_slice(chunk);
    Ok(())
}

fn parse_ipv4_part(part: &str) -> Option<u32> {
    if let Some(hex) = part.strip_prefix("0x").or_else(|| part.strip_prefix("0X")) {
        u32::from_str_radix(hex, 16).ok()
    } else if part.len() > 1 && part.starts_with('0') {
        u32::from_str_radix(&part[1..], 8).ok()
    } else {
        part.parse::<u32>().ok()
    }
}

pub fn parse_obfuscated_ipv4(host: &str) -> Option<Ipv4Addr> {
    let parts: Vec<&str> = host.split('.').collect();
    if parts.is_empty() || parts.len() > 4 {
        return None;
    }
    let values: Vec<u32> = parts
        .iter()
        .map(|p| parse_ipv4_part(p))
        .collect::<Option<Vec<_>>>()?;
    let addr = match values.as_slice() {
        [a] => *a,
        [a, b] if *a <= 0xff && *b <= 0xff_ffff => (*a << 24) | *b,
        [a, b, c] if *a <= 0xff && *b <= 0xff && *c <= 0xffff => (*a << 24) | (*b << 16) | *c,
        [a, b, c, d] if values.iter().all(|v| *v <= 0xff) => {
            (*a << 24) | (*b << 16) | (*c << 8) | *d
        }
        _ => return None,
    };
    Some(Ipv4Addr::from(addr))
}

fn is_blocked_v4(v4: Ipv4Addr) -> bool {
    let octets = v4.octets();
    let is_cgnat = octets[0] == 100 && (octets[1] & 0b1100_0000) == 64;
    let is_benchmark = octets[0] == 198 && (octets[1] == 18 || octets[1] == 19);
    v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_unspecified()
        || v4.is_broadcast()
        || v4.is_multicast()
        || v4.is_documentation()
        || octets[0] == 0
        || is_cgnat
        || is_benchmark
}

pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_blocked_v4(v4),
        IpAddr::V6(v6) => {
            let seg0 = v6.segments()[0];
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (seg0 & 0xfe00) == 0xfc00
                || (seg0 & 0xffc0) == 0xfe80
                || v6.to_ipv4_mapped().map(is_blocked_v4).unwrap_or(false)
        }
    }
}

pub fn is_blocked_remote_host(host: &str) -> bool {
    let h = host
        .trim_matches(['[', ']'])
        .trim_end_matches('.')
        .to_ascii_lowercase();
    if h.is_empty()
        || h == "localhost"
        || h.ends_with(".localhost")
        || h.ends_with(".local")
        || h.ends_with(".internal")
    {
        return true;
    }
    let parsed = h
        .parse::<IpAddr>()
        .ok()
        .or_else(|| parse_obfuscated_ipv4(&h).map(IpAddr::V4));
    parsed.map(is_blocked_ip).unwrap_or(false)
}

pub fn validate_remote_url(raw_url: &str) -> Result<reqwest::Url, String> {
    let trimmed = raw_url.trim();
    let parsed = reqwest::Url::parse(trimmed)
        .map_err(|_| "有効な http:// または https:// の動画・音声リンクを入力してください。".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("有効な http:// または https:// の動画・音声リンクを入力してください。".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("認証情報を含む URL はセキュリティ上許可されていません。".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "有効なホスト名を含む URL を入力してください。".to_string())?;
    if is_blocked_remote_host(host) {
        return Err("ローカルネットワーク・内部アドレスへのアクセスはセキュリティ上許可されていません。".to_string());
    }
    Ok(parsed)
}

pub async fn resolve_and_validate_url(raw_url: &str) -> Result<(reqwest::Url, Vec<SocketAddr>), String> {
    let parsed = validate_remote_url(raw_url)?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "有効なホスト名を含む URL を入力してください。".to_string())?
        .trim_matches(['[', ']'])
        .to_string();
    let port = parsed.port_or_known_default().unwrap_or(443);

    let addrs: Vec<SocketAddr> = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|e| format!("ホスト名の名前解決に失敗しました: {e}"))?
        .collect();

    if addrs.is_empty() {
        return Err("接続先 IP アドレスを解決できませんでした。".to_string());
    }
    for addr in &addrs {
        if is_blocked_ip(addr.ip()) {
            return Err("ローカルネットワーク・内部アドレスへのアクセスはセキュリティ上許可されていません。".to_string());
        }
    }
    Ok((parsed, addrs))
}

pub async fn download_remote_bytes(raw_url: &str, max_redirects: usize) -> Result<Vec<u8>, String> {
    let mut current_url = raw_url.trim().to_string();
    for _ in 0..=max_redirects {
        let (parsed, addrs) = resolve_and_validate_url(&current_url).await?;
        let host = parsed
            .host_str()
            .ok_or_else(|| "有効なホスト名を含む URL を入力してください。".to_string())?
            .trim_matches(['[', ']'])
            .to_string();

        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(60))
            .resolve_to_addrs(&host, &addrs)
            .build()
            .map_err(|e| format!("HTTPクライアント構築に失敗: {e}"))?;

        let mut resp = client
            .get(parsed.clone())
            .send()
            .await
            .map_err(|e| format!("動画・音声リンクの取得に失敗: {e}"))?;

        if resp.status().is_redirection() {
            let loc = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "リダイレクト先 URL が不正です。".to_string())?;
            let next_url = parsed
                .join(loc)
                .map_err(|_| "リダイレクト先 URL の解析に失敗しました。".to_string())?;
            current_url = next_url.to_string();
            continue;
        }

        if !resp.status().is_success() {
            return Err(format!("動画・音声リンクの取得に失敗 ({})", resp.status()));
        }

        validate_response_size(resp.content_length(), MAX_REMOTE_BYTES)?;
        let mut bytes = Vec::new();
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| format!("動画・音声データの読み込みに失敗: {e}"))?
        {
            append_limited_chunk(&mut bytes, &chunk, MAX_REMOTE_BYTES)?;
        }
        return Ok(bytes);
    }
    Err("リダイレクト回数が上限を超えました。".to_string())
}

pub async fn post_json_validated<T: serde::Serialize + ?Sized>(
    raw_url: &str,
    body: &T,
) -> Result<reqwest::Response, String> {
    let (parsed, addrs) = resolve_and_validate_url(raw_url).await?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "有効なホスト名を含む URL を入力してください。".to_string())?
        .trim_matches(['[', ']'])
        .to_string();

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(20))
        .resolve_to_addrs(&host, &addrs)
        .build()
        .map_err(|e| format!("HTTPクライアント構築に失敗: {e}"))?;

    client
        .post(parsed)
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Webhook 送信エラー: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_response_size_by_content_length_and_chunks() {
        assert!(validate_response_size(Some(5), 5).is_ok());
        assert!(validate_response_size(Some(6), 5).is_err());
        assert!(validate_response_size(None, 5).is_ok());

        let mut bytes = vec![0; 4];
        assert!(append_limited_chunk(&mut bytes, &[1], 5).is_ok());
        assert!(append_limited_chunk(&mut bytes, &[2], 5).is_err());
    }

    #[test]
    fn blocks_loopback_private_and_obfuscated_hosts() {
        assert!(is_blocked_remote_host("localhost"));
        assert!(is_blocked_remote_host("api.localhost"));
        assert!(is_blocked_remote_host("printer.local"));
        assert!(is_blocked_remote_host("metadata.internal"));
        assert!(is_blocked_remote_host("127.0.0.1"));
        assert!(is_blocked_remote_host("2130706433")); // 127.0.0.1 decimal
        assert!(is_blocked_remote_host("0x7f000001")); // 127.0.0.1 hex
        assert!(is_blocked_remote_host("0177.0.0.1")); // 127.0.0.1 octal
        assert!(is_blocked_remote_host("10.0.0.1"));
        assert!(is_blocked_remote_host("192.168.1.10"));
        assert!(is_blocked_remote_host("100.64.0.1")); // CGNAT
        assert!(is_blocked_remote_host("[::1]"));
        assert!(is_blocked_remote_host("[::ffff:127.0.0.1]"));
        assert!(is_blocked_remote_host("169.254.169.254"));
        assert!(!is_blocked_remote_host("example.com"));
        assert!(!is_blocked_remote_host("8.8.8.8"));
    }

    #[test]
    fn validates_scheme_and_credentials() {
        assert!(validate_remote_url("file:///etc/passwd").is_err());
        assert!(validate_remote_url("ftp://example.com/a.mp3").is_err());
        assert!(validate_remote_url("https://user:pass@example.com/a.mp3").is_err());
        assert!(validate_remote_url("http://127.0.0.1:8080/a.mp3").is_err());
        assert!(validate_remote_url("https://example.com/audio.mp3").is_ok());
    }
}
