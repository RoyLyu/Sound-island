use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::{fs::File, path::Path};
use symphonia::core::{
    audio::SampleBuffer, codecs::DecoderOptions, errors::Error as SymphoniaError,
    formats::FormatOptions, io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundLabSettings {
    pub low_gain_db: f32,
    pub mid_gain_db: f32,
    pub high_gain_db: f32,
    pub reverb_mix: f32,
    pub delay_mix: f32,
    pub delay_ms: f32,
    pub delay_feedback: f32,
    pub distortion: f32,
    pub output_gain_db: f32,
    pub stereo_width: f32,
    pub mono_bass_hz: f32,
    pub center_preserve: bool,
    pub mono_compatibility: bool,
    pub mono_stereoize: bool,
    pub stereoize_amount: f32,
    pub space_preset: String,
    pub occlusion_preset: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundLabExport {
    output_path: String,
    duration: f64,
    sample_rate: u32,
    channels: usize,
}

#[derive(Debug)]
struct DecodedAudio {
    samples: Vec<f32>,
    sample_rate: u32,
    channels: usize,
}

#[derive(Clone, Copy)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    z1: f32,
    z2: f32,
}

impl Biquad {
    fn peaking(sample_rate: f32, frequency: f32, q: f32, gain_db: f32) -> Self {
        let amplitude = 10f32.powf(gain_db / 40.0);
        let omega = 2.0 * std::f32::consts::PI * frequency / sample_rate;
        let alpha = omega.sin() / (2.0 * q);
        let cos = omega.cos();
        let a0 = 1.0 + alpha / amplitude;
        Self {
            b0: (1.0 + alpha * amplitude) / a0,
            b1: (-2.0 * cos) / a0,
            b2: (1.0 - alpha * amplitude) / a0,
            a1: (-2.0 * cos) / a0,
            a2: (1.0 - alpha / amplitude) / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        let output = self.b0 * input + self.z1;
        self.z1 = self.b1 * input - self.a1 * output + self.z2;
        self.z2 = self.b2 * input - self.a2 * output;
        output
    }

    fn lowpass(sample_rate: f32, frequency: f32, q: f32) -> Self {
        let omega = 2.0 * std::f32::consts::PI * frequency / sample_rate;
        let alpha = omega.sin() / (2.0 * q);
        let cos = omega.cos();
        let a0 = 1.0 + alpha;
        Self {
            b0: ((1.0 - cos) / 2.0) / a0,
            b1: (1.0 - cos) / a0,
            b2: ((1.0 - cos) / 2.0) / a0,
            a1: (-2.0 * cos) / a0,
            a2: (1.0 - alpha) / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }
}

struct CombFilter {
    buffer: Vec<f32>,
    position: usize,
    feedback: f32,
}

impl CombFilter {
    fn new(length: usize, feedback: f32) -> Self {
        Self {
            buffer: vec![0.0; length.max(1)],
            position: 0,
            feedback,
        }
    }

    fn process(&mut self, input: f32) -> f32 {
        let delayed = self.buffer[self.position];
        self.buffer[self.position] = input + delayed * self.feedback;
        self.position = (self.position + 1) % self.buffer.len();
        delayed
    }
}

fn decode(path: &Path) -> Result<DecodedAudio> {
    let file = File::open(path).with_context(|| format!("无法读取音频：{}", path.display()))?;
    let stream = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .context("无法识别音频格式")?;
    let mut format = probed.format;
    let track = format.default_track().context("音频没有可解码轨道")?;
    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .context("音频缺少采样率信息")?;
    let channels = track
        .codec_params
        .channels
        .context("音频缺少声道信息")?
        .count();
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .context("无法建立音频解码器")?;
    let mut samples = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(error) => return Err(error).context("读取音频数据失败"),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let mut buffer =
                    SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
                buffer.copy_interleaved_ref(decoded);
                samples.extend_from_slice(buffer.samples());
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(error) => return Err(error).context("解码音频失败"),
        }
    }
    if samples.is_empty() {
        bail!("音频没有可处理的采样数据");
    }
    Ok(DecodedAudio {
        samples,
        sample_rate,
        channels,
    })
}

fn stereoize_mono(audio: &mut DecodedAudio, amount: f32) {
    if audio.channels != 1 {
        return;
    }
    let amount = amount.clamp(0.0, 1.0);
    let original = std::mem::take(&mut audio.samples);
    let micro_delay = (audio.sample_rate as f32 * (0.002 + amount * 0.006)) as usize;
    let left_reflection = (audio.sample_rate as f32 * 0.011) as usize;
    let right_reflection = (audio.sample_rate as f32 * 0.017) as usize;
    let mut stereo = Vec::with_capacity(original.len() * 2);
    for index in 0..original.len() {
        let direct = original[index];
        let delayed = original
            .get(index.saturating_sub(micro_delay))
            .copied()
            .unwrap_or(0.0);
        let left_early = original
            .get(index.saturating_sub(left_reflection))
            .copied()
            .unwrap_or(0.0);
        let right_early = original
            .get(index.saturating_sub(right_reflection))
            .copied()
            .unwrap_or(0.0);
        let left = direct + left_early * amount * 0.16;
        let right =
            direct * (1.0 - amount * 0.03) + delayed * amount * 0.08 + right_early * amount * 0.18;
        let mid = (left + right) * 0.5;
        let side = (left - right) * 0.5 * amount;
        stereo.push(mid + side);
        stereo.push(mid - side);
    }
    audio.samples = stereo;
    audio.channels = 2;
}

fn phase_correlation(audio: &DecodedAudio) -> f32 {
    if audio.channels < 2 {
        return 1.0;
    }
    let mut cross = 0.0f64;
    let mut left_energy = 0.0f64;
    let mut right_energy = 0.0f64;
    for frame in audio.samples.chunks_exact(audio.channels) {
        let left = frame[0] as f64;
        let right = frame[1] as f64;
        cross += left * right;
        left_energy += left * left;
        right_energy += right * right;
    }
    let denominator = (left_energy * right_energy).sqrt();
    if denominator <= f64::EPSILON {
        1.0
    } else {
        (cross / denominator).clamp(-1.0, 1.0) as f32
    }
}

fn reduce_side(audio: &mut DecodedAudio, factor: f32) {
    for frame in audio.samples.chunks_exact_mut(audio.channels) {
        let mid = (frame[0] + frame[1]) * 0.5;
        let side = (frame[0] - frame[1]) * 0.5 * factor;
        frame[0] = mid + side;
        frame[1] = mid - side;
    }
}

fn apply_stereo_field(audio: &mut DecodedAudio, settings: &SoundLabSettings) {
    if audio.channels < 2 {
        return;
    }
    let width = settings.stereo_width.clamp(0.0, 2.0);
    let width = if settings.mono_compatibility {
        width.min(1.6)
    } else {
        width
    };
    let center_scale = if settings.center_preserve {
        1.0
    } else {
        (2.0 - width).clamp(0.65, 1.0)
    };
    let cutoff = settings.mono_bass_hz.clamp(80.0, 250.0);
    let smoothing = 1.0 - (-2.0 * std::f32::consts::PI * cutoff / audio.sample_rate as f32).exp();
    let mut low_left = 0.0f32;
    let mut low_right = 0.0f32;
    for frame in audio.samples.chunks_exact_mut(audio.channels) {
        let left = frame[0];
        let right = frame[1];
        low_left += smoothing * (left - low_left);
        low_right += smoothing * (right - low_right);
        let (field_left, field_right) = if settings.mono_compatibility {
            let low_mid = (low_left + low_right) * 0.5;
            (low_mid + left - low_left, low_mid + right - low_right)
        } else {
            (left, right)
        };
        let mid = (field_left + field_right) * 0.5 * center_scale;
        let side = (field_left - field_right) * 0.5 * width;
        frame[0] = mid + side;
        frame[1] = mid - side;
    }
    if settings.mono_compatibility {
        for _ in 0..8 {
            if phase_correlation(audio) >= 0.05 {
                break;
            }
            reduce_side(audio, 0.76);
        }
        if phase_correlation(audio) < 0.05 {
            reduce_side(audio, 0.0);
        }
    }
}

fn space_profile(name: &str) -> ([f32; 4], f32) {
    match name {
        "bathroom" => ([0.018, 0.024, 0.031, 0.039], 0.72),
        "corridor" => ([0.041, 0.057, 0.071, 0.089], 0.76),
        "tunnel" => ([0.073, 0.097, 0.131, 0.167], 0.82),
        "parking" => ([0.051, 0.067, 0.083, 0.109], 0.79),
        "car" => ([0.009, 0.014, 0.019, 0.027], 0.64),
        "church" => ([0.089, 0.127, 0.173, 0.223], 0.88),
        "warehouse" => ([0.061, 0.079, 0.103, 0.137], 0.83),
        "small-room" => ([0.013, 0.019, 0.027, 0.034], 0.67),
        "valley" => ([0.137, 0.193, 0.251, 0.337], 0.86),
        "underwater" => ([0.024, 0.037, 0.053, 0.071], 0.78),
        "metal-container" => ([0.007, 0.011, 0.017, 0.023], 0.73),
        _ => ([0.0297, 0.0371, 0.0411, 0.0437], 0.66),
    }
}

fn occlusion_profile(name: &str) -> Option<(f32, f32)> {
    match name {
        "door" => Some((4_800.0, -4.0)),
        "wall" => Some((2_500.0, -8.0)),
        "two-walls" => Some((1_250.0, -14.0)),
        "upstairs" => Some((1_900.0, -10.0)),
        "downstairs" => Some((1_550.0, -11.0)),
        "outside-car" => Some((2_800.0, -8.0)),
        "helmet" => Some((1_350.0, -10.0)),
        _ => None,
    }
}

fn process(audio: &mut DecodedAudio, settings: &SoundLabSettings) {
    if settings.mono_stereoize {
        stereoize_mono(audio, settings.stereoize_amount);
    }
    let channels = audio.channels;
    let sample_rate = audio.sample_rate as f32;
    let mut low = vec![
        Biquad::peaking(
            sample_rate,
            160.0,
            0.72,
            settings.low_gain_db.clamp(-18.0, 18.0)
        );
        channels
    ];
    let mut mid = vec![
        Biquad::peaking(
            sample_rate,
            1_400.0,
            0.82,
            settings.mid_gain_db.clamp(-18.0, 18.0)
        );
        channels
    ];
    let mut high = vec![
        Biquad::peaking(
            sample_rate,
            6_500.0,
            0.72,
            settings.high_gain_db.clamp(-18.0, 18.0)
        );
        channels
    ];
    let distortion = settings.distortion.clamp(0.0, 1.0);
    let drive = 1.0 + distortion * 18.0;
    let drive_normalizer = drive.tanh().max(0.001);

    for frame in audio.samples.chunks_exact_mut(channels) {
        for channel in 0..channels {
            let mut sample = low[channel].process(frame[channel]);
            sample = mid[channel].process(sample);
            sample = high[channel].process(sample);
            if distortion > 0.001 {
                sample = (sample * drive).tanh() / drive_normalizer;
            }
            frame[channel] = sample;
        }
    }

    let delay_mix = settings.delay_mix.clamp(0.0, 1.0);
    if delay_mix > 0.001 {
        let delay_length =
            ((sample_rate * settings.delay_ms.clamp(30.0, 900.0) / 1000.0) as usize).max(1);
        let feedback = settings.delay_feedback.clamp(0.0, 0.88);
        let mut buffers = vec![vec![0.0f32; delay_length]; channels];
        let mut position = 0usize;
        for frame in audio.samples.chunks_exact_mut(channels) {
            for channel in 0..channels {
                let input = frame[channel];
                let delayed = buffers[channel][position];
                buffers[channel][position] = input + delayed * feedback;
                frame[channel] = input * (1.0 - delay_mix * 0.45) + delayed * delay_mix;
            }
            position = (position + 1) % delay_length;
        }
    }

    let reverb_mix = settings.reverb_mix.clamp(0.0, 1.0);
    if reverb_mix > 0.001 {
        let (lengths, profile_decay) = space_profile(&settings.space_preset);
        let decay = profile_decay + reverb_mix * (0.9 - profile_decay);
        let mut combs: Vec<Vec<CombFilter>> = (0..channels)
            .map(|channel| {
                lengths
                    .iter()
                    .enumerate()
                    .map(|(index, seconds)| {
                        let spread = 1.0 + channel as f32 * 0.011 + index as f32 * 0.003;
                        CombFilter::new((sample_rate * seconds * spread) as usize, decay)
                    })
                    .collect()
            })
            .collect();
        for frame in audio.samples.chunks_exact_mut(channels) {
            for channel in 0..channels {
                let input = frame[channel];
                let wet = combs[channel]
                    .iter_mut()
                    .map(|comb| comb.process(input))
                    .sum::<f32>()
                    / lengths.len() as f32;
                frame[channel] = input * (1.0 - reverb_mix * 0.55) + wet * reverb_mix;
            }
        }
    }

    apply_stereo_field(audio, settings);

    if let Some((cutoff, gain_db)) = occlusion_profile(&settings.occlusion_preset) {
        let mut filters = vec![Biquad::lowpass(sample_rate, cutoff, 0.707); channels];
        let attenuation = 10f32.powf(gain_db / 20.0);
        for frame in audio.samples.chunks_exact_mut(channels) {
            for channel in 0..channels {
                frame[channel] = filters[channel].process(frame[channel]) * attenuation;
            }
        }
    }

    let gain = 10f32.powf(settings.output_gain_db.clamp(-18.0, 12.0) / 20.0);
    let peak = audio
        .samples
        .iter_mut()
        .map(|sample| {
            *sample *= gain;
            sample.abs()
        })
        .fold(0.0f32, f32::max);
    let limiter = if peak > 0.98 { 0.98 / peak } else { 1.0 };
    for sample in &mut audio.samples {
        *sample = (*sample * limiter).clamp(-1.0, 1.0);
    }
}

pub fn export(
    input_path: &Path,
    output_path: &Path,
    settings: SoundLabSettings,
) -> Result<SoundLabExport> {
    let input = input_path.canonicalize().context("输入音频不存在")?;
    let output_parent = output_path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
        .canonicalize()
        .context("导出目录不存在或不可写")?;
    let output_name = output_path.file_name().context("导出文件名无效")?;
    let output = output_parent.join(output_name);
    if input == output {
        bail!("为保护母文件，声音实验室不能覆盖原始音频");
    }
    if output.extension().and_then(|value| value.to_str()) != Some("wav") {
        bail!("声音实验室当前只导出 WAV 文件");
    }

    let mut audio = decode(&input)?;
    process(&mut audio, &settings);
    let spec = hound::WavSpec {
        channels: audio.channels.try_into().context("声道数量超出 WAV 限制")?,
        sample_rate: audio.sample_rate,
        bits_per_sample: 24,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&output, spec).context("无法创建导出文件")?;
    for sample in &audio.samples {
        writer
            .write_sample((sample * 8_388_607.0).round() as i32)
            .context("写入导出音频失败")?;
    }
    writer.finalize().context("完成 WAV 导出失败")?;
    Ok(SoundLabExport {
        output_path: output.to_string_lossy().into_owned(),
        duration: audio.samples.len() as f64 / audio.channels as f64 / audio.sample_rate as f64,
        sample_rate: audio.sample_rate,
        channels: audio.channels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn settings() -> SoundLabSettings {
        SoundLabSettings {
            low_gain_db: 4.0,
            mid_gain_db: -2.0,
            high_gain_db: 3.0,
            reverb_mix: 0.2,
            delay_mix: 0.1,
            delay_ms: 120.0,
            delay_feedback: 0.25,
            distortion: 0.08,
            output_gain_db: -1.0,
            stereo_width: 1.0,
            mono_bass_hz: 120.0,
            center_preserve: true,
            mono_compatibility: true,
            mono_stereoize: true,
            stereoize_amount: 0.65,
            space_preset: "small-room".into(),
            occlusion_preset: "none".into(),
        }
    }

    #[test]
    fn exports_new_wav_without_modifying_source() {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir();
        let source = directory.join(format!("sound-island-lab-source-{suffix}.wav"));
        let output = directory.join(format!("sound-island-lab-output-{suffix}.wav"));
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&source, spec).unwrap();
        for index in 0..4_800 {
            let sample = ((index as f32 * 0.08).sin() * 12_000.0) as i16;
            writer.write_sample(sample).unwrap();
        }
        writer.finalize().unwrap();
        let source_before = std::fs::read(&source).unwrap();

        let result = export(&source, &output, settings()).unwrap();
        assert_eq!(result.sample_rate, 48_000);
        assert_eq!(result.channels, 2);
        assert!(output.exists());
        assert_eq!(std::fs::read(&source).unwrap(), source_before);
        assert_ne!(std::fs::read(&output).unwrap(), source_before);
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(output);
    }

    #[test]
    fn stereoizes_mono_with_phase_safe_difference() {
        let mut audio = DecodedAudio {
            samples: (0..4_800)
                .map(|index| (index as f32 * 0.07).sin())
                .collect(),
            sample_rate: 48_000,
            channels: 1,
        };
        stereoize_mono(&mut audio, 0.8);
        assert_eq!(audio.channels, 2);
        assert!(audio
            .samples
            .chunks_exact(2)
            .any(|frame| (frame[0] - frame[1]).abs() > 0.0001));
        assert!(phase_correlation(&audio) > 0.05);
    }

    #[test]
    fn compatibility_protection_collapses_unrecoverable_negative_phase() {
        let mut audio = DecodedAudio {
            samples: (0..4_800)
                .flat_map(|index| {
                    let sample = (index as f32 * 0.07).sin();
                    [sample, -sample]
                })
                .collect(),
            sample_rate: 48_000,
            channels: 2,
        };
        let mut protected = settings();
        protected.stereo_width = 2.0;
        apply_stereo_field(&mut audio, &protected);
        assert!(phase_correlation(&audio) >= 0.05);
    }

    #[test]
    fn exposes_every_requested_space_and_occlusion_profile() {
        for name in [
            "bathroom",
            "corridor",
            "tunnel",
            "parking",
            "car",
            "church",
            "warehouse",
            "small-room",
            "valley",
            "underwater",
            "metal-container",
        ] {
            assert_ne!(space_profile(name), space_profile("none"));
        }
        for name in [
            "door",
            "wall",
            "two-walls",
            "upstairs",
            "downstairs",
            "outside-car",
            "helmet",
        ] {
            assert!(occlusion_profile(name).is_some());
        }
    }

    #[test]
    fn refuses_to_overwrite_source() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
        let error = export(&path, &path, settings()).unwrap_err().to_string();
        assert!(error.contains("不能覆盖原始音频"));
    }
}
