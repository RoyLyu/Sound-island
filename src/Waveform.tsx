import { memo, useMemo } from "react";

type WaveformProps = {
  peaks: number[];
  progress: number;
  loading: boolean;
  disabled: boolean;
  onSeek: (progress: number) => void;
};

function WaveformView({ peaks, progress, loading, disabled, onSeek }: WaveformProps) {
  const bars = useMemo(() => peaks.map((peak, index) => ({
    index,
    height: Math.max(3, Math.round(peak * 46)),
    x: ((index + 0.5) / peaks.length) * 100,
  })), [peaks]);

  return (
    <button
      className={`waveform ${loading ? "is-loading" : ""}`}
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
          {bars.map((bar) => (
            <line
              key={bar.index}
              x1={bar.x}
              x2={bar.x}
              y1={27 - bar.height / 2}
              y2={27 + bar.height / 2}
              className={bar.index / bars.length <= progress ? "played" : "pending"}
            />
          ))}
        </svg>
      ) : (
        <span className="waveform-empty">{loading ? "正在分析波形" : "选择声音以显示波形"}</span>
      )}
      <i className="playhead" style={{ left: `${progress * 100}%` }} />
    </button>
  );
}

export const Waveform = memo(WaveformView);
