import { memo, useEffect, useRef } from "react";

type Props = {
  analyser: AnalyserNode | null;
  active: boolean;
  className?: string;
  detailed?: boolean;
};

function SpectrumView({ analyser, active, className = "", detailed = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    const bins = new Uint8Array(analyser?.frequencyBinCount ?? 64);
    const preciseBins = new Float32Array(analyser?.frequencyBinCount ?? 64);

    const draw = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.clearRect(0, 0, width, height);
      if (detailed) {
        context.strokeStyle = "rgba(115, 143, 165, .16)";
        context.fillStyle = "rgba(132, 157, 177, .62)";
        context.lineWidth = ratio;
        context.font = `${8 * ratio}px ui-monospace, monospace`;
        const frequencies = [50, 100, 500, 1000, 5000, 10000, 20000];
        const minFrequency = 20;
        const maxFrequency = Math.min(24000, (analyser?.context.sampleRate ?? 48000) / 2);
        for (const frequency of frequencies.filter((value) => value <= maxFrequency)) {
          const x = Math.log(frequency / minFrequency) / Math.log(maxFrequency / minFrequency) * width;
          context.beginPath();
          context.moveTo(x, 0);
          context.lineTo(x, height - 13 * ratio);
          context.stroke();
          const label = frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);
          context.fillText(label, Math.min(width - 20 * ratio, x + 3 * ratio), height - 3 * ratio);
        }
        for (const level of [-90, -60, -30]) {
          const y = (1 - (level + 100) / 100) * (height - 16 * ratio);
          context.beginPath();
          context.moveTo(0, y);
          context.lineTo(width, y);
          context.stroke();
        }
        if (analyser && active) analyser.getFloatFrequencyData(preciseBins);
        const plotHeight = height - 17 * ratio;
        const gradient = context.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, "rgba(84, 220, 209, .82)");
        gradient.addColorStop(.55, "rgba(130, 112, 239, .92)");
        gradient.addColorStop(1, "rgba(205, 193, 255, .96)");
        context.strokeStyle = gradient;
        context.lineWidth = 1.35 * ratio;
        context.beginPath();
        for (let x = 0; x < width; x += ratio) {
          const frequency = minFrequency * (maxFrequency / minFrequency) ** (x / width);
          const sourceIndex = Math.min(
            preciseBins.length - 1,
            Math.max(0, Math.round(frequency / maxFrequency * preciseBins.length)),
          );
          const decibels = active ? preciseBins[sourceIndex] : -100;
          const normalized = Math.max(0, Math.min(1, (decibels + 100) / 90));
          const y = plotHeight - normalized * plotHeight;
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
        frame = requestAnimationFrame(draw);
        return;
      }
      if (analyser && active) analyser.getByteFrequencyData(bins);
      const count = Math.min(48, bins.length);
      const gap = 1.6 * ratio;
      const barWidth = Math.max(1, width / count - gap);
      const gradient = context.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, "rgba(79, 224, 210, .28)");
      gradient.addColorStop(.55, "rgba(116, 99, 232, .74)");
      gradient.addColorStop(1, "rgba(193, 180, 255, .96)");
      context.fillStyle = gradient;
      for (let index = 0; index < count; index += 1) {
        const sourceIndex = Math.floor((index / count) ** 1.65 * bins.length);
        const liveValue = bins[Math.min(bins.length - 1, sourceIndex)] / 255;
        const value = active ? liveValue : 0.025 + Math.sin(index * 0.71) * 0.01;
        const barHeight = Math.max(1.2 * ratio, value * height * 0.86);
        context.fillRect(index * (barWidth + gap), height - barHeight, barWidth, barHeight);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [active, analyser, detailed]);

  return <canvas ref={canvasRef} className={`spectrum ${detailed ? "detailed" : ""} ${className}`.trim()} aria-label={detailed ? "高精度实时频谱" : "实时频谱"}/>;
}

export const Spectrum = memo(SpectrumView);
