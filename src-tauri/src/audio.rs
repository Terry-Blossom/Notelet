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
        if rms < 0.001 {
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
        let mut devices = Vec::new();
        let default_in_name = host
            .default_input_device()
            .and_then(|d| d.name().ok())
            .unwrap_or_default();
        if let Ok(inputs) = host.input_devices() {
            for (idx, dev) in inputs.enumerate() {
                if let Ok(name) = dev.name() {
                    devices.push(AudioDeviceInfo {
                        id: format!("in:{idx}:{name}"),
                        is_default: name == default_in_name,
                        name,
                        kind: "input".to_string(),
                    });
                }
            }
        }
        let default_out_name = host
            .default_output_device()
            .and_then(|d| d.name().ok())
            .unwrap_or_default();
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
        devices
    }

    pub fn status(&self) -> RecordingStatus {
        let rt = self.runtime.lock().unwrap();
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

        let sys_device = if matches!(source_mode, AudioSourceMode::System | AudioSourceMode::Both) {
            Some(pick_output_device(device_id.as_ref()).ok_or_else(|| {
                "システム音声（出力デバイス）が見つかりません。".to_string()
            })?)
        } else {
            None
        };

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
            let mut rt = self.runtime.lock().unwrap();
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
                    let mut rt = runtime.lock().unwrap();
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
                            let mut rt = runtime.lock().unwrap();
                            rt.state = "error".to_string();
                            rt.error_message = Some(format!("マイクストリーム開始に失敗: {e}"));
                            return;
                        }
                        streams.push(s);
                    }
                    Err(e) => {
                        let mut rt = runtime.lock().unwrap();
                        rt.state = "error".to_string();
                        rt.error_message = Some(e);
                        return;
                    }
                }
            }

            if let Some(ref sdev) = sys_device {
                match build_resampled_stream(sdev, true, Arc::clone(&sys_queue), Arc::clone(&paused_flag), Arc::clone(&runtime)) {
                    Ok(s) => {
                        if let Err(e) = s.play() {
                            if mode_clone == AudioSourceMode::System {
                                let mut rt = runtime.lock().unwrap();
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
                            let mut rt = runtime.lock().unwrap();
                            rt.state = "error".to_string();
                            rt.error_message = Some(e);
                            return;
                        }
                    }
                }
            }

            let mut last_tick = Instant::now();
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
                    let mut rt = runtime.lock().unwrap();
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

                if (!mic_samples.is_empty() || !sys_samples.is_empty()) {
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
                            let mut rt = runtime.lock().unwrap();
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
            if let Some(w) = writer.take() {
                let _ = w.finalize();
            }
        });

        self.worker = Some(handle);
        Ok(self.status())
    }

    pub fn pause(&mut self) -> RecordingStatus {
        self.paused_flag.store(true, Ordering::SeqCst);
        let mut rt = self.runtime.lock().unwrap();
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
        let mut rt = self.runtime.lock().unwrap();
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
        let mut rt = self.runtime.lock().unwrap();
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
    let stream_config: StreamConfig = supported_config.into();
    let resample_ratio = (sample_rate as f64 / 16_000.0).max(0.1);
    let phase = Arc::new(Mutex::new(0.0f64));

    let push_mono = move |mono: &[f32]| {
        if paused.load(Ordering::SeqCst) || mono.is_empty() {
            return;
        }
        let mut p = phase.lock().unwrap();
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

    match sample_format {
        SampleFormat::F32 => device
            .build_input_stream(
                &stream_config,
                move |data: &[f32], _| {
                    let mono: Vec<f32> = data
                        .chunks(channels)
                        .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                        .collect();
                    push_mono(&mono);
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("オーディオ入力を開けませんでした: {e}")),
        SampleFormat::I16 => device
            .build_input_stream(
                &stream_config,
                move |data: &[i16], _| {
                    let mono: Vec<f32> = data
                        .chunks(channels)
                        .map(|frame| {
                            frame.iter().map(|&v| v as f32 / i16::MAX as f32).sum::<f32>()
                                / channels as f32
                        })
                        .collect();
                    push_mono(&mono);
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("オーディオ入力を開けませんでした: {e}")),
        SampleFormat::U16 => device
            .build_input_stream(
                &stream_config,
                move |data: &[u16], _| {
                    let mono: Vec<f32> = data
                        .chunks(channels)
                        .map(|frame| {
                            frame
                                .iter()
                                .map(|&v| (v as f32 / u16::MAX as f32) * 2.0 - 1.0)
                                .sum::<f32>()
                                / channels as f32
                        })
                        .collect();
                    push_mono(&mono);
                },
                err_fn,
                None,
            )
            .map_err(|e| format!("オーディオ入力を開けませんでした: {e}")),
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

pub fn test_mic_level(device_id: Option<String>) -> Result<(f32, String), String> {
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
    }
    .ok_or_else(|| "マイク入力デバイスが見つかりません。".to_string())?;

    let dev_name = device.name().unwrap_or_else(|_| "既定のマイク".to_string());
    let config = device
        .default_input_config()
        .map_err(|e| format!("マイク設定の取得に失敗しました: {e}"))?;
    let acc = Arc::new(Mutex::new((0.0f64, 0usize)));
    let acc_cb = acc.clone();

    let stream = match config.sample_format() {
        SampleFormat::F32 => device.build_input_stream(
            &config.into(),
            move |data: &[f32], _| {
                if let Ok(mut g) = acc_cb.lock() {
                    for &s in data {
                        g.0 += (s as f64) * (s as f64);
                        g.1 += 1;
                    }
                }
            },
            |_| {},
            None,
        ),
        SampleFormat::I16 => device.build_input_stream(
            &config.into(),
            move |data: &[i16], _| {
                if let Ok(mut g) = acc_cb.lock() {
                    for &s in data {
                        let f = s as f64 / i16::MAX as f64;
                        g.0 += f * f;
                        g.1 += 1;
                    }
                }
            },
            |_| {},
            None,
        ),
        SampleFormat::U16 => device.build_input_stream(
            &config.into(),
            move |data: &[u16], _| {
                if let Ok(mut g) = acc_cb.lock() {
                    for &s in data {
                        let f = (s as f64 - 32768.0) / 32768.0;
                        g.0 += f * f;
                        g.1 += 1;
                    }
                }
            },
            |_| {},
            None,
        ),
        _ => return Err("非対応のマイクサンプル形式です。".to_string()),
    }
    .map_err(|e| format!("マイクテストの開始に失敗しました: {e}"))?;

    stream
        .play()
        .map_err(|e| format!("マイクストリームの再生に失敗しました: {e}"))?;
    thread::sleep(Duration::from_millis(350));
    drop(stream);

    let (sum_sq, count) = acc.lock().map(|g| *g).unwrap_or((0.0, 0));
    let rms = if count > 0 {
        ((sum_sq / count as f64).sqrt() as f32).min(1.0)
    } else {
        0.0
    };
    Ok((rms, dev_name))
}
