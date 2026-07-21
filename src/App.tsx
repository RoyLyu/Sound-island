import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  audioSource,
  chooseLibraryFolder,
  getStats,
  isDesktop,
  removeLibrary,
  revealSound,
  scanLibrary,
  searchSounds,
  setFavorite,
} from "./backend";
import type { LibraryStats, ScanProgress, Sound } from "./types";

const categories = [
  ["全部声音", "◌"],
  ["环境 Ambience", "≈"],
  ["拟音 Foley", "◍"],
  ["硬音效 Hard FX", "◆"],
  ["界面 UI", "⌁"],
  ["生物 Creature", "◇"],
  ["交通 Vehicles", "▱"],
  ["武器 Weapons", "⌖"],
  ["设计音 Design", "✦"],
  ["未分类", "·"],
] as const;

const emptyStats: LibraryStats = {
  total: 0,
  totalBytes: 0,
  favorites: 0,
  categories: {},
  libraries: [],
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    folder: <path d="M3 6.5h7l2 2h9v10H3z"/>,
    locate: <><path d="M4 7V4h3M17 4h3v3M20 17v3h-3M7 20H4v-3"/><circle cx="12" cy="12" r="3"/></>,
    heart: <path d="M20.8 5.7c-1.6-1.9-4.6-2.2-6.5-.5L12 7.2 9.7 5.1c-2-1.7-4.9-1.4-6.5.5-1.6 2-1.3 4.9.6 6.6L12 20l8.2-7.7c1.9-1.7 2.2-4.6.6-6.6Z"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    refresh: <><path d="M20 7v5h-5"/><path d="M18.5 16A8 8 0 1 1 19 7l1 5"/></>,
    play: <path d="m9 6 9 6-9 6Z" fill="currentColor"/>,
    pause: <><path d="M9 6v12M15 6v12" strokeWidth="3"/></>,
    volume: <><path d="M5 10v4h3l4 4V6L8 10Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.2"/></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index > 1 ? 2 : 0)} ${units[index]}`;
}

function formatTime(seconds?: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  const hundredths = Math.floor((seconds % 1) * 100);
  return `${minutes}:${String(rest).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

function channelName(count?: number | null) {
  if (!count) return "—";
  if (count === 1) return "Mono";
  if (count === 2) return "Stereo";
  if (count === 6) return "5.1";
  if (count === 8) return "7.1";
  return `${count} ch`;
}

export default function App() {
  const desktop = isDesktop();
  const [stats, setStats] = useState<LibraryStats>(emptyStats);
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [selected, setSelected] = useState<Sound | null>(null);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("全部声音");
  const [activeLibrary, setActiveLibrary] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState<ScanProgress | null>(null);
  const [toast, setToast] = useState("");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const toastTimer = useRef<number | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2800);
  }, []);

  const refreshStats = useCallback(async () => {
    if (!desktop) return;
    setStats(await getStats());
  }, [desktop]);

  const refreshSounds = useCallback(async () => {
    if (!desktop) return;
    setLoading(true);
    try {
      const result = await searchSounds({
        query,
        category: activeCategory === "全部声音" ? null : activeCategory,
        favoritesOnly,
        libraryPath: activeLibrary,
        limit: 500,
        offset: 0,
      });
      setSounds(result);
      setSelected((current) => result.find((sound) => sound.path === current?.path) ?? result[0] ?? null);
    } catch (error) {
      showToast(`读取索引失败：${String(error)}`);
    } finally {
      setLoading(false);
    }
  }, [desktop, query, activeCategory, favoritesOnly, activeLibrary, showToast]);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refreshSounds(), 160);
    return () => window.clearTimeout(timer);
  }, [refreshSounds]);

  useEffect(() => {
    if (!desktop) return;
    const unlisten = listen<ScanProgress>("scan-progress", (event) => setScanning(event.payload));
    return () => { void unlisten.then((dispose) => dispose()); };
  }, [desktop]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
  }, []);

  const stopAudio = () => {
    audioRef.current?.pause();
    setPlaying(false);
    setProgress(0);
  };

  const selectSound = (sound: Sound) => {
    if (sound.path !== selected?.path) stopAudio();
    setSelected(sound);
  };

  const togglePlay = async (sound = selected) => {
    if (!sound) return;
    if (selected?.path !== sound.path) {
      stopAudio();
      setSelected(sound);
    }
    let audio = audioRef.current;
    if (!audio || audio.dataset.path !== sound.path) {
      audio?.pause();
      audio = new Audio(audioSource(sound.path));
      audio.dataset.path = sound.path;
      audio.volume = volume;
      audio.ontimeupdate = () => setProgress(audio!.duration ? audio!.currentTime / audio!.duration : 0);
      audio.onended = () => { setPlaying(false); setProgress(0); };
      audio.onerror = () => showToast("无法播放：文件可能已移动或格式不受系统支持");
      audioRef.current = audio;
    }
    if (audio.paused) {
      await audio.play();
      setPlaying(true);
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const addLibrary = async () => {
    if (!desktop) {
      showToast("请在 Tauri 桌面应用中使用本地文件扫描");
      return;
    }
    const folder = await chooseLibraryFolder();
    if (!folder) return;
    setScanning({ libraryPath: folder, processed: 0, discovered: 0, currentFile: "准备扫描…" });
    try {
      const summary = await scanLibrary(folder);
      await Promise.all([refreshStats(), refreshSounds()]);
      showToast(`完成：索引 ${summary.scanned.toLocaleString()} 个音频，自动分类已应用`);
    } catch (error) {
      showToast(`扫描失败：${String(error)}`);
    } finally {
      setScanning(null);
    }
  };

  const rescan = async (path: string) => {
    setScanning({ libraryPath: path, processed: 0, discovered: 0, currentFile: "准备重新扫描…" });
    try {
      const summary = await scanLibrary(path);
      await Promise.all([refreshStats(), refreshSounds()]);
      showToast(`重新扫描完成：${summary.added} 个新增，${summary.updated} 个更新`);
    } catch (error) {
      showToast(`重新扫描失败：${String(error)}`);
    } finally {
      setScanning(null);
    }
  };

  const toggleFavorite = async (sound: Sound) => {
    const favorite = !sound.favorite;
    setSounds((current) => current.map((item) => item.path === sound.path ? { ...item, favorite } : item));
    setSelected((current) => current?.path === sound.path ? { ...current, favorite } : current);
    await setFavorite(sound.path, favorite);
    await refreshStats();
    if (favoritesOnly && !favorite) void refreshSounds();
  };

  const locate = async (sound: Sound) => {
    try {
      await revealSound(sound.path);
    } catch (error) {
      showToast(`无法定位文件：${String(error)}`);
    }
  };

  const removeLibraryFromIndex = async (path: string) => {
    if (!window.confirm("只从声屿索引中移除此素材库？原始音频文件不会被删除。")) return;
    await removeLibrary(path);
    if (activeLibrary === path) setActiveLibrary(null);
    await Promise.all([refreshStats(), refreshSounds()]);
    showToast("已移除索引，原始音频未作任何改动");
  };

  const selectedFormat = useMemo(() => selected?.extension.replace(".", "").toUpperCase() ?? "—", [selected]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><i/><i/><i/><i/><i/></div><div><strong>声屿</strong><small>SOUND ISLAND</small></div></div>
        <label className="search-box"><Icon name="search" size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名、分类、标签或完整路径…"/>{query && <button onClick={() => setQuery("")} aria-label="清空"><Icon name="close" size={14}/></button>}<kbd>⌘ K</kbd></label>
        <div className="status-area"><i className={desktop ? "online" : "offline"}/><span><strong>{desktop ? "本地数据库就绪" : "网页预览模式"}</strong><small>{stats.total.toLocaleString()} 个音频 · 数据不上传</small></span><button className="add-top" onClick={addLibrary}><Icon name="plus" size={16}/>添加素材库</button></div>
      </header>

      <aside className="sidebar">
        <button className="import-button" onClick={addLibrary}><Icon name="folder" size={18}/>选择本地音效文件夹</button>
        <nav className="nav-section">
          <label>声音分类</label>
          {categories.map(([label, glyph]) => <button key={label} className={!favoritesOnly && activeCategory === label ? "active" : ""} onClick={() => { setFavoritesOnly(false); setActiveCategory(label); }}><span className="glyph">{glyph}</span><span>{label}</span><em>{label === "全部声音" ? stats.total : stats.categories[label] ?? 0}</em></button>)}
          <button className={favoritesOnly ? "active" : ""} onClick={() => setFavoritesOnly(true)}><span className="glyph"><Icon name="heart" size={14}/></span><span>我的收藏</span><em>{stats.favorites}</em></button>
        </nav>
        <nav className="library-section">
          <label>本地素材库</label>
          {stats.libraries.map((library) => <div className={`library-item ${activeLibrary === library.path ? "active" : ""}`} key={library.path}><button className="library-name" onClick={() => setActiveLibrary(activeLibrary === library.path ? null : library.path)} title={library.path}><i/><span><strong>{library.name}</strong><small>{library.soundCount.toLocaleString()} 个文件</small></span></button><button className="mini-action" onClick={() => void rescan(library.path)} title="重新扫描"><Icon name="refresh" size={13}/></button><button className="mini-action danger" onClick={() => void removeLibraryFromIndex(library.path)} title="从索引移除"><Icon name="trash" size={13}/></button></div>)}
          {!stats.libraries.length && <p className="sidebar-empty">还没有添加任何素材库</p>}
        </nav>
        <div className="storage-card"><div><span>本地索引</span><strong>{formatBytes(stats.totalBytes)}</strong></div><p><i/>SQLite 持久保存</p><small>音频始终留在你的硬盘中</small></div>
      </aside>

      <section className="workspace">
        {!desktop && <div className="preview-notice"><Icon name="info" size={15}/><span>这是界面预览。安装桌面版后才能扫描、试听和定位本机音频。</span></div>}
        <div className="workspace-head"><div><strong>{favoritesOnly ? "我的收藏" : activeCategory}</strong><span>{activeLibrary ? stats.libraries.find((item) => item.path === activeLibrary)?.name : "全部素材库"}</span></div><p>{sounds.length.toLocaleString()} 条结果{stats.total > 500 ? " · 当前最多显示 500 条，请用关键词继续缩小" : ""}</p></div>
        <div className="table-head"><span>音效名称</span><span>分类</span><span>时长</span><span>规格</span><span>文件夹</span><span/></div>
        <div className={`sound-list ${loading ? "loading" : ""}`}>
          {sounds.map((sound) => <article key={sound.path} className={selected?.path === sound.path ? "selected" : ""} onClick={() => selectSound(sound)} onDoubleClick={() => void togglePlay(sound)}>
            <div className="sound-name"><button className={sound.favorite ? "favorite active" : "favorite"} onClick={(event) => { event.stopPropagation(); void toggleFavorite(sound); }} aria-label="收藏"><Icon name="heart" size={14}/></button><span><strong>{sound.name}</strong><small title={sound.path}>{sound.path}</small></span></div>
            <div className="category-cell"><strong>{sound.category}</strong><small>{sound.subcategory}</small></div>
            <span className="mono">{formatTime(sound.duration)}</span>
            <div className="spec-cell"><strong>{sound.sampleRate ? `${sound.sampleRate / 1000} kHz` : "—"}{sound.bitDepth ? ` · ${sound.bitDepth} bit` : ""}</strong><small>{sound.extension.replace(".", "").toUpperCase()} · {channelName(sound.channels)}</small></div>
            <span className="library-cell">{sound.libraryName}</span>
            <button className="locate-row" onClick={(event) => { event.stopPropagation(); void locate(sound); }} title="在 Finder / 资源管理器中定位"><Icon name="locate" size={16}/></button>
          </article>)}
          {!loading && sounds.length === 0 && <div className="empty-state"><div><Icon name={stats.total ? "search" : "folder"} size={30}/></div><strong>{stats.total ? "没有找到匹配的音效" : "素材库是空的"}</strong><p>{stats.total ? "换一个关键词或分类试试。" : "只会显示你主动添加的本地音频，不包含任何示例或 Mock 数据。"}</p>{!stats.total && <button onClick={addLibrary}><Icon name="plus" size={15}/>添加第一个素材库</button>}</div>}
        </div>
        <footer><span>SQLite + FTS5 本地全文索引</span><span>双击试听 · ♥ 收藏 · ⌖ 定位原文件</span></footer>
      </section>

      <aside className="inspector">
        <header><strong>声音详情</strong><span>真实文件</span></header>
        {selected ? <>
          <div className="file-card"><div className="file-art"><span>{selectedFormat}</span><div className="audio-line"><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></div><strong>{selected.name}</strong><small>{selected.libraryName}</small></div>
          <div className="classification"><label>自动分类</label><strong>{selected.category}</strong><span>{selected.subcategory}</span><p>根据文件名与所在路径匹配；不会改动或移动原始文件。</p></div>
          <dl><div><dt>时长</dt><dd className="mono">{formatTime(selected.duration)}</dd></div><div><dt>采样率</dt><dd>{selected.sampleRate ? `${selected.sampleRate / 1000} kHz` : "未读取"}</dd></div><div><dt>位深</dt><dd>{selected.bitDepth ? `${selected.bitDepth} bit` : "—"}</dd></div><div><dt>声道</dt><dd>{channelName(selected.channels)}</dd></div><div><dt>格式</dt><dd>{selectedFormat}</dd></div><div><dt>大小</dt><dd>{formatBytes(selected.fileSize)}</dd></div></dl>
          {selected.tags.length > 0 && <section className="tag-section"><label>文件名标签</label><div>{selected.tags.map((tag) => <button key={tag} onClick={() => setQuery(tag)}>{tag}</button>)}</div></section>}
          <section className="path-section"><label>完整路径</label><p title={selected.path}>{selected.path}</p></section>
          <div className="inspector-actions"><button className="primary" onClick={() => void locate(selected)}><Icon name="locate" size={16}/>定位原文件</button><button className={selected.favorite ? "active" : ""} onClick={() => void toggleFavorite(selected)}><Icon name="heart" size={16}/>{selected.favorite ? "已收藏" : "收藏"}</button></div>
        </> : <div className="no-selection"><Icon name="info" size={26}/><strong>选择一个声音</strong><p>这里会显示文件真实规格、自动分类和本地路径。</p></div>}
      </aside>

      <section className="player">
        <div className="now-playing"><button className={selected?.favorite ? "favorite active" : "favorite"} onClick={() => selected && void toggleFavorite(selected)}><Icon name="heart" size={16}/></button><span><strong>{selected?.name ?? "尚未选择声音"}</strong><small>{selected ? `${selected.category} · ${selectedFormat}` : "添加素材库后开始试听"}</small></span></div>
        <button className="play-button" disabled={!selected} onClick={() => void togglePlay()} aria-label={playing ? "暂停" : "播放"}><Icon name={playing ? "pause" : "play"} size={21}/></button>
        <div className="progress-track" onClick={(event) => { const audio = audioRef.current; if (!audio?.duration) return; const rect = event.currentTarget.getBoundingClientRect(); const next = (event.clientX - rect.left) / rect.width; audio.currentTime = next * audio.duration; setProgress(next); }}><span style={{ width: `${progress * 100}%` }}/><i style={{ left: `${progress * 100}%` }}/></div>
        <span className="timecode mono">{formatTime((selected?.duration ?? 0) * progress)} / {formatTime(selected?.duration)}</span>
        <div className="volume"><Icon name="volume" size={17}/><input type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))}/><button disabled={!selected} onClick={() => selected && void locate(selected)}><Icon name="locate" size={15}/>定位文件</button></div>
      </section>

      {scanning && <div className="scan-overlay"><div className="scan-dialog"><div className="spinner"/><strong>正在建立本地索引</strong><p>{scanning.currentFile || "分析文件名与音频规格…"}</p><div className="scan-progress"><span style={{ width: scanning.discovered ? `${Math.min(100, scanning.processed / scanning.discovered * 100)}%` : "12%" }}/></div><small>已处理 {scanning.processed.toLocaleString()} / {scanning.discovered.toLocaleString()} · 音频不会上传</small></div></div>}
      {toast && <div className="toast"><i>✓</i>{toast}</div>}
    </main>
  );
}
