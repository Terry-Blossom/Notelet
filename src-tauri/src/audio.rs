use crate::models::{AudioDeviceInfo, AudioSourceMode, RecordingStatus};
use crate::storage;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, Stream, StreamConfig};
use hound::{SampleFormat as WavSampleFormat, WavSpec, WavWriter};
use std::collections::VecDeque;
use std::fs::File;
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

pub struct AudioManager {
    runtime: Arc<Mutex<RecordingRuntime>>,
    live_chunk_pcm: Arc<Mutex<Vec<i16>>>,
    live_chunk_energy: Arc<Mutex<(f64, f64)>>,
    stop_flag: Arc<AtomicBool>,
    paused_flag: Arc<AtomicBool>,
    worker: Option<thread::JoinHandle<()>>,
}

struct RecordingRuntime {
    state: String,
    elapsed_ms: u64,
    level_rms: f32,
    waveform: Vec<f32>,
    device_name: String,
    source_mode: AudioSourceMode,
    is_silent_warning: bool,
    silent_since: Option<Instant>,
    error_message: Option<String>,
    recovery_hint: Option<String>,
    temp_wav_path: Option<PathBuf>,
}

impl Default for RecordingRuntime {
    fn default() -> Self {
        Self {
            state: "idle".to_string(),
            elapsed_ms: 0,
            level_rms: 0.0,
            waveform: vec![0.0; 48],
            device_name: String::new(),
            source_mode: AudioSourceMode::Mic,
            is_silent_warning: false,
            silent_since: None,
            error_message: None,
            recovery_hint: None,
            temp_wav_path: None,
        }
    }
}

impl AudioManager {
    pub fn new() -> Self {
        Self {
            runtime: Arc::new(Mutex::new(RecordingRuntime::default())),
            live_chunk_pcm: Arc::new(Mutex::new(Vec::new())),
            live_chunk_energy: Arc::new(Mutex::new((0.0, 0.0))),
            stop_flag: Arc::new(AtomicBool::new(false)),
            paused_flag: Arc::new(AtomicBool::new(false)),
            worker: None,
        }
    }

    pub fn take_live_chunk(&self, min_samples: usize) -> Option<(PathBuf, u64, &'static str)> {
        let samples = {
            let mut buf = self.live_chunk_pcm.lock().ok()?;
            if buf.len() < min_samples {
                return None;
            }
            std::mem::take(&mut *buf)
        };
        let (mic_e, sys_e) = self
            .live_chunk_energy
            .lock()
            .ok()
            .map(|mut e| {
                let cur = *e;
                *e = (0.0, 0.0);
                cur
            })
            .unwrap_or((0.0, 0.0));
        let mut sum_sq = 0.0f64;
        for &s in &samples {
            let f = s as f64 / i16::MAX as f64;
            sum_sq += f * f;
        }
        let rms = (sum_sq / samples.len().max(1) as f64).sqrt();
        if rms < 0.003 {
            return None;
        }
        let (elapsed_ms, source_mode) = self
            .runtime
            .lock()
            .ok()
            .map(|r| (r.elapsed_ms, r.source_mode.clone()))
            .unwrap_or((0, AudioSourceMode::Mic));
        let dominant_source = match source_mode {
            AudioSourceMode::Mic => "mic",
            AudioSourceMode::System => "system",
            AudioSourceMode::Both => {
                if mic_e >= sys_e * 0.75 {
                    "mic"
                } else {
                    "system"
                }
            }
        };
        let dir = storage::app_data_dir().join("temp_recordings");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join(format!("live_{}.wav", Uuid::new_v4()));
        let spec = WavSpec {
            channels: 1,
            sample_rate: 16_000,
            bits_per_sample: 16,
            sample_format: WavSampleFormat::Int,
        };
        if let Ok(mut w) = WavWriter::create(&path, spec) {
            for s in samples {
                let _ = w.write_sample(s);
            }
            let _ = w.finalize();
            return Some((path, elapsed_ms, dominant_source));
        }
        None
    }

