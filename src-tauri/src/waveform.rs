use anyhow::{Context, Result};
use std::{fs::File, path::Path};
use symphonia::core::{
    audio::SampleBuffer, codecs::DecoderOptions, formats::FormatOptions, io::MediaSourceStream,
    meta::MetadataOptions, probe::Hint,
};

pub fn peaks(path: &Path, requested_bins: usize) -> Result<Vec<f32>> {
    let file = File::open(path).context("无法读取音频文件")?;
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
        .context("无法解析音频格式")?;
    let mut format = probed.format;
    let track = format.default_track().context("音频没有可解码轨道")?;
    let track_id = track.id;
    let total_frames = track.codec_params.n_frames.unwrap_or_default() as usize;
    let channels = track
        .codec_params
        .channels
        .map(|value| value.count())
        .unwrap_or(1);
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .context("无法创建音频解码器")?;
    let bin_count = requested_bins.clamp(48, 512);
    let total_samples = total_frames.saturating_mul(channels);
    let mut output = vec![0.0_f32; bin_count];
    let mut sample_index = 0usize;

    while let Ok(packet) = format.next_packet() {
        if packet.track_id() != track_id {
            continue;
        }
        let Ok(decoded) = decoder.decode(&packet) else {
            continue;
        };
        let mut buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        buffer.copy_interleaved_ref(decoded);
        for sample in buffer.samples() {
            let bin = sample_index
                .saturating_mul(bin_count)
                .checked_div(total_samples)
                .unwrap_or(sample_index % bin_count);
            if bin < bin_count {
                output[bin] = output[bin].max(sample.abs());
            }
            sample_index += 1;
        }
    }

    let maximum = output.iter().copied().fold(0.0_f32, f32::max);
    if maximum > 0.0 {
        for value in &mut output {
            *value = (*value / maximum).sqrt();
        }
    }
    Ok(output)
}
