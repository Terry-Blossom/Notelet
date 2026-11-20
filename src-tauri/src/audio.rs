use crate::models::{AudioDeviceInfo, AudioSourceMode, RecordingStatus};
use crate::storage;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use hound::{SampleFormat as WavSampleFormat, WavSpec, WavWriter};
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
            stop_flag: Arc::new(AtomicBool::new(false)),
            paused_flag: Arc::new(AtomicBool::new(false)),
            worker: None,
        }
    }

    pub fn take_live_chunk(&self, min_samples: usize) -> Option<(PathBuf, u64)> {
        let samples = {
            let mut buf = self.live_chunk_pcm.lock().ok()?;
            if buf.len() < min_samples {
                return None;
            }
            std::mem::take(&mut *buf)
        };
        let mut sum_sq = 0.0f64;
        for &s in &samples {
            let f = s as f64 / i16::MAX as f64;
            sum_sq += f * f;
        }
        let rms = (sum_sq / samples.len().max(1) as f64).sqrt();
        if rms < 0.001 {
            return None;
        }
        let elapsed_ms = self.runtime.lock().ok().map(|r| r.elapsed_ms).unwrap_or(0);
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
            return Some((path, elapsed_ms));
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
    ) -> Result<RecordingStatus, String> {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.start_inner(source_mode, device_id)
        }))
        .unwrap_or_else(|_| Err("録音デバイスの初期化中に予期しないエラーが発生しました。入力デバイスを確認してください。".to_string()))
    }

    fn start_inner(
        &mut self,
        source_mode: AudioSourceMode,
        device_id: Option<String>,
    ) -> Result<RecordingStatus, String> {
        if let Some(handle) = self.worker.take() {
            self.stop_flag.store(true, Ordering::SeqCst);
            let _ = handle.join();
        }

        let host = cpal::default_host();
        let target_device = match source_mode {
            AudioSourceMode::Mic | AudioSourceMode::Both => {
                if let Some(ref did) = device_id {
                    let target_name = did.splitn(3, ':').nth(2).unwrap_or("");
                    host.input_devices()
                        .ok()
                        .and_then(|mut it| it.find(|d| d.name().ok().as_deref() == Some(target_name)))
                        .or_else(|| host.default_input_device())
                } else {
                    host.default_input_device()
                }
            }
            AudioSourceMode::System => {
                if let Some(ref did) = device_id {
                    let target_name = did
                        .splitn(3, ':')
                        .nth(2)
                        .unwrap_or("")
                        .trim_end_matches("（システム音声）");
                    host.output_devices()
                        .ok()
                        .and_then(|mut it| it.find(|d| d.name().ok().as_deref() == Some(target_name)))
                        .or_else(|| host.default_output_device())
                } else {
                    host.default_output_device()
                }
            }
        };

        let device = target_device.ok_or_else(|| {
            "録音デバイスが見つかりません。マイクまたは出力デバイスが接続されているか確認し、OSのマイク権限を許可してください。".to_string()
        })?;

        let device_name = device.name().unwrap_or_else(|_| "既定デバイス".to_string());
        let supported_config = match source_mode {
            AudioSourceMode::System => device.default_output_config().or_else(|_| device.default_input_config()),
            _ => device.default_input_config(),
        }
        .map_err(|e| {
            format!(
                "オーディオ設定を取得できませんでした（{e}）。OSのプライバシー設定でマイク権限を確認してください。"
            )
        })?;

        let sample_rate = supported_config.sample_rate().0;
        let channels = supported_config.channels() as usize;
        let sample_format = supported_config.sample_format();
        let stream_config: StreamConfig = supported_config.into();

        let temp_dir = storage::app_data_dir().join("temp_recordings");
        let _ = std::fs::create_dir_all(&temp_dir);
        let wav_path = temp_dir.join(format!("rec_{}.wav", Uuid::new_v4()));

        self.stop_flag.store(false, Ordering::SeqCst);
        self.paused_flag.store(false, Ordering::SeqCst);
        if let Ok(mut buf) = self.live_chunk_pcm.lock() {
            buf.clear();
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

        let wav_path_clone = wav_path.clone();
        let handle = thread::spawn(move || {
            let spec = WavSpec {
                channels: 1,
                sample_rate: 16_000,
                bits_per_sample: 16,
                sample_format: WavSampleFormat::Int,
            };
            let writer = match WavWriter::create(&wav_path_clone, spec) {
                Ok(w) => Arc::new(Mutex::new(Some(w))),
                Err(e) => {
                    let mut rt = runtime.lock().unwrap();
                    rt.state = "error".to_string();
                    rt.error_message = Some(format!("録音ファイルを作成できません: {e}"));
                    rt.recovery_hint = Some("ディスクの空き容量と書き込み権限を確認してください。".to_string());
                    return;
                }
            };

            let runtime_cb = Arc::clone(&runtime);
            let resample_ratio = sample_rate as f64 / 16_000.0;
            let phase = Arc::new(Mutex::new(0.0f64));

            let err_runtime = Arc::clone(&runtime);
            let err_fn = move |err: cpal::StreamError| {
                let mut rt = err_runtime.lock().unwrap();
                rt.state = "error".to_string();
                rt.error_message = Some(format!("録音中にデバイスが切断されたかエラーが発生しました: {err}"));
                rt.recovery_hint = Some("そこまでの録音はローカルに保存されています。デバイスを確認して再録音するか、途中までの音声で文字起こしを実行できます。".to_string());
            };

            let w_f32 = Arc::clone(&writer);
            let r_f32 = Arc::clone(&runtime_cb);
            let p_f32 = Arc::clone(&paused_flag);
            let ph_f32 = Arc::clone(&phase);
            let c_f32 = Arc::clone(&chunk_cb);

            let w_i16 = Arc::clone(&writer);
            let r_i16 = Arc::clone(&runtime_cb);
            let p_i16 = Arc::clone(&paused_flag);
            let ph_i16 = Arc::clone(&phase);
            let c_i16 = Arc::clone(&chunk_cb);

            let w_u16 = Arc::clone(&writer);
            let r_u16 = Arc::clone(&runtime_cb);
            let p_u16 = Arc::clone(&paused_flag);
            let ph_u16 = Arc::clone(&phase);
            let c_u16 = Arc::clone(&chunk_cb);

            let stream_res = match sample_format {
                SampleFormat::F32 => device.build_input_stream(
                    &stream_config,
                    move |data: &[f32], _| {
                        let mono: Vec<f32> = data
                            .chunks(channels)
                            .map(|frame| frame.iter().sum::<f32>() / channels as f32)
                            .collect();
                        process_mono_samples(&mono, &w_f32, &c_f32, &r_f32, &p_f32, &ph_f32, resample_ratio);
                    },
                    err_fn,
                    None,
                ),
                SampleFormat::I16 => device.build_input_stream(
                    &stream_config,
                    move |data: &[i16], _| {
                        let mono: Vec<f32> = data
                            .chunks(channels)
                            .map(|frame| {
                                frame.iter().map(|&v| v as f32 / i16::MAX as f32).sum::<f32>()
                                    / channels as f32
                            })
                            .collect();
                        process_mono_samples(&mono, &w_i16, &c_i16, &r_i16, &p_i16, &ph_i16, resample_ratio);
                    },
                    err_fn,
                    None,
                ),
                SampleFormat::U16 => device.build_input_stream(
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
                        process_mono_samples(&mono, &w_u16, &c_u16, &r_u16, &p_u16, &ph_u16, resample_ratio);
                    },
                    err_fn,
                    None,
                ),
                _ => {
                    let mut rt = runtime.lock().unwrap();
                    rt.state = "error".to_string();
                    rt.error_message = Some("未対応の音声サンプル形式です".to_string());
                    rt.recovery_hint = Some("別のオーディオ入力デバイスを選択してください。".to_string());
                    return;
                }
            };

            let stream = match stream_res {
                Ok(s) => s,
                Err(e) => {
                    let mut rt = runtime.lock().unwrap();
                    rt.state = "error".to_string();
                    rt.error_message = Some(format!("オーディオ入力を開けませんでした: {e}"));
                    rt.recovery_hint = Some(if source_mode == AudioSourceMode::System {
                        "システム音声の録音に対応していない環境の場合は、入力ソースを「マイク」に切り替えてください。".to_string()
                    } else {
                        "OSのプライバシー設定でマイクへのアクセスが許可されているか確認してください。".to_string()
                    });
                    return;
                }
            };

            if let Err(e) = stream.play() {
                let mut rt = runtime.lock().unwrap();
                rt.state = "error".to_string();
                rt.error_message = Some(format!("録音ストリームの開始に失敗しました: {e}"));
                return;
            }

            let mut last_tick = Instant::now();
            while !stop_flag.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(80));
                let now = Instant::now();
                let dt = now.duration_since(last_tick).as_millis() as u64;
                last_tick = now;
                if !paused_flag.load(Ordering::SeqCst) {
                    let mut rt = runtime.lock().unwrap();
                    if rt.state == "recording" {
                        rt.elapsed_ms += dt;
                    }
                }
            }

            drop(stream);
            let final_writer = writer.lock().ok().and_then(|mut guard| guard.take());
            if let Some(w) = final_writer {
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

fn process_mono_samples(
    mono: &[f32],
    writer: &Arc<Mutex<Option<WavWriter<BufWriter<File>>>>>,
    chunk_pcm: &Arc<Mutex<Vec<i16>>>,
    runtime: &Arc<Mutex<RecordingRuntime>>,
    paused: &Arc<AtomicBool>,
    phase: &Arc<Mutex<f64>>,
    resample_ratio: f64,
) {
    if paused.load(Ordering::SeqCst) || mono.is_empty() {
        return;
    }
    let mut sum_sq = 0.0f32;
    for &s in mono {
        sum_sq += s * s;
    }
    let rms = (sum_sq / mono.len() as f32).sqrt().min(1.0);

    if let Ok(mut guard) = writer.lock() {
        if let Some(ref mut w) = *guard {
            let mut p = phase.lock().unwrap();
            let mut idx = *p;
            let mut chunk_guard = chunk_pcm.lock().ok();
            while (idx as usize) < mono.len() {
                let s = mono[idx as usize].clamp(-1.0, 1.0);
                let pcm = (s * i16::MAX as f32) as i16;
                let _ = w.write_sample(pcm);
                if let Some(ref mut c) = chunk_guard {
                    c.push(pcm);
                }
                idx += resample_ratio;
            }
            *p = idx - mono.len() as f64;
        }
    }

    if let Ok(mut rt) = runtime.lock() {
        rt.level_rms = rms;
        rt.waveform.remove(0);
        rt.waveform.push(rms);
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