    pub fn list_devices() -> Vec<AudioDeviceInfo> {
        let host = cpal::default_host();
        #[cfg(target_os = "linux")]
        eprintln!("[audio] listing devices host={:?}", host.id());
        let mut devices = Vec::new();
        let default_in_name = host
            .default_input_device()
            .and_then(|d| d.name().ok())
            .unwrap_or_default();
        if let Ok(inputs) = host.input_devices() {
            for (idx, dev) in inputs.enumerate() {
                if let Ok(name) = dev.name() {
                    #[cfg(target_os = "linux")]
                    let is_monitor = name.to_ascii_lowercase().contains("monitor");
                    #[cfg(not(target_os = "linux"))]
                    let is_monitor = false;
                    devices.push(AudioDeviceInfo {
                        id: format!("in:{idx}:{name}"),
                        is_default: name == default_in_name,
                        name: if is_monitor {
                            format!("{name}（システム音声）")
                        } else {
                            name
                        },
                        kind: if is_monitor { "loopback" } else { "input" }.to_string(),
                    });
                }
            }
        }
        // Android はループバック録音非対応のため出力デバイスを列挙しない。
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        let default_out_name = host
            .default_output_device()
            .and_then(|d| d.name().ok())
            .unwrap_or_default();
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        if let Ok(outputs) = host.output_devices() {
            for (idx, dev) in outputs.enumerate() {
                if let Ok(name) = dev.name() {
                    devices.push(AudioDeviceInfo {
                        id: format!("out:{idx}:{name}"),
                        is_default: name == default_out_name,
                        name: format!("{name}（システム音声）"),
                        kind: "loopback".to_string(),
                    });
                }
            }
        }
        #[cfg(target_os = "linux")]
        for device in &devices {
            eprintln!(
                "[audio] listed device id={:?} name={:?} kind={}",
                device.id, device.name, device.kind
            );
        }
        devices
    }

    pub fn status(&self) -> RecordingStatus {
        let rt = self.runtime.lock().unwrap_or_else(|e| e.into_inner());
        RecordingStatus {
            state: rt.state.clone(),
            elapsed_ms: rt.elapsed_ms,
            level_rms: rt.level_rms,
            waveform: rt.waveform.clone(),
            device_name: rt.device_name.clone(),
            source_mode: rt.source_mode.clone(),
            is_silent_warning: rt.is_silent_warning,
            error_message: rt.error_message.clone(),
            recovery_hint: rt.recovery_hint.clone(),
            temp_wav_path: rt
                .temp_wav_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
        }
    }

