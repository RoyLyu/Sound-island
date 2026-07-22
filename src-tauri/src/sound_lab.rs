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

fn process(audio: &mut DecodedAudio, settings: &SoundLabSettings) {
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
        let lengths = [0.0297f32, 0.0371, 0.0411, 0.0437];
        let decay = 0.66 + reverb_mix * 0.22;
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
        assert_eq!(result.channels, 1);
        assert!(output.exists());
        assert_eq!(std::fs::read(&source).unwrap(), source_before);
        assert_ne!(std::fs::read(&output).unwrap(), source_before);
        let _ = std::fs::remove_file(source);
        let _ = std::fs::remove_file(output);
    }

    #[test]
    fn refuses_to_overwrite_source() {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
        let error = export(&path, &path, settings()).unwrap_err().to_string();
        assert!(error.contains("不能覆盖原始音频"));
    }
}
