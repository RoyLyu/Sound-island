import { forwardRef, memo, useEffect, useId, useImperativeHandle, useMemo, useRef } from "react";

export type WaveformHandle = {
  setProgress: (progress: number) => void;
};

type WaveformProps = {
  peaks: number[];
  progress: number;
  loading: boolean;
  disabled: boolean;
  onSeek: (progress: number) => void;
  className?: string;
};

const WaveformView = forwardRef<WaveformHandle, WaveformProps>(function WaveformView(
  { peaks, progress, loading, disabled, onSeek, className = "" },
  ref,
) {
  const clipId = useId().replace(/:/g, "");
  const clipRef = useRef<SVGRectElement | null>(null);
  const playheadRef = useRef<HTMLElement | null>(null);
  const bars = useMemo(() => peaks.map((peak, index) => ({
    index,
    height: Math.max(3, Math.round(peak * 46)),
    x: ((index + 0.5) / peaks.length) * 100,
  })), [peaks]);

  const setProgress = (nextProgress: number) => {
    const safeProgress = Math.max(0, Math.min(1, nextProgress));
    clipRef.current?.setAttribute("width", String(safeProgress * 100));
    if (playheadRef.current) playheadRef.current.style.left = `${safeProgress * 100}%`;
  };

  useImperativeHandle(ref, () => ({ setProgress }), []);
  useEffect(() => setProgress(progress), [progress]);

  return (
    <button
      className={`waveform ${loading ? "is-loading" : ""} ${className}`.trim()}
      disabled={disabled}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
      }}
      aria-label="音频波形，点击跳转播放位置"
    >
      <span className="waveform-grid" />
      {bars.length > 0 ? (
        <svg viewBox="0 0 100 54" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <clipPath id={clipId}>
              <rect ref={clipRef} x="0" y="0" width={progress * 100} height="54" />
            </clipPath>
          </defs>
          {bars.map((bar) => (
            <line
              key={bar.index}
              x1={bar.x}
              x2={bar.x}
              y1={27 - bar.height / 2}
              y2={27 + bar.height / 2}
              className="pending"
            />
          ))}
          <g clipPath={`url(#${clipId})`}>
            {bars.map((bar) => (
              <line
                key={`played-${bar.index}`}
                x1={bar.x}
                x2={bar.x}
                y1={27 - bar.height / 2}
                y2={27 + bar.height / 2}
                className="played"
              />
            ))}
          </g>
        </svg>
      ) : (
        <span className="waveform-empty">{loading ? "正在分析波形" : "选择声音以显示波形"}</span>
      )}
      <i ref={playheadRef} className="playhead" style={{ left: `${progress * 100}%` }} />
    </button>
  );
});

export const Waveform = memo(WaveformView);