    pub fn start(
        &mut self,
        source_mode: AudioSourceMode,
        device_id: Option<String>,
        mic_gain: f32,
        system_gain: f32,
    ) -> Result<RecordingStatus, String> {
        let mg = mic_gain.clamp(0.1, 3.0);
        let sg = system_gain.clamp(0.1, 3.0);
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.start_inner(source_mode, device_id, mg, sg)
        }))
        .unwrap_or_else(|_| Err("録音デバイスの初期化中に予期しないエラーが発生しました。入力デバイスを確認してください。".to_string()))
    }

    fn start_inner(
        &mut self,
        source_mode: AudioSourceMode,
        device_id: Option<String>,
        mic_gain: f32,
        system_gain: f32,
    ) -> Result<RecordingStatus, String> {
        if let Some(handle) = self.worker.take() {
            self.stop_flag.store(true, Ordering::SeqCst);
            let _ = handle.join();
        }

        // Android はマイク入力のみ対応。システム音声指定はマイクとして扱う。
        #[cfg(target_os = "android")]
        let source_mode = AudioSourceMode::Mic;

        let host = cpal::default_host();

        let pick_input_device = |did: Option<&String>| -> Option<Device> {
            if let Some(d_str) = did {
                if d_str.starts_with("in:") {
                    let target_name = d_str.splitn(3, ':').nth(2).unwrap_or("");
                    if let Some(found) = host
                        .input_devices()
                        .ok()
                        .and_then(|mut it| it.find(|d| d.name().ok().as_deref() == Some(target_name)))
                    {
                        return Some(found);
                    }
                }
            }
            host.default_input_device()
        };

        #[cfg(not(target_os = "linux"))]
        let pick_output_device = |did: Option<&String>| -> Option<Device> {
            if let Some(d_str) = did {
                if d_str.starts_with("out:") {
                    let target_name = d_str
                        .splitn(3, ':')
                        .nth(2)
                        .unwrap_or("")
                        .trim_end_matches("（システム音声）");
                    if let Some(found) = host
                        .output_devices()
                        .ok()
                        .and_then(|mut it| it.find(|d| d.name().ok().as_deref() == Some(target_name)))
                    {
                        return Some(found);
                    }
                }
            }
            host.default_output_device()
        };

        let mic_device = if matches!(source_mode, AudioSourceMode::Mic | AudioSourceMode::Both) {
            Some(pick_input_device(device_id.as_ref()).ok_or_else(|| {
                "マイク入力デバイスが見つかりません。OSのマイク権限を確認してください。".to_string()
            })?)
        } else {
            None
        };

        #[cfg(target_os = "linux")]
        let sys_device = if matches!(source_mode, AudioSourceMode::System | AudioSourceMode::Both) {
            let default_output_name = host
                .default_output_device()
                .and_then(|device| device.name().ok())
                .map(|name| name.to_ascii_lowercase());
            let selected_monitor = if source_mode == AudioSourceMode::System {
                device_id.as_ref().and_then(|id| {
                    if id.starts_with("in:") {
                        let target_name = id.splitn(3, ':').nth(2).unwrap_or("");
                        host.input_devices().ok().and_then(|mut it| {
                            it.find(|d| {
                                d.name().ok().as_deref() == Some(target_name)
                                    && target_name.to_ascii_lowercase().contains("monitor")
                            })
                        })
                    } else {
                        None
                    }
                })
            } else {
                None
            };
            Some(
                selected_monitor
                    .or_else(|| {
                        host.input_devices().ok().and_then(|mut devices| {
                            devices.find(|device| {
                                let Ok(name) = device.name() else {
                                    return false;
                                };
                                let name = name.to_ascii_lowercase();
                                name.contains("monitor")
                                    && default_output_name
                                        .as_ref()
                                        .is_some_and(|output| name.contains(output))
                            })
                        })
                    })
                    .or_else(|| {
                        host.input_devices().ok().and_then(|mut devices| {
                            devices.find(|device| {
                                device
                                    .name()
                                    .map(|name| name.to_ascii_lowercase().contains("monitor"))
                                    .unwrap_or(false)
                            })
                        })
                    })
                    .ok_or_else(|| {
                        "システム音声のモニターデバイスが見つかりません。PipeWire/PulseAudio のモニター入力を有効にしてください。".to_string()
                    })?,
            )
        } else {
            None
        };
        #[cfg(not(target_os = "linux"))]
        let sys_device = if matches!(source_mode, AudioSourceMode::System | AudioSourceMode::Both) {
            Some(pick_output_device(device_id.as_ref()).ok_or_else(|| {
                "システム音声（出力デバイス）が見つかりません。".to_string()
            })?)
        } else {
            None
        };

        eprintln!(
            "[audio] host={:?} mode={:?} microphone={:?} system_device={:?}",
            host.id(),
            source_mode,
            mic_device.as_ref().and_then(|device| device.name().ok()),
            sys_device.as_ref().and_then(|device| device.name().ok())
        );

        let device_name = match (&mic_device, &sys_device) {
            (Some(m), Some(s)) => format!(
                "{} + {}",
                m.name().unwrap_or_else(|_| "マイク".to_string()),
                s.name().unwrap_or_else(|_| "システム音声".to_string())
            ),
            (Some(m), None) => m.name().unwrap_or_else(|_| "マイク".to_string()),
            (None, Some(s)) => format!("{}（本体音声）", s.name().unwrap_or_else(|_| "スピーカー".to_string())),
            (None, None) => "既定デバイス".to_string(),
        };

        let temp_dir = storage::app_data_dir().join("temp_recordings");
        let _ = std::fs::create_dir_all(&temp_dir);
        let wav_path = temp_dir.join(format!("rec_{}.wav", Uuid::new_v4()));

        self.stop_flag.store(false, Ordering::SeqCst);
        self.paused_flag.store(false, Ordering::SeqCst);
        if let Ok(mut buf) = self.live_chunk_pcm.lock() {
            buf.clear();
        }
        if let Ok(mut e) = self.live_chunk_energy.lock() {
            *e = (0.0, 0.0);
        }

        {
            let mut rt = self.runtime.lock().unwrap_or_else(|e| e.into_inner());
            *rt = RecordingRuntime {
                state: "recording".to_string(),
                elapsed_ms: 0,
                level_rms: 0.0,
                waveform: vec![0.0; 48],
                device_name: device_name.clone(),
                source_mode: source_mode.clone(),
                is_silent_warning: false,
                silent_since: Some(Instant::now()),
                error_message: None,
                recovery_hint: None,
                temp_wav_path: Some(wav_path.clone()),
            };
        }

        let runtime = Arc::clone(&self.runtime);
        let stop_flag = Arc::clone(&self.stop_flag);
        let paused_flag = Arc::clone(&self.paused_flag);
        let chunk_cb = Arc::clone(&self.live_chunk_pcm);
        let energy_cb = Arc::clone(&self.live_chunk_energy);

        let wav_path_clone = wav_path.clone();
        let mode_clone = source_mode.clone();
        let handle = thread::spawn(move || {
            let spec = WavSpec {
                channels: 1,
                sample_rate: 16_000,
                bits_per_sample: 16,
                sample_format: WavSampleFormat::Int,
            };
            let mut writer = match WavWriter::create(&wav_path_clone, spec) {
                Ok(w) => Some(w),
                Err(e) => {
                    let mut rt = runtime.lock().unwrap_or_else(|e| e.into_inner());
                    rt.state = "error".to_string();
                    rt.error_message = Some(format!("録音ファイルを作成できません: {e}"));
                    rt.recovery_hint = Some("ディスクの空き容量と書き込み権限を確認してください。".to_string());
                    return;
                }
            };

            let mic_queue = Arc::new(Mutex::new(VecDeque::<f32>::new()));
            let sys_queue = Arc::new(Mutex::new(VecDeque::<f32>::new()));
            let mut streams: Vec<Stream> = Vec::new();

            if let Some(ref mdev) = mic_device {
                match build_resampled_stream(mdev, false, Arc::clone(&mic_queue), Arc::clone(&paused_flag), Arc::clone(&runtime)) {
                    Ok(s) => {
                        if let Err(e) = s.play() {
                            let mut rt = runtime.lock().unwrap_or_else(|e| e.into_inner());
                            rt.state = "error".to_string();
                            rt.error_message = Some(format!("マイクストリーム開始に失敗: {e}"));
                            return;
                        }
                        streams.push(s);
                    }
                    Err(e) => {
                        let mut rt = runtime.lock().unwrap_or_else(|e| e.into_inner());
                        rt.state = "error".to_string();
                        rt.error_message = Some(e);
                        return;
                    }
                }
            }

            if let Some(ref sdev) = sys_device {
                match build_resampled_stream(
                    sdev,
                    !cfg!(target_os = "linux"),
                    Arc::clone(&sys_queue),
                    Arc::clone(&paused_flag),
                    Arc::clone(&runtime),
                ) {
                    Ok(s) => {
                        if let Err(e) = s.play() {
                            if mode_clone == AudioSourceMode::System {
                                let mut rt = runtime.lock().unwrap_or_else(|e| e.into_inner());
                                rt.state = "error".to_string();
                                rt.error_message = Some(format!("本体音声ストリーム開始に失敗: {e}"));
                                return;
                            }
                        } else {
                            streams.push(s);
                        }
                    }
                    Err(e) => {
                        if mode_clone == AudioSourceMode::System {
                            let mut rt = runtime.lock().unwrap_or_else(|e| e.into_inner());
                            rt.state = "error".to_string();
                            rt.error_message = Some(e);
                            return;
                        }
                    }
                }
            }

            let mut last_tick = Instant::now();
            let stream_started = Instant::now();
            let mut mic_sample_count = 0usize;
            let mut sys_sample_count = 0usize;
            let mut mic_no_samples_reported = false;
            let mut sys_no_samples_reported = false;
            while !stop_flag.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(45));
                let now = Instant::now();
                let dt = now.duration_since(last_tick).as_millis() as u64;
                last_tick = now;

                if paused_flag.load(Ordering::SeqCst) {
                    if let Ok(mut mq) = mic_queue.lock() {
                        mq.clear();
                    }
                    if let Ok(mut sq) = sys_queue.lock() {
                        sq.clear();
                    }
                    continue;
                }

                {
                    let mut rt = runtime.lock().unwrap_or_else(|e| e.into_inner());
                    if rt.state == "recording" {
                        rt.elapsed_ms += dt;
                    }
                }

                let mic_samples: Vec<f32> = mic_queue
                    .lock()
                    .map(|mut q| q.drain(..).collect())
                    .unwrap_or_default();
                let sys_samples: Vec<f32> = sys_queue
                    .lock()
                    .map(|mut q| q.drain(..).collect())
                    .unwrap_or_default();
                mic_sample_count += mic_samples.len();
                sys_sample_count += sys_samples.len();

                if stream_started.elapsed() >= Duration::from_secs(2) {
                    if mic_device.is_some() && mic_sample_count == 0 && !mic_no_samples_reported {
                        eprintln!(
                            "[audio] no microphone samples received after 2s; total_samples={mic_sample_count}"
                        );
                        mic_no_samples_reported = true;
                    }
                    if sys_device.is_some() && sys_sample_count == 0 && !sys_no_samples_reported {
                        eprintln!(
                            "[audio] no system-audio samples received after 2s; total_samples={sys_sample_count}"
                        );
                        sys_no_samples_reported = true;
                    }
                }
                if !mic_samples.is_empty() || !sys_samples.is_empty() {
                    let me: f64 = mic_samples.iter().map(|&v| (v as f64) * (v as f64)).sum();
                    let se: f64 = sys_samples.iter().map(|&v| (v as f64) * (v as f64)).sum();
                    if let Ok(mut eg) = energy_cb.lock() {
                        eg.0 += me;
                        eg.1 += se;
                    }
                }

                let mixed: Vec<f32> = match (mic_samples.is_empty(), sys_samples.is_empty()) {
                    (true, true) => {
                        // In System mode when nothing is playing on PC, WASAPI loopback produces no packets
                        if mode_clone == AudioSourceMode::System {
                            let mut rt = runtime.lock().unwrap_or_else(|e| e.into_inner());
                            rt.level_rms = 0.0;
                            rt.waveform.remove(0);
                            rt.waveform.push(0.0);
                        }
                        continue;
                    }
                    (false, true) => mic_samples
                        .into_iter()
                        .map(|m| (m * mic_gain).clamp(-1.0, 1.0))
                        .collect(),
                    (true, false) => sys_samples
                        .into_iter()
                        .map(|s| (s * system_gain).clamp(-1.0, 1.0))
                        .collect(),
                    (false, false) => {
                        let len = mic_samples.len().max(sys_samples.len());
                        (0..len)
                            .map(|i| {
                                let m = mic_samples.get(i).copied().unwrap_or(0.0) * mic_gain;
                                let s = sys_samples.get(i).copied().unwrap_or(0.0) * system_gain;
                                (m + s).clamp(-1.0, 1.0)
                            })
                            .collect()
                    }
                };

                process_16k_samples(&mixed, &mut writer, &chunk_cb, &runtime);
            }

            drop(streams);
            eprintln!(
                "[audio] recording stream ended; microphone_samples={mic_sample_count} system_samples={sys_sample_count}"
            );
            if let Some(w) = writer.take() {
                let _ = w.finalize();
            }
        });

        self.worker = Some(handle);
        Ok(self.status())
    }

    pub fn pause(&mut self) -> RecordingStatus {
        self.paused_flag.store(true, Ordering::SeqCst);
        let mut rt = self.runtime.lock().unwrap_or_else(|e| e.into_inner());
        if rt.state == "recording" {
            rt.state = "paused".to_string();
        }
        RecordingStatus {
            state: rt.state.clone(),
            elapsed_ms: rt.elapsed_ms,
            level_rms: 0.0,
            waveform: rt.waveform.clone(),
            device_name: rt.device_name.clone(),
            source_mode: rt.source_mode.clone(),
            is_silent_warning: false,
            error_message: rt.error_message.clone(),
            recovery_hint: rt.recovery_hint.clone(),
            temp_wav_path: rt
                .temp_wav_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
        }
    }

    pub fn resume(&mut self) -> RecordingStatus {
        self.paused_flag.store(false, Ordering::SeqCst);
        let mut rt = self.runtime.lock().unwrap_or_else(|e| e.into_inner());
        if rt.state == "paused" {
            rt.state = "recording".to_string();
            rt.silent_since = Some(Instant::now());
        }
        RecordingStatus {
            state: rt.state.clone(),
            elapsed_ms: rt.elapsed_ms,
            level_rms: rt.level_rms,
            waveform: rt.waveform.clone(),
            device_name: rt.device_name.clone(),
            source_mode: rt.source_mode.clone(),
            is_silent_warning: rt.is_silent_warning,
            error_message: rt.error_message.clone(),
            recovery_hint: rt.recovery_hint.clone(),
            temp_wav_path: rt
                .temp_wav_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
        }
    }

    pub fn stop(&mut self) -> RecordingStatus {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(handle) = self.worker.take() {
            let _ = handle.join();
        }
        let mut rt = self.runtime.lock().unwrap_or_else(|e| e.into_inner());
        rt.state = "idle".to_string();
        rt.level_rms = 0.0;
        RecordingStatus {
            state: rt.state.clone(),
            elapsed_ms: rt.elapsed_ms,
            level_rms: rt.level_rms,
            waveform: rt.waveform.clone(),
            device_name: rt.device_name.clone(),
            source_mode: rt.source_mode.clone(),
            is_silent_warning: rt.is_silent_warning,
            error_message: rt.error_message.clone(),
            recovery_hint: rt.recovery_hint.clone(),
            temp_wav_path: rt
                .temp_wav_path
                .as_ref()
                .map(|p| p.to_string_lossy().to_string()),
        }
    }
}

