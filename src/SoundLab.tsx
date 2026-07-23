import { useCallback, useEffect, useRef, useState } from "react";
import { audioSource, exportSoundLabAudio, revealSound } from "./backend";
import type { Sound, SoundLabExport, SoundLabSettings } from "./types";
import { Spectrum } from "./Spectrum";

type Props = {
  sound: Sound;
  onClose: () => void;
  onNotice: (message: string) => void;
};

type Comparison = "processed" | "original";

const spatialDefaults = {
  stereoWidth: 1,
  monoBassHz: 120,
  centerPreserve: true,
  monoCompatibility: true,
  monoStereoize: false,
  stereoizeAmount: 0.6,
  spacePreset: "none",
  occlusionPreset: "none",
};

const spaceOptions = [
  ["none", "关闭", 0, 140, 0.2],
  ["bathroom", "浴室", 0.42, 52, 0.34],
  ["corridor", "走廊", 0.48, 96, 0.4],
  ["tunnel", "隧道", 0.62, 220, 0.56],
  ["parking", "地下停车场", 0.56, 145, 0.47],
  ["car", "汽车内部", 0.3, 38, 0.24],
  ["church", "教堂", 0.78, 420, 0.62],
  ["warehouse", "大型仓库", 0.64, 240, 0.52],
  ["small-room", "小房间", 0.31, 44, 0.28],
  ["valley", "山谷", 0.72, 610, 0.68],
  ["underwater", "水下空间", 0.58, 180, 0.46],
  ["metal-container", "金属容器内部", 0.5, 68, 0.42],
] as const;

const occlusionOptions = [
  ["none", "无遮挡"], ["door", "隔一扇门"], ["wall", "隔一道墙"],
  ["two-walls", "隔两层墙"], ["upstairs", "楼上传来"], ["downstairs", "楼下传来"],
  ["outside-car", "汽车外传入"], ["helmet", "戴着头盔听见"],
] as const;

