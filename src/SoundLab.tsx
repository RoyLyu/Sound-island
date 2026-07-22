import { useCallback, useEffect, useRef, useState } from "react";
import { audioSource, exportSoundLabAudio, revealSound } from "./backend";
import type { Sound, SoundLabExport, SoundLabSettings } from "./types";

type Props = {
  sound: Sound;
  peaks: number[];
  onClose: () => void;
  onNotice: (message: string) => void;
};

type Comparison = "processed" | "original";

const presets: Array<{ name: string; description: string; settings: SoundLabSettings }> = [
  {
    name: "纯净增强",
    description: "轻微提亮并控制峰值",
    settings: { preset: "clean", lowGainDb: 1.5, midGainDb: 0, highGainDb: 2.5, reverbMix: 0, delayMix: 0, delayMs: 140, delayFeedback: 0.2, distortion: 0, outputGainDb: -0.5 },
  },
  {
    name: "电影冲击",
    description: "低频重量与瞬态饱和",
    settings: { preset: "cinematic", lowGainDb: 7, midGainDb: -2, highGainDb: 2, reverbMix: 0.16, delayMix: 0.04, delayMs: 95, delayFeedback: 0.15, distortion: 0.18, outputGainDb: -1.5 },
  },
  {
    name: "深空混响",
    description: "宽阔尾音与远距空间",
    settings: { preset: "deep-space", lowGainDb: 2, midGainDb: -3, highGainDb: 4, reverbMix: 0.72, delayMix: 0.2, delayMs: 380, delayFeedback: 0.46, distortion: 0.03, outputGainDb: -2 },
  },
  {
    name: "老式电话",
    description: "窄频、中频突出、轻失真",
    settings: { preset: "telephone", lowGainDb: -15, midGainDb: 10, highGainDb: -14, reverbMix: 0.03, delayMix: 0, delayMs: 90, delayFeedback: 0, distortion: 0.24, outputGainDb: -3 },
  },
  {
    name: "机械故障",
    description: "短延迟与颗粒化饱和",
    settings: { preset: "malfunction", lowGainDb: 3, midGainDb: 5, highGainDb: 6, reverbMix: 0.12, delayMix: 0.38, delayMs: 74, delayFeedback: 0.58, distortion: 0.48, outputGainDb: -4 },
  },
];

const defaultSettings = presets[0].settings;

function distortionCurve(amount: number) {
  if (amount <= 0.001) return null;
  const samples = 2048;
  const curve = new Float32Array(samples);
  const drive = 1 + amount * 18;
  const normalizer = Math.tanh(drive) || 1;
  for (let index = 0; index < samples; index += 1) {
    const value = index * 2 / (samples - 1) - 1;
    curve[index] = Math.tanh(value * drive) / normalizer;
  }
  return curve;
}

function impulse(context: AudioContext, mix: number) {
  const duration = 0.7 + mix * 2.8;
  const buffer = context.createBuffer(2, Math.floor(context.sampleRate * duration), context.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const decay = (1 - index / data.length) ** (2.4 - mix * 1.2);
      data[index] = (Math.random() * 2 - 1) * decay;
    }
  }
  return buffer;
}

function peaksFromBuffer(buffer: AudioBuffer, binCount = 160) {
  const output = Array.from({ length: binCount }, () => 0);
  for (let bin = 0; bin < binCount; bin += 1) {
    const start = Math.floor(bin * buffer.length / binCount);
    const end = Math.max(start + 1, Math.floor((bin + 1) * buffer.length / binCount));
    const stride = Math.max(1, Math.floor((end - start) / 48));
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let index = start; index < end; index += stride) output[bin] = Math.max(output[bin], Math.abs(samples[index] ?? 0));
    }
  }
  const maximum = Math.max(...output, 0.001);
  return output.map((value) => Math.sqrt(value / maximum));
}

function connectProcessedGraph(context: AudioContext, source: AudioBufferSourceNode, settings: SoundLabSettings) {
  const low = context.createBiquadFilter();
  low.type = "peaking";
  low.frequency.value = 160;
  low.Q.value = 0.72;
  low.gain.value = settings.lowGainDb;
  const mid = context.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = 1400;
  mid.Q.value = 0.82;
  mid.gain.value = settings.midGainDb;
  const high = context.createBiquadFilter();
  high.type = "peaking";
  high.frequency.value = 6500;
  high.Q.value = 0.72;
  high.gain.value = settings.highGainDb;
  const shaper = context.createWaveShaper();
  shaper.curve = distortionCurve(settings.distortion);
  shaper.oversample = "4x";
  const master = context.createGain();
  master.gain.value = 10 ** (settings.outputGainDb / 20);
  const dry = context.createGain();
  dry.gain.value = 1 - Math.max(settings.reverbMix, settings.delayMix) * 0.34;

  source.connect(low).connect(mid).connect(high).connect(shaper);
  shaper.connect(dry).connect(master);
  if (settings.delayMix > 0.001) {
    const delay = context.createDelay(1);
    delay.delayTime.value = settings.delayMs / 1000;
    const feedback = context.createGain();
    feedback.gain.value = settings.delayFeedback;
    const wet = context.createGain();
    wet.gain.value = settings.delayMix;
    shaper.connect(delay).connect(feedback).connect(delay);
    delay.connect(wet).connect(master);
  }
  if (settings.reverbMix > 0.001) {
    const convolver = context.createConvolver();
    convolver.buffer = impulse(context, settings.reverbMix);
    const wet = context.createGain();
    wet.gain.value = settings.reverbMix;
    shaper.connect(convolver).connect(wet).connect(master);
  }
  master.connect(context.destination);
}