pub type _UnusedBuf = BufWriter<File>;

fn normalize_i32(sample: i32) -> f32 {
    (sample as f64 / 2_147_483_648.0) as f32
}

fn normalize_u32(sample: u32) -> f32 {
    ((sample as f64 - 2_147_483_648.0) / 2_147_483_648.0) as f32
}

fn build_resampled_stream(
    device: &Device,
    is_loopback: bool,
    queue: Arc<Mutex<VecDeque<f32>>>,
    paused: Arc<AtomicBool>,
    err_runtime: Arc<Mutex<RecordingRuntime>>,
) -> Result<Stream, String> {
    let supported_config = if is_loopback {
        device
            .default_output_config()
            .or_else(|_| device.default_input_config())
    } else {
        device.default_input_config()
    }
    .map_err(|e| format!("オーディオ設定を取得できませんでした（{e}）"))?;

    let sample_rate = supported_config.sample_rate().0;
    let channels = supported_config.channels().max(1) as usize;
    let sample_format = supported_config.sample_format();
    eprintln!(
        "[audio] stream device={:?} sample_rate={sample_rate} channels={channels} format={sample_format:?} loopback={is_loopback}",
        device.name().ok()
    );
    let stream_config: StreamConfig = supported_config.into();
    let resample_ratio = (sample_rate as f64 / 16_000.0).max(0.1);
    let phase = Arc::new(Mutex::new(0.0f64));

    let push_mono = move |mono: &[f32]| {
        if paused.load(Ordering::SeqCst) || mono.is_empty() {
            return;
        }
        let mut p = phase.lock().unwrap_or_else(|e| e.into_inner());
        let mut idx = *p;
        if let Ok(mut q) = queue.lock() {
            while (idx as usize) < mono.len() {
                q.push_back(mono[idx as usize].clamp(-1.0, 1.0));
                idx += resample_ratio;
            }
            // Keep queue bounded (~3 seconds max)
            while q.len() > 48_000 {
                q.pop_front();
            }
        }
        *p = idx - mono.len() as f64;
    };

    let err_fn = move |err: cpal::StreamError| {
        if let Ok(mut rt) = err_runtime.lock() {
            rt.state = "error".to_string();
            rt.error_message = Some(format!("録音中にデバイスエラーが発生しました: {err}"));
        }
    };

    macro_rules! build_typed_stream {
        ($sample_type:ty, $normalize:expr) => {
            device
                .build_input_stream(
                    &stream_config,
                    move |data: &[$sample_type], _| {
                        let mono: Vec<f32> = data
                            .chunks(channels)
                            .map(|frame| {
                                frame.iter().map(|&sample| $normalize(sample)).sum::<f32>()
                                    / channels as f32
                            })
                            .collect();
                        push_mono(&mono);
                    },
                    err_fn,
                    None,
                )
                .map_err(|e| format!("オーディオ入力を開けませんでした: {e}"))
        };
    }

    match sample_format {
        SampleFormat::F32 => build_typed_stream!(f32, |sample: f32| sample),
        SampleFormat::F64 => build_typed_stream!(f64, |sample: f64| sample as f32),
        SampleFormat::I8 => build_typed_stream!(i8, |sample: i8| sample as f32 / 128.0),
        SampleFormat::I16 => build_typed_stream!(i16, |sample: i16| sample as f32 / 32768.0),
        SampleFormat::I32 => build_typed_stream!(i32, normalize_i32),
        SampleFormat::I64 => build_typed_stream!(i64, |sample: i64| (sample as f64
            / 9_223_372_036_854_775_808.0)
            as f32),
        SampleFormat::U8 => build_typed_stream!(u8, |sample: u8| (sample as f32 - 128.0) / 128.0),
        SampleFormat::U16 => {
            build_typed_stream!(u16, |sample: u16| (sample as f32 - 32768.0) / 32768.0)
        }
        SampleFormat::U32 => build_typed_stream!(u32, normalize_u32),
        SampleFormat::U64 => build_typed_stream!(u64, |sample: u64| ((sample as f64
            - 9_223_372_036_854_775_808.0)
            / 9_223_372_036_854_775_808.0)
            as f32),
        _ => Err("未対応の音声サンプル形式です".to_string()),
    }
}