const presets: Array<{ name: string; description: string; settings: SoundLabSettings }> = [
  {
    name: "纯净增强",
    description: "轻微提亮并控制峰值",
    settings: { ...spatialDefaults, preset: "clean", lowGainDb: 1.5, midGainDb: 0, highGainDb: 2.5, reverbMix: 0, delayMix: 0, delayMs: 140, delayFeedback: 0.2, distortion: 0, outputGainDb: -0.5 },
  },
  {
    name: "电影冲击",
    description: "低频重量与瞬态饱和",
    settings: { ...spatialDefaults, stereoWidth: 1.28, preset: "cinematic", lowGainDb: 7, midGainDb: -2, highGainDb: 2, reverbMix: 0.16, delayMix: 0.04, delayMs: 95, delayFeedback: 0.15, distortion: 0.18, outputGainDb: -1.5 },
  },
  {
    name: "深空混响",
    description: "宽阔尾音与远距空间",
    settings: { ...spatialDefaults, stereoWidth: 1.55, spacePreset: "church", preset: "deep-space", lowGainDb: 2, midGainDb: -3, highGainDb: 4, reverbMix: 0.72, delayMix: 0.2, delayMs: 380, delayFeedback: 0.46, distortion: 0.03, outputGainDb: -2 },
  },
  {
    name: "老式电话",
    description: "窄频、中频突出、轻失真",
    settings: { ...spatialDefaults, stereoWidth: 0.35, monoCompatibility: true, preset: "telephone", lowGainDb: -15, midGainDb: 10, highGainDb: -14, reverbMix: 0.03, delayMix: 0, delayMs: 90, delayFeedback: 0, distortion: 0.24, outputGainDb: -3 },
  },
  {
    name: "机械故障",
    description: "短延迟与颗粒化饱和",
    settings: { ...spatialDefaults, stereoWidth: 1.38, preset: "malfunction", lowGainDb: 3, midGainDb: 5, highGainDb: 6, reverbMix: 0.12, delayMix: 0.38, delayMs: 74, delayFeedback: 0.58, distortion: 0.48, outputGainDb: -4 },
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

function impulse(context: AudioContext, mix: number, spacePreset: string) {
  const durations: Record<string, number> = { bathroom: 1.1, corridor: 1.7, tunnel: 2.8, parking: 2.3, car: 0.65, church: 4.4, warehouse: 3.1, "small-room": 0.82, valley: 4.8, underwater: 2.2, "metal-container": 1.35 };
  const duration = durations[spacePreset] ?? 0.7 + mix * 2.8;
  const buffer = context.createBuffer(2, Math.floor(context.sampleRate * duration), context.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const decay = (1 - index / data.length) ** (2.5 - mix * 1.25);
      const metallic = spacePreset === "metal-container" ? Math.sin(index * 0.23) * 0.45 : 1;
      data[index] = (Math.random() * 2 - 1) * decay * metallic;
    }
  }
  return buffer;
}

type AnalysisGraph = { spectrum: AnalyserNode; left: AnalyserNode; right: AnalyserNode };

function connectAnalysis(context: AudioContext, input: AudioNode): AnalysisGraph {
  const spectrum = context.createAnalyser();
  spectrum.fftSize = 8192;
  spectrum.minDecibels = -100;
  spectrum.maxDecibels = -10;
  spectrum.smoothingTimeConstant = 0.72;
  const splitter = context.createChannelSplitter(2);
  const left = context.createAnalyser();
  const right = context.createAnalyser();
  left.fftSize = 256;
  right.fftSize = 256;
  const silent = context.createGain();
  silent.gain.value = 0;
  input.connect(spectrum);
  spectrum.connect(context.destination);
  spectrum.connect(splitter);
  splitter.connect(left, 0);
  splitter.connect(right, 1);
  left.connect(silent);
  right.connect(silent);
  silent.connect(context.destination);
  return { spectrum, left, right };
}

function stereoizeMono(context: AudioContext, input: AudioNode, amount: number) {
  const safeAmount = Math.min(0.72, Math.max(0, amount));
  const merger = context.createChannelMerger(2);
  const left = context.createGain();
  const rightDelay = context.createDelay(0.03);
  const right = context.createGain();
  left.gain.value = 0.94;
  rightDelay.delayTime.value = 0.002 + safeAmount * 0.006;
  right.gain.value = 0.94;
  input.connect(left).connect(merger, 0, 0);
  input.connect(rightDelay).connect(right).connect(merger, 0, 1);
  const leftReflection = context.createDelay(0.04);
  const rightReflection = context.createDelay(0.04);
  const leftReflectionGain = context.createGain();
  const rightReflectionGain = context.createGain();
  leftReflection.delayTime.value = 0.011;
  rightReflection.delayTime.value = 0.017;
  leftReflectionGain.gain.value = safeAmount * 0.16;
  rightReflectionGain.gain.value = safeAmount * 0.18;
  input.connect(leftReflection).connect(leftReflectionGain).connect(merger, 0, 0);
  input.connect(rightReflection).connect(rightReflectionGain).connect(merger, 0, 1);
  return merger;
}

function stereoField(context: AudioContext, input: AudioNode, settings: SoundLabSettings) {
  const splitter = context.createChannelSplitter(2);
  const leftChannel = context.createGain();
  const rightChannel = context.createGain();
  input.connect(splitter);
  splitter.connect(leftChannel, 0);
  splitter.connect(rightChannel, 1);
  const merger = context.createChannelMerger(2);
  let leftSource: AudioNode = leftChannel;
  let rightSource: AudioNode = rightChannel;

  if (settings.monoCompatibility) {
    const cutoff = Math.min(250, Math.max(80, settings.monoBassHz));
    const leftLow = context.createBiquadFilter();
    const rightLow = context.createBiquadFilter();
    const leftHigh = context.createBiquadFilter();
    const rightHigh = context.createBiquadFilter();
    for (const filter of [leftLow, rightLow]) { filter.type = "lowpass"; filter.frequency.value = cutoff; filter.Q.value = 0.707; }
    for (const filter of [leftHigh, rightHigh]) { filter.type = "highpass"; filter.frequency.value = cutoff; filter.Q.value = 0.707; }
    leftChannel.connect(leftLow);
    rightChannel.connect(rightLow);
    leftChannel.connect(leftHigh);
    rightChannel.connect(rightHigh);
    for (const low of [leftLow, rightLow]) {
      const toLeft = context.createGain();
      const toRight = context.createGain();
      toLeft.gain.value = 0.5;
      toRight.gain.value = 0.5;
      low.connect(toLeft).connect(merger, 0, 0);
      low.connect(toRight).connect(merger, 0, 1);
    }
    leftSource = leftHigh;
    rightSource = rightHigh;
  }

  const width = Math.min(settings.monoCompatibility ? 1.6 : 2, Math.max(0, settings.stereoWidth));
  const center = settings.centerPreserve ? 1 : Math.min(1, Math.max(0.65, 2 - width));
  const direct = (center + width) * 0.5;
  const cross = (center - width) * 0.5;
  const routes: Array<[AudioNode, number, number]> = [
    [leftSource, direct, 0], [rightSource, cross, 0],
    [leftSource, cross, 1], [rightSource, direct, 1],
  ];
  for (const [routeSource, gainValue, channel] of routes) {
    const gain = context.createGain();
    gain.gain.value = gainValue;
    routeSource.connect(gain).connect(merger, 0, channel);
  }
  return merger;
}

function occlusion(context: AudioContext, input: AudioNode, preset: string) {
  const profiles: Record<string, [number, number]> = {
    door: [4800, -4], wall: [2500, -8], "two-walls": [1250, -14], upstairs: [1900, -10],
    downstairs: [1550, -11], "outside-car": [2800, -8], helmet: [1350, -10],
  };
  const profile = profiles[preset];
  if (!profile) return input;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = profile[0];
  filter.Q.value = 0.707;
  const gain = context.createGain();
  gain.gain.value = 10 ** (profile[1] / 20);
  input.connect(filter).connect(gain);
  return gain;
}

function connectProcessedGraph(context: AudioContext, source: AudioBufferSourceNode, settings: SoundLabSettings, sourceChannels: number) {
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
  let fieldInput: AudioNode = shaper;
  if (sourceChannels === 1 && settings.monoStereoize) fieldInput = stereoizeMono(context, shaper, settings.stereoizeAmount);
  if (sourceChannels >= 2 || settings.monoStereoize) fieldInput = stereoField(context, fieldInput, settings);
  fieldInput.connect(dry).connect(master);
  if (settings.delayMix > 0.001) {
    const delay = context.createDelay(1);
    delay.delayTime.value = settings.delayMs / 1000;
    const feedback = context.createGain();
    feedback.gain.value = settings.delayFeedback;
    const wet = context.createGain();
    wet.gain.value = settings.delayMix;
    fieldInput.connect(delay).connect(feedback).connect(delay);
    delay.connect(wet).connect(master);
  }
  if (settings.reverbMix > 0.001) {
    const convolver = context.createConvolver();
    convolver.buffer = impulse(context, settings.reverbMix, settings.spacePreset);
    const wet = context.createGain();
    wet.gain.value = settings.reverbMix;
    fieldInput.connect(convolver).connect(wet).connect(master);
  }
  return connectAnalysis(context, occlusion(context, master, settings.occlusionPreset));
}

function Slider({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: number) => void }) {
  return <label className="lab-slider"><span><b>{label}</b><em>{value > 0 && min < 0 ? "+" : ""}{value}{suffix}</em></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))}/></label>;
}