function Slider({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: number) => void }) {
  return <label className="lab-slider"><span><b>{label}</b><em>{value > 0 && min < 0 ? "+" : ""}{value}{suffix}</em></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))}/></label>;
}

export function SoundLab({ sound, peaks, onClose, onNotice }: Props) {
  const [settings, setSettings] = useState<SoundLabSettings>(defaultSettings);
  const [comparison, setComparison] = useState<Comparison>("processed");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [decodedPeaks, setDecodedPeaks] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<SoundLabExport | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const startOffsetRef = useRef(0);
  const progressRef = useRef(0);
  const settingsRef = useRef(settings);
  const comparisonRef = useRef(comparison);

  settingsRef.current = settings;
  comparisonRef.current = comparison;
  progressRef.current = progress;

  const stopSource = useCallback((reset = false) => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    const source = sourceRef.current;
    sourceRef.current = null;
    if (source) {
      source.onended = null;
      try { source.stop(); } catch { /* source may already be stopped */ }
      source.disconnect();
    }
    setPlaying(false);
    if (reset) setProgress(0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    stopSource(true);
    setLoading(true);
    setLoadError("");
    setDecodedPeaks([]);
    setExported(null);
    const context = new AudioContext();
    contextRef.current = context;
    void fetch(audioSource(sound.path))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => context.decodeAudioData(data))
      .then((buffer) => {
        if (!cancelled) {
          bufferRef.current = buffer;
          setDecodedPeaks(peaksFromBuffer(buffer));
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message = `源文件当前不可读取：${String(error)}`;
          setLoadError(message);
          onNotice(`声音实验室无法载入试听：${String(error)}`);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      stopSource();
      bufferRef.current = null;
      void context.close();
      if (contextRef.current === context) contextRef.current = null;
    };
  }, [onNotice, sound.path, stopSource]);

  const startAudition = useCallback(async (mode = comparisonRef.current, offsetRatio = progressRef.current) => {
    const context = contextRef.current;
    const buffer = bufferRef.current;
    if (!context || !buffer) return;
    stopSource();
    await context.resume();
    const offset = Math.min(buffer.duration - 0.001, Math.max(0, offsetRatio * buffer.duration));
    const source = context.createBufferSource();
    source.buffer = buffer;
    if (mode === "original") source.connect(context.destination);
    else connectProcessedGraph(context, source, settingsRef.current);
    sourceRef.current = source;
    startOffsetRef.current = offset;
    startedAtRef.current = context.currentTime;
    source.onended = () => {
      if (sourceRef.current !== source) return;
      sourceRef.current = null;
      setPlaying(false);
      setProgress(0);
    };
    source.start(0, offset);
    setPlaying(true);
    const tick = () => {
      if (sourceRef.current !== source) return;
      const next = Math.min(1, (startOffsetRef.current + context.currentTime - startedAtRef.current) / buffer.duration);
      setProgress(next);
      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
  }, [stopSource]);

  const toggleAudition = useCallback(() => {
    if (playing) stopSource();
    else void startAudition();
  }, [playing, startAudition, stopSource]);

  const switchComparison = (next: Comparison) => {
    if (next === comparisonRef.current) return;
    const wasPlaying = playing;
    const at = progressRef.current;
    setComparison(next);
    comparisonRef.current = next;
    if (wasPlaying) void startAudition(next, at);
  };

  const applyPreset = (preset: typeof presets[number]) => {
    settingsRef.current = preset.settings;
    setSettings(preset.settings);
    if (playing && comparisonRef.current === "processed") void startAudition("processed", progressRef.current);
  };

  const update = <Key extends keyof SoundLabSettings>(key: Key, value: SoundLabSettings[Key]) => {
    const next = { ...settingsRef.current, preset: "custom", [key]: value };
    settingsRef.current = next;
    setSettings(next);
  };

  const exportAudio = async () => {
    setExporting(true);
    try {
      const result = await exportSoundLabAudio(sound.path, settingsRef.current);
      if (result) {
        setExported(result);
        onNotice("处理完成：已导出新的 24-bit WAV，母文件保持不变");
      }
    } catch (error) {
      onNotice(`导出失败：${String(error)}`);
    } finally {
      setExporting(false);
    }
  };

  const closeRef = useRef(onClose);
  const toggleAuditionRef = useRef(toggleAudition);
  closeRef.current = onClose;
  toggleAuditionRef.current = toggleAudition;

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
      if (event.code === "Space" && !(event.target instanceof HTMLInputElement)) {
        event.preventDefault();
        toggleAuditionRef.current();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const waveformPeaks = peaks.length ? peaks : decodedPeaks;
  const visiblePeaks = waveformPeaks.filter((_, index) => index % Math.max(1, Math.floor(waveformPeaks.length / 96)) === 0).slice(0, 96);
  return <div className="sound-lab-overlay" role="dialog" aria-modal="true" aria-label="声音实验室">
    <section className="sound-lab-panel">
      <header className="lab-header"><div><span>SONIC WORKBENCH · LOCAL DSP</span><strong>声音实验室</strong><p>{sound.displayName || sound.name}</p></div><div className="lab-header-actions"><em>全程本地 · 母文件只读</em><button onClick={onClose} aria-label="关闭声音实验室">×</button></div></header>
      <div className="lab-body">
        <aside className="lab-presets"><label>一键声音方案</label>{presets.map((preset) => <button key={preset.settings.preset} aria-pressed={settings.preset === preset.settings.preset} className={settings.preset === preset.settings.preset ? "active" : ""} onClick={() => applyPreset(preset)}><i/><span><strong>{preset.name}</strong><small>{preset.description}</small></span></button>)}<div className="lab-safety"><b>非破坏式流程</b><p>试听使用实时处理；导出始终创建新的 WAV，不写回原音频。</p></div></aside>
        <main className="lab-console">
          <div className="lab-visual"><div className={`lab-orb ${playing ? "active" : ""}`}><i/><i/><i/></div><div className="lab-wave">{visiblePeaks.length ? visiblePeaks.map((peak, index) => <i key={index} className={index / visiblePeaks.length <= progress ? "played" : ""} style={{ height: `${Math.max(7, peak * 88)}%` }}/>) : <span>{loading ? "正在解析音频…" : loadError || "暂无波形"}</span>}</div><div className="lab-progress"><i style={{ width: `${progress * 100}%` }}/></div></div>
          <div className="lab-transport"><button className="lab-play" disabled={loading || !!loadError} onClick={toggleAudition}>{playing ? "Ⅱ 暂停" : "▶ 试听"}</button><div className="ab-switch" aria-label="处理前后对比"><button aria-pressed={comparison === "original"} className={comparison === "original" ? "active" : ""} onClick={() => switchComparison("original")}>A 原声</button><button aria-pressed={comparison === "processed"} className={comparison === "processed" ? "active" : ""} onClick={() => switchComparison("processed")}>B 处理后</button></div><button className="apply-preview" disabled={loading || !!loadError} onClick={() => void startAudition("processed", progressRef.current)}>应用并试听</button><span>{Math.round(progress * (sound.duration || 0) * 100) / 100}s / {Math.round((sound.duration || 0) * 100) / 100}s</span></div>
          <div className="lab-modules">
            <section><header><span>EQ</span><strong>三段均衡</strong></header><Slider label="低频 160 Hz" value={settings.lowGainDb} min={-18} max={18} step={0.5} suffix=" dB" onChange={(value) => update("lowGainDb", value)}/><Slider label="中频 1.4 kHz" value={settings.midGainDb} min={-18} max={18} step={0.5} suffix=" dB" onChange={(value) => update("midGainDb", value)}/><Slider label="高频 6.5 kHz" value={settings.highGainDb} min={-18} max={18} step={0.5} suffix=" dB" onChange={(value) => update("highGainDb", value)}/></section>
            <section><header><span>SPACE</span><strong>空间与延迟</strong></header><Slider label="混响量" value={settings.reverbMix} min={0} max={1} step={0.01} suffix="" onChange={(value) => update("reverbMix", value)}/><Slider label="延迟量" value={settings.delayMix} min={0} max={1} step={0.01} suffix="" onChange={(value) => update("delayMix", value)}/><Slider label="延迟时间" value={settings.delayMs} min={30} max={900} step={1} suffix=" ms" onChange={(value) => update("delayMs", value)}/><Slider label="反馈" value={settings.delayFeedback} min={0} max={0.88} step={0.01} suffix="" onChange={(value) => update("delayFeedback", value)}/></section>
            <section><header><span>CHARACTER</span><strong>质感与输出</strong></header><Slider label="失真驱动" value={settings.distortion} min={0} max={1} step={0.01} suffix="" onChange={(value) => update("distortion", value)}/><Slider label="输出增益" value={settings.outputGainDb} min={-18} max={12} step={0.5} suffix=" dB" onChange={(value) => update("outputGainDb", value)}/><div className="lab-meter"><span/><span/><span/><span/><span/><span/><span/><span/></div><p>导出阶段自动限制峰值，避免数字削波。</p></section>
          </div>
        </main>
      </div>
      <footer className="lab-footer"><div>{exported ? <><span>已导出</span><strong title={exported.outputPath}>{exported.outputPath}</strong><button onClick={() => void revealSound(exported.outputPath)}>在文件夹中显示</button></> : <><span>导出规格</span><strong>WAV · 24 bit · 保持原采样率与声道</strong></>}</div><button className="export-button" disabled={exporting} onClick={() => void exportAudio()}>{exporting ? "正在本地处理…" : "导出处理后的新文件"}</button></footer>
    </section>
  </div>;
}