fn process_16k_samples(
    samples: &[f32],
    writer: &mut Option<WavWriter<BufWriter<File>>>,
    chunk_pcm: &Arc<Mutex<Vec<i16>>>,
    runtime: &Arc<Mutex<RecordingRuntime>>,
) {
    if samples.is_empty() {
        return;
    }
    let mut sum_sq = 0.0f32;
    for &s in samples {
        sum_sq += s * s;
    }
    let rms = (sum_sq / samples.len() as f32).sqrt().min(1.0);
    // Perceptual loudness curve so quiet vs loud voice varies clearly
    let visual = if rms < 0.0015 {
        0.0
    } else {
        (rms * 14.0).sqrt().clamp(0.05, 1.0)
    };

    if let Some(ref mut w) = writer {
        let mut chunk_guard = chunk_pcm.lock().ok();
        for &s in samples {
            let pcm = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            let _ = w.write_sample(pcm);
            if let Some(ref mut c) = chunk_guard {
                c.push(pcm);
            }
        }
    }

    if let Ok(mut rt) = runtime.lock() {
        rt.level_rms = rms;
        rt.waveform.remove(0);
        rt.waveform.push(visual);
        if rms < 0.002 {
            if let Some(since) = rt.silent_since {
                if since.elapsed() >= Duration::from_secs(6) {
                    rt.is_silent_warning = true;
                }
            } else {
                rt.silent_since = Some(Instant::now());
            }
        } else {
            rt.silent_since = None;
            rt.is_silent_warning = false;
        }
    }
}