export function SoundLab({ sound, onClose, onNotice }: Props) {
  const [settings, setSettings] = useState<SoundLabSettings>(defaultSettings);
  const [comparison, setComparison] = useState<Comparison>("processed");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<SoundLabExport | null>(null);
  const [phaseCorrelation, setPhaseCorrelation] = useState(1);
  const [labAnalyser, setLabAnalyser] = useState<AnalyserNode | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const startOffsetRef = useRef(0);
  const progressRef = useRef(0);
  const settingsRef = useRef(settings);
  const comparisonRef = useRef(comparison);
  const analysisRef = useRef<AnalysisGraph | null>(null);
  const correlationFrameRef = useRef(0);

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
    analysisRef.current = null;
    setLabAnalyser(null);
    if (reset) setProgress(0);
  }, []);

  useEffect(() => {
    let cancelled = false;
    stopSource(true);
    setLoading(true);
    setLoadError("");
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
    const analysis = mode === "original"
      ? connectAnalysis(context, source)
      : connectProcessedGraph(context, source, settingsRef.current, buffer.numberOfChannels);
    analysisRef.current = analysis;
    setLabAnalyser(analysis.spectrum);
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
      correlationFrameRef.current += 1;
      if (correlationFrameRef.current % 6 === 0) {
        if (buffer.numberOfChannels === 1 && (mode === "original" || !settingsRef.current.monoStereoize)) {
          setPhaseCorrelation(1);
        } else if (analysisRef.current) {
          const left = new Float32Array(analysisRef.current.left.fftSize);
          const right = new Float32Array(analysisRef.current.right.fftSize);
          analysisRef.current.left.getFloatTimeDomainData(left);
          analysisRef.current.right.getFloatTimeDomainData(right);
          let cross = 0;
          let leftEnergy = 0;
          let rightEnergy = 0;
          for (let index = 0; index < left.length; index += 1) {
            cross += left[index] * right[index];
            leftEnergy += left[index] ** 2;
            rightEnergy += right[index] ** 2;
          }
          const denominator = Math.sqrt(leftEnergy * rightEnergy);
          setPhaseCorrelation(denominator > 0.000001 ? Math.max(-1, Math.min(1, cross / denominator)) : 1);
        }
      }
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
    if (playing && comparisonRef.current === "processed") void startAudition("processed", progressRef.current);
  };

  const applySpace = (option: typeof spaceOptions[number]) => {
    const [spacePreset, , reverbMix, delayMs, delayFeedback] = option;
    const next = { ...settingsRef.current, preset: "custom", spacePreset, reverbMix, delayMs, delayFeedback, delayMix: spacePreset === "none" ? 0 : Math.min(0.18, reverbMix * 0.22) };
    settingsRef.current = next;
    setSettings(next);
    if (playing && comparisonRef.current === "processed") void startAudition("processed", progressRef.current);
  };

  const applyOcclusion = (occlusionPreset: string) => {
    const next = { ...settingsRef.current, preset: "custom", occlusionPreset };
    settingsRef.current = next;
    setSettings(next);
    if (playing && comparisonRef.current === "processed") void startAudition("processed", progressRef.current);
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

  const outputChannels = sound.channels === 1 && settings.monoStereoize ? "输出 Stereo" : "保持原声道";
  return <div className="sound-lab-overlay" role="dialog" aria-modal="true" aria-label="声音实验室">
    <section className="sound-lab-panel">
      <header className="lab-header"><div><span>SONIC WORKBENCH · LOCAL DSP</span><strong>声音实验室</strong><p>{sound.displayName || sound.name}</p></div><div className="lab-header-actions"><em>全程本地 · 母文件只读</em><button onClick={onClose} aria-label="关闭声音实验室">×</button></div></header>
      <div className="lab-body">
        <aside className="lab-presets">
          <label>一键声音方案</label>
          {presets.map((preset) => <button key={preset.settings.preset} aria-pressed={settings.preset === preset.settings.preset} className={settings.preset === preset.settings.preset ? "active" : ""} onClick={() => applyPreset(preset)}><i/><span><strong>{preset.name}</strong><small>{preset.description}</small></span></button>)}
          <label className="lab-tools-label">空间与声场工具</label>
          <details className="lab-tool" open>
            <summary><span>STEREO FIELD</span><strong>立体声拓宽</strong></summary>
            <Slider label="宽度" value={Math.round(settings.stereoWidth * 100)} min={0} max={200} step={1} suffix="%" onChange={(value) => update("stereoWidth", value / 100)}/>
            <Slider label="低频单声道保护" value={settings.monoBassHz} min={80} max={250} step={1} suffix=" Hz" onChange={(value) => update("monoBassHz", value)}/>
            <div className="lab-switches"><button aria-pressed={settings.centerPreserve} className={settings.centerPreserve ? "active" : ""} onClick={() => update("centerPreserve", !settings.centerPreserve)}>中置信号保持</button><button aria-pressed={settings.monoCompatibility} className={settings.monoCompatibility ? "active" : ""} onClick={() => update("monoCompatibility", !settings.monoCompatibility)}>单声道保护</button></div>
            <div className={`phase-meter ${phaseCorrelation < 0 ? "danger" : phaseCorrelation < 0.25 ? "warn" : "safe"}`}><span>相位</span><i><b style={{ left: `${(phaseCorrelation + 1) * 50}%` }}/></i><strong>{phaseCorrelation >= 0 ? "+" : ""}{phaseCorrelation.toFixed(2)}</strong></div>
          </details>
          <details className="lab-tool">
            <summary><span>MONO → STEREO</span><strong>单声道立体化</strong></summary>
            <button className={`feature-toggle ${settings.monoStereoize ? "active" : ""}`} aria-pressed={settings.monoStereoize} disabled={(sound.channels ?? 0) > 1} onClick={() => update("monoStereoize", !settings.monoStereoize)}>{(sound.channels ?? 0) > 1 ? "源文件已经是多声道" : settings.monoStereoize ? "已启用相位安全立体化" : "启用单声道立体化"}</button>
            <Slider label="立体化强度" value={Math.round(settings.stereoizeAmount * 100)} min={0} max={100} step={1} suffix="%" onChange={(value) => update("stereoizeAmount", value / 100)}/>
          </details>
          <details className="lab-tool">
            <summary><span>SPACE TRANSFER</span><strong>空间迁移</strong></summary>
            <div className="lab-option-grid">{spaceOptions.map((option) => <button key={option[0]} className={settings.spacePreset === option[0] ? "active" : ""} aria-pressed={settings.spacePreset === option[0]} onClick={() => applySpace(option)}>{option[1]}</button>)}</div>
          </details>
          <details className="lab-tool">
            <summary><span>OCCLUSION</span><strong>隔墙与遮挡</strong></summary>
            <div className="lab-option-grid">{occlusionOptions.map(([value, label]) => <button key={value} className={settings.occlusionPreset === value ? "active" : ""} aria-pressed={settings.occlusionPreset === value} onClick={() => applyOcclusion(value)}>{label}</button>)}</div>
          </details>
          <div className="lab-safety"><b>非破坏式流程</b><p>试听使用实时处理；导出始终创建新的 WAV，不写回原音频。</p></div>
        </aside>
        <main className="lab-console">
          <div className="lab-visual"><div className={`lab-orb ${playing ? "active" : ""}`}><i/><i/><i/></div><Spectrum analyser={labAnalyser} active={playing} detailed className="lab-spectrum"/>{loading || loadError ? <span className="lab-analysis-state">{loading ? "正在解析音频…" : loadError}</span> : null}<div className="lab-progress"><i style={{ width: `${progress * 100}%` }}/></div></div>
          <div className="lab-transport"><button className="lab-play" disabled={loading || !!loadError} onClick={toggleAudition}>{playing ? "Ⅱ 暂停" : "▶ 试听"}</button><div className="ab-switch" aria-label="处理前后对比"><button aria-pressed={comparison === "original"} className={comparison === "original" ? "active" : ""} onClick={() => switchComparison("original")}>A 原声</button><button aria-pressed={comparison === "processed"} className={comparison === "processed" ? "active" : ""} onClick={() => switchComparison("processed")}>B 处理后</button></div><button className="apply-preview" disabled={loading || !!loadError} onClick={() => void startAudition("processed", progressRef.current)}>应用并试听</button><span>{Math.round(progress * (sound.duration || 0) * 100) / 100}s / {Math.round((sound.duration || 0) * 100) / 100}s</span></div>
          <div className="lab-modules">
            <section><header><span>EQ</span><strong>三段均衡</strong></header><Slider label="低频 160 Hz" value={settings.lowGainDb} min={-18} max={18} step={0.5} suffix=" dB" onChange={(value) => update("lowGainDb", value)}/><Slider label="中频 1.4 kHz" value={settings.midGainDb} min={-18} max={18} step={0.5} suffix=" dB" onChange={(value) => update("midGainDb", value)}/><Slider label="高频 6.5 kHz" value={settings.highGainDb} min={-18} max={18} step={0.5} suffix=" dB" onChange={(value) => update("highGainDb", value)}/></section>
            <section><header><span>SPACE</span><strong>空间与延迟</strong></header><Slider label="混响量" value={settings.reverbMix} min={0} max={1} step={0.01} suffix="" onChange={(value) => update("reverbMix", value)}/><Slider label="延迟量" value={settings.delayMix} min={0} max={1} step={0.01} suffix="" onChange={(value) => update("delayMix", value)}/><Slider label="延迟时间" value={settings.delayMs} min={30} max={900} step={1} suffix=" ms" onChange={(value) => update("delayMs", value)}/><Slider label="反馈" value={settings.delayFeedback} min={0} max={0.88} step={0.01} suffix="" onChange={(value) => update("delayFeedback", value)}/></section>
            <section><header><span>CHARACTER</span><strong>质感与输出</strong></header><Slider label="失真驱动" value={settings.distortion} min={0} max={1} step={0.01} suffix="" onChange={(value) => update("distortion", value)}/><Slider label="输出增益" value={settings.outputGainDb} min={-18} max={12} step={0.5} suffix=" dB" onChange={(value) => update("outputGainDb", value)}/><div className="lab-meter"><span/><span/><span/><span/><span/><span/><span/><span/></div><p>导出阶段自动限制峰值，避免数字削波。</p></section>
          </div>
        </main>
      </div>
      <footer className="lab-footer"><div>{exported ? <><span>已导出</span><strong title={exported.outputPath}>{exported.outputPath}</strong><button onClick={() => void revealSound(exported.outputPath)}>在文件夹中显示</button></> : <><span>导出规格</span><strong>WAV · 24 bit · 保持原采样率 · {outputChannels}</strong></>}</div><button className="export-button" disabled={exporting} onClick={() => void exportAudio()}>{exporting ? "正在本地处理…" : "导出处理后的新文件"}</button></footer>
    </section>
  </div>;
}
