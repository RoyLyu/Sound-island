import { memo, useEffect, useRef } from "react";

type Props = {
  analyser: AnalyserNode | null;
  active: boolean;
  className?: string;
};

function SpectrumView({ analyser, active, className = "" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    const bins = new Uint8Array(analyser?.frequencyBinCount ?? 64);

    const draw = () => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      context.clearRect(0, 0, width, height);
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
  }, [active, analyser]);

  return <canvas ref={canvasRef} className={`spectrum ${className}`.trim()} aria-label="实时频谱"/>;
}

export const Spectrum = memo(SpectrumView);