static MIC_TEST_STOP: Mutex<Option<Arc<AtomicBool>>> = Mutex::new(None);
static MIC_TEST_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn emit_mic_test_level(app: &tauri::AppHandle, payload: serde_json::Value) {
    let _ = tauri::Emitter::emit(app, "mic-test-level", payload);
}

pub fn stop_mic_test() {
    if let Ok(mut guard) = MIC_TEST_STOP.lock() {
        if let Some(flag) = guard.take() {
            flag.store(true, Ordering::SeqCst);
        }
    }
}

/// マイク入力を継続的にモニタリングし、80ms 間隔で `mic-test-level` イベントを配信する。
/// 録音と同じ入力経路（選択中の入力デバイス）を使う。
/// 返り値はセッション ID。古いセッションの終了イベントを画面側で無視するために使う。
pub fn start_mic_test(app: tauri::AppHandle, device_id: Option<String>) -> Result<u64, String> {
    stop_mic_test();
    let session = MIC_TEST_SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    let stop = Arc::new(AtomicBool::new(false));
    if let Ok(mut guard) = MIC_TEST_STOP.lock() {
        *guard = Some(stop.clone());
    } else {
        return Err("マイクテストの状態を初期化できませんでした。".to_string());
    }
    thread::spawn(move || run_mic_test(app, device_id, stop, session));
    Ok(session)
}

