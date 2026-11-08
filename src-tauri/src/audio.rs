//! Decodes a user-supplied reference song into a 16-bit PCM WAV, the only
//! input format `audiocpp_cli --audio` accepts.

use std::fs::File;
use std::io::{BufWriter, ErrorKind};
use std::path::Path;

use anyhow::{anyhow, Context};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// Decodes `src` (any supported container/codec) into `dst` as 16-bit PCM,
/// keeping the source sample rate and at most two channels. Returns the
/// duration in seconds.
pub fn decode_to_wav(src: &Path, dst: &Path) -> anyhow::Result<f64> {
    let file = File::open(src).with_context(|| format!("cannot open {}", src.display()))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = src.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| anyhow!("unsupported or unreadable audio file ({e})"))?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| anyhow!("no audio track found"))?;
    let track_id = track.id;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| anyhow!("unsupported audio codec ({e})"))?;

    let mut writer: Option<hound::WavWriter<BufWriter<File>>> = None;
    let mut samples: Option<SampleBuffer<i16>> = None;
    let mut channels_in = 0usize;
    let mut rate = 0u32;
    let mut frames = 0u64;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymError::IoError(e)) if e.kind() == ErrorKind::UnexpectedEof => break,
            Err(SymError::ResetRequired) => break,
            Err(e) => return Err(anyhow!("read error ({e})")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            // A corrupt frame is skipped; the rest of the song is still usable.
            Err(SymError::DecodeError(_)) => continue,
            Err(e) => return Err(anyhow!("decode error ({e})")),
        };
        let spec = *decoded.spec();
        if writer.is_none() {
            channels_in = spec.channels.count();
            rate = spec.rate;
            writer = Some(hound::WavWriter::create(
                dst,
                hound::WavSpec {
                    channels: channels_in.clamp(1, 2) as u16,
                    sample_rate: rate,
                    bits_per_sample: 16,
                    sample_format: hound::SampleFormat::Int,
                },
            )?);
        }
        let needed = decoded.capacity() * channels_in;
        if samples.as_ref().map_or(true, |s| s.capacity() < needed) {
            samples = Some(SampleBuffer::new(decoded.capacity() as u64, spec));
        }
        let buf = samples.as_mut().unwrap();
        buf.copy_interleaved_ref(decoded);
        let w = writer.as_mut().unwrap();
        if channels_in <= 2 {
            for s in buf.samples() {
                w.write_sample(*s)?;
            }
            frames += (buf.samples().len() / channels_in.max(1)) as u64;
        } else {
            // Surround sources: keep front left/right.
            for frame in buf.samples().chunks_exact(channels_in) {
                w.write_sample(frame[0])?;
                w.write_sample(frame[1])?;
                frames += 1;
            }
        }
    }
    let writer = writer.ok_or_else(|| anyhow!("the file contains no decodable audio"))?;
    writer.finalize()?;
    if rate == 0 || frames == 0 {
        return Err(anyhow!("the file contains no decodable audio"));
    }
    Ok(frames as f64 / rate as f64)
}

#[cfg(test)]
mod tests {
    use super::decode_to_wav;

    fn tone_wav(path: &std::path::Path, rate: u32, channels: u16, secs: u32) {
        let mut w = hound::WavWriter::create(
            path,
            hound::WavSpec { channels, sample_rate: rate, bits_per_sample: 24, sample_format: hound::SampleFormat::Int },
        )
        .unwrap();
        for i in 0..rate * secs {
            let v = ((i as f32 * 0.05).sin() * 4_000_000.0) as i32;
            for _ in 0..channels {
                w.write_sample(v).unwrap();
            }
        }
        w.finalize().unwrap();
    }

    #[test]
    fn wav_is_normalised_to_16_bit_with_exact_duration() {
        let dir = std::env::temp_dir().join(format!("songhearth-audio-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (src, dst) = (dir.join("in.wav"), dir.join("out.wav"));
        tone_wav(&src, 44_100, 2, 3);
        let secs = decode_to_wav(&src, &dst).unwrap();
        assert!((secs - 3.0).abs() < 0.01, "duration {secs}");
        let spec = hound::WavReader::open(&dst).unwrap().spec();
        assert_eq!((spec.bits_per_sample, spec.channels, spec.sample_rate), (16, 2, 44_100));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn non_audio_file_is_rejected() {
        let dir = std::env::temp_dir().join(format!("songhearth-audio-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("notes.mp3");
        std::fs::write(&src, b"definitely not audio").unwrap();
        assert!(decode_to_wav(&src, &dir.join("out.wav")).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