fn run_mic_test(
    app: tauri::AppHandle,
    device_id: Option<String>,
    stop: Arc<AtomicBool>,
    session: u64,
) {
    let fail = |app: &tauri::AppHandle, device_name: &str, message: String| {
        eprintln!("[audio] microphone test failed: {message}");
        emit_mic_test_level(
            app,
            serde_json::json!({
                "session": session,
                "active": false,
                "device_name": device_name,
                "rms": 0.0,
                "peak": 0.0,
                "elapsed_ms": 0,
                "error": message,
            }),
        );
    };

    let host = cpal::default_host();
    let device = if let Some(ref d_str) = device_id {
        if d_str.starts_with("in:") {
            let target_name = d_str.splitn(3, ':').nth(2).unwrap_or("");
            host.input_devices()
                .ok()
                .and_then(|mut it| it.find(|d| d.name().ok().as_deref() == Some(target_name)))
                .or_else(|| host.default_input_device())
        } else {
            host.default_input_device()
        }
    } else {
        host.default_input_device()
    };
    let Some(device) = device else {
        fail(&app, "既定のマイク", "マイク入力デバイスが見つかりません。OSのマイク権限と入力デバイスを確認してください。".to_string());
        return;
    };

    let dev_name = device.name().unwrap_or_else(|_| "既定のマイク".to_string());
    let config = match device.default_input_config() {
        Ok(config) => config,
        Err(e) => {
            fail(&app, &dev_name, format!("マイク設定の取得に失敗しました: {e}"));
            return;
        }
    };
    let channels = config.channels();
    let sample_rate = config.sample_rate().0;
    let sample_format = config.sample_format();
    eprintln!(
        "[audio] microphone test start host={:?} device={dev_name:?} sample_rate={sample_rate} channels={channels} format={sample_format:?}",
        host.id()
    );

    // (二乗和, サンプル数, ピーク) を 80ms ごとに取り出す。
    let acc = Arc::new(Mutex::new((0.0f64, 0usize, 0.0f32)));
    let acc_cb = acc.clone();

    macro_rules! build_test_stream {
        ($sample_type:ty, $normalize:expr) => {
            device.build_input_stream(
                &config.clone().into(),
                move |data: &[$sample_type], _| {
                    if let Ok(mut g) = acc_cb.lock() {
                        for &sample in data {
                            let normalized = $normalize(sample);
                            let abs = normalized.abs() as f32;
                            g.0 += normalized * normalized;
                            g.1 += 1;
                            if abs > g.2 {
                                g.2 = abs;
                            }
                        }
                    }
                },
                |_| {},
                None,
            )
        };
    }
    let stream = match sample_format {
        SampleFormat::F32 => build_test_stream!(f32, |sample: f32| sample as f64),
        SampleFormat::F64 => build_test_stream!(f64, |sample: f64| sample),
        SampleFormat::I8 => build_test_stream!(i8, |sample: i8| sample as f64 / 128.0),
        SampleFormat::I16 => build_test_stream!(i16, |sample: i16| sample as f64 / 32768.0),
        SampleFormat::I32 => build_test_stream!(i32, |sample: i32| normalize_i32(sample) as f64),
        SampleFormat::I64 => {
            build_test_stream!(i64, |sample: i64| sample as f64
                / 9_223_372_036_854_775_808.0)
        }
        SampleFormat::U8 => build_test_stream!(u8, |sample: u8| (sample as f64 - 128.0) / 128.0),
        SampleFormat::U16 => {
            build_test_stream!(u16, |sample: u16| (sample as f64 - 32768.0) / 32768.0)
        }
        SampleFormat::U32 => build_test_stream!(u32, |sample: u32| normalize_u32(sample) as f64),
        SampleFormat::U64 => build_test_stream!(u64, |sample: u64| (sample as f64
            - 9_223_372_036_854_775_808.0)
            / 9_223_372_036_854_775_808.0),
        _ => {
            let message = format!("非対応のマイクサンプル形式です: {sample_format:?}");
            fail(&app, &dev_name, message);
            return;
        }
    };
    let stream = match stream {
        Ok(stream) => stream,
        Err(e) => {
            fail(&app, &dev_name, format!("マイクテストの開始に失敗しました: {e}"));
            return;
        }
    };
    if let Err(e) = stream.play() {
        fail(&app, &dev_name, format!("マイクストリームの再生に失敗しました: {e}"));
        return;
    }

    let started = Instant::now();
    emit_mic_test_level(
        &app,
        serde_json::json!({
            "session": session,
            "active": true,
            "device_name": dev_name,
            "rms": 0.0,
            "peak": 0.0,
            "elapsed_ms": 0,
            "error": null,
        }),
    );

    while !stop.load(Ordering::SeqCst) {
        thread::sleep(Duration::from_millis(80));
        let (sum_sq, count, peak) = acc
            .lock()
            .map(|mut g| {
                let snapshot = *g;
                *g = (0.0, 0, 0.0);
                snapshot
            })
            .unwrap_or((0.0, 0, 0.0));
        let rms = if count > 0 {
            ((sum_sq / count as f64).sqrt() as f32).min(1.0)
        } else {
            0.0
        };
        emit_mic_test_level(
            &app,
            serde_json::json!({
                "session": session,
                "active": true,
                "device_name": dev_name,
                "rms": rms,
                "peak": peak,
                "elapsed_ms": started.elapsed().as_millis() as u64,
                "error": null,
            }),
        );
    }

    drop(stream);
    eprintln!("[audio] microphone test stopped device={dev_name:?}");
    emit_mic_test_level(
        &app,
        serde_json::json!({
            "session": session,
            "active": false,
            "device_name": dev_name,
            "rms": 0.0,
            "peak": 0.0,
            "elapsed_ms": started.elapsed().as_millis() as u64,
            "error": null,
        }),
    );
}

#[cfg(test)]
mod tests {
    #[test]
    fn normalizes_32_bit_integer_audio_samples() {
        assert_eq!(super::normalize_i32(i32::MIN), -1.0);
        assert!(super::normalize_i32(i32::MAX) > 0.999_999);
        assert_eq!(super::normalize_u32(0), -1.0);
        assert!(super::normalize_u32(u32::MAX) > 0.999_999);
    }
}
