import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  audioSource,
  chooseLibraryFolder,
  getStats,
  getWaveform,
  isDesktop,
  recordSoundPlayed,
  removeLibrary,
  revealSound,
  scanLibrary,
  searchSounds,
  setFavorite,
  setSoundDisplayName,
  translateSoundName,
  undoSoundDisplayName,
} from "./backend";
import type { LibraryStats, ScanProgress, Sound, SoundNameUpdate } from "./types";
import { SoundLab } from "./SoundLab";
import { Waveform } from "./Waveform";

const categories = [
  ["全部声音", "◌"], ["环境 Ambience", "≈"], ["拟音 Foley", "◍"],
  ["硬音效 Hard FX", "◆"], ["界面 UI", "⌁"], ["生物 Creature", "◇"],
  ["交通 Vehicles", "▱"], ["武器 Weapons", "⌖"], ["设计音 Design", "✦"], ["未分类", "·"],
] as const;

const smartCollections = [
  ["recently_played", "最近播放", "↺"],
] as const;

const quickFilters = ["雨声", "脚步声", "摩擦声", "撞击声", "门窗", "车辆", "呼啸转场", "人群"];
const pitchOptions = [0, -6, 6] as const;

const emptyStats: LibraryStats = {
  total: 0,
  totalBytes: 0,
  favorites: 0,
  categories: {},
  subcategories: {},
  smartCollections: {},
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
    spark: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z"/></>,
    undo: <path d="M9 7 4 12l5 5M5 12h8a6 6 0 0 1 6 6"/>,
    edit: <><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10Z"/><path d="m13.5 7 3.5 3.5"/></>,
    next: <><path d="m7 6 8 6-8 6Z"/><path d="M17 6v12"/></>,
    loop: <><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></>,
    similar: <><circle cx="10" cy="10" r="5"/><path d="m14 14 6 6M3 10H1M10 3V1M17 10h2M10 17v2"/></>,
    lab: <><path d="M9 3v5l-4.5 8a3 3 0 0 0 2.6 4.5h9.8a3 3 0 0 0 2.6-4.5L15 8V3"/><path d="M8 13h8M8 3h8"/><circle cx="12" cy="17" r="1"/></>,
    chevron: <path d="m8 10 4 4 4-4"/>,
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

const soundTitle = (sound: Sound | null) => sound?.displayName || sound?.name || "尚未选择声音";

export default function App() {
  const desktop = isDesktop();
  const [stats, setStats] = useState<LibraryStats>(emptyStats);
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [selected, setSelected] = useState<Sound | null>(null);
  const [query, setQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"all" | "name" | "category" | "tags" | "path">("all");
  const [activeCategory, setActiveCategory] = useState("全部声音");
  const [activeSubcategory, setActiveSubcategory] = useState<string | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [activeLibrary, setActiveLibrary] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [expandedLibrary, setExpandedLibrary] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState<ScanProgress | null>(null);
  const [toast, setToast] = useState("");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [loopPlayback, setLoopPlayback] = useState(false);
  const [pitchSemitones, setPitchSemitones] = useState<(typeof pitchOptions)[number]>(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [translating, setTranslating] = useState(false);
  const [soundLabOpen, setSoundLabOpen] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const toastTimer = useRef<number | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const soundsRef = useRef<Sound[]>([]);
  const selectedRef = useRef<Sound | null>(null);
  const autoAdvanceRef = useRef(true);
  const playRelativeRef = useRef<(step: number, shouldPlay?: boolean) => void>(() => undefined);
  const keyboardHandlerRef = useRef<(event: KeyboardEvent) => void>(() => undefined);

  soundsRef.current = sounds;
  selectedRef.current = selected;
  autoAdvanceRef.current = autoAdvance;

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 2800);
  }, []);

  const refreshStats = useCallback(async () => {
    if (desktop) setStats(await getStats());
  }, [desktop]);

  const refreshSounds = useCallback(async () => {
    if (!desktop) return;
    setLoading(true);
    try {
      const result = await searchSounds({
        query,
        scope: searchScope,
        category: activeCategory === "全部声音" ? null : activeCategory,
        subcategory: activeSubcategory,
        collection: activeCollection,
        favoritesOnly,
        libraryPath: activeLibrary,
        folderPath: activeFolder,
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
  }, [desktop, query, searchScope, activeCategory, activeSubcategory, activeCollection, favoritesOnly, activeLibrary, activeFolder, showToast]);

  useEffect(() => { void refreshStats(); }, [refreshStats]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refreshSounds(), 140);
    return () => window.clearTimeout(timer);
  }, [refreshSounds]);
  useEffect(() => {
    if (!desktop) return;
    const unlisten = listen<ScanProgress>("scan-progress", (event) => setScanning(event.payload));
    return () => { void unlisten.then((dispose) => dispose()); };
  }, [desktop]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.loop = loopPlayback;
    audio.playbackRate = 2 ** (pitchSemitones / 12);
    audio.preservesPitch = false;
  }, [loopPlayback, pitchSemitones]);
  useEffect(() => () => {
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.src = "";
  }, []);
  useEffect(() => {
    setNameDraft(selected?.displayName ?? "");
  }, [selected?.path, selected?.displayName]);
  useEffect(() => {
    let cancelled = false;
    setWaveform([]);
    if (!desktop || !selected) {
      setWaveformLoading(false);
      return;
    }
    setWaveformLoading(true);
    void getWaveform(selected.path).then((peaks) => {
      if (!cancelled) setWaveform(peaks);
    }).catch(() => {
      if (!cancelled) setWaveform([]);
    }).finally(() => {
      if (!cancelled) setWaveformLoading(false);
    });
    return () => { cancelled = true; };
  }, [desktop, selected?.path]);

  const stopAudio = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
    setProgress(0);
  }, []);

  const selectSound = useCallback((sound: Sound) => {
    if (sound.path !== selectedRef.current?.path) stopAudio();
    setSelected(sound);
  }, [stopAudio]);

  const togglePlay = useCallback(async (sound = selectedRef.current, forcePlay = false) => {
    if (!sound) return;
    if (selectedRef.current?.path !== sound.path) {
      stopAudio();
      setSelected(sound);
    }
    let audio = audioRef.current;
    if (!audio || audio.dataset.path !== sound.path) {
      audio?.pause();
      audio = new Audio(audioSource(sound.path));
      audio.dataset.path = sound.path;
      audio.volume = volume;
      audio.loop = loopPlayback;
      audio.playbackRate = 2 ** (pitchSemitones / 12);
      audio.preservesPitch = false;
      audio.ontimeupdate = () => setProgress(audio!.duration ? audio!.currentTime / audio!.duration : 0);
      audio.onended = () => {
        setPlaying(false);
        setProgress(0);
        if (autoAdvanceRef.current) playRelativeRef.current(1, true);
      };
      audio.onerror = () => showToast("无法播放：文件可能已移动或格式不受系统支持");
      audioRef.current = audio;
    }
    if (audio.paused || forcePlay) {
      await audio.play();
      setPlaying(true);
      void recordSoundPlayed(sound.path);
      const firstPlay = !sound.lastPlayedAt;
      setSounds((current) => current.map((item) => item.path === sound.path ? { ...item, lastPlayedAt: Date.now(), playCount: item.playCount + 1 } : item));
      setSelected((current) => current?.path === sound.path ? { ...current, lastPlayedAt: Date.now(), playCount: current.playCount + 1 } : current);
      if (firstPlay) setStats((current) => ({ ...current, smartCollections: { ...current.smartCollections, recently_played: (current.smartCollections.recently_played ?? 0) + 1 } }));
    } else {
      audio.pause();
      setPlaying(false);
    }
  }, [loopPlayback, pitchSemitones, showToast, stopAudio, volume]);

  const playRelative = useCallback((step: number, shouldPlay = false) => {
    const list = soundsRef.current;
    if (!list.length) return;
    const currentIndex = Math.max(0, list.findIndex((sound) => sound.path === selectedRef.current?.path));
    const nextIndex = Math.max(0, Math.min(list.length - 1, currentIndex + step));
    const next = list[nextIndex];
    if (!next || next.path === selectedRef.current?.path) return;
    selectSound(next);
    window.requestAnimationFrame(() => document.querySelector(`[data-sound-index="${nextIndex}"]`)?.scrollIntoView({ block: "nearest" }));
    if (shouldPlay) void togglePlay(next, true);
  }, [selectSound, togglePlay]);
  playRelativeRef.current = playRelative;

  keyboardHandlerRef.current = (event) => {
    const target = event.target as HTMLElement | null;
    const isEditing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.tagName === "SELECT" || target?.isContentEditable;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      return;
    }
    if (isEditing) return;
    if (soundLabOpen) return;
    if (event.code === "Space") {
      event.preventDefault();
      void togglePlay();
    } else if (event.key === "ArrowDown" || event.code === "KeyS") {
      event.preventDefault();
      playRelative(1);
    } else if (event.key === "ArrowUp" || event.code === "KeyW") {
      event.preventDefault();
      playRelative(-1);
    }
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyboardHandlerRef.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const addLibrary = async () => {
    if (!desktop) { showToast("请在 Tauri 桌面应用中使用本地文件扫描"); return; }
    const folder = await chooseLibraryFolder();
    if (!folder) return;
    setScanning({ libraryPath: folder, processed: 0, discovered: 0, currentFile: "准备扫描…" });
    try {
      const summary = await scanLibrary(folder);
      await Promise.all([refreshStats(), refreshSounds()]);
      showToast(`完成：索引 ${summary.scanned.toLocaleString()} 个音频，已过滤 macOS 资源分叉文件`);
    } catch (error) { showToast(`扫描失败：${String(error)}`); }
    finally { setScanning(null); }
  };

  const rescan = async (path: string) => {
    setScanning({ libraryPath: path, processed: 0, discovered: 0, currentFile: "准备重新扫描…" });
    try {
      const summary = await scanLibrary(path);
      await Promise.all([refreshStats(), refreshSounds()]);
      showToast(`重新扫描完成：${summary.added} 个新增，${summary.updated} 个更新`);
    } catch (error) { showToast(`重新扫描失败：${String(error)}`); }
    finally { setScanning(null); }
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
    try { await revealSound(sound.path); }
    catch (error) { showToast(`无法定位文件：${String(error)}`); }
  };

  const removeLibraryFromIndex = async (path: string) => {
    if (!window.confirm("只从声屿索引中移除此素材库？原始音频文件不会被删除。")) return;
    await removeLibrary(path);
    if (activeLibrary === path) setActiveLibrary(null);
    if (expandedLibrary === path) setExpandedLibrary(null);
    if (activeFolder?.startsWith(path)) setActiveFolder(null);
    await Promise.all([refreshStats(), refreshSounds()]);
    showToast("已移除索引，原始音频未作任何改动");
  };

  const applyNameUpdate = useCallback((path: string, update: SoundNameUpdate) => {
    setSounds((current) => current.map((sound) => sound.path === path ? { ...sound, displayName: update.displayName ?? null, canUndoName: update.canUndoName } : sound));
    setSelected((current) => current?.path === path ? { ...current, displayName: update.displayName ?? null, canUndoName: update.canUndoName } : current);
  }, []);

  const translateSelected = async () => {
    const sound = selectedRef.current;
    if (!sound) return;
    setTranslating(true);
    try {
      applyNameUpdate(sound.path, await translateSoundName(sound.path));
      await refreshStats();
      showToast("已生成本地中文显示名；硬盘文件名未改变");
    } catch (error) { showToast(`生成中文名失败：${String(error)}`); }
    finally { setTranslating(false); }
  };

  const saveNameDraft = async () => {
    const sound = selectedRef.current;
    if (!sound) return;
    applyNameUpdate(sound.path, await setSoundDisplayName(sound.path, nameDraft || null));
    await refreshStats();
    showToast(nameDraft ? "显示名已保存到本地索引" : "已恢复原始文件名显示");
  };

  const undoName = async () => {
    const sound = selectedRef.current;
    if (!sound) return;
    applyNameUpdate(sound.path, await undoSoundDisplayName(sound.path));
    await refreshStats();
    showToast("已撤回上次显示名修改");
  };

  const seek = useCallback((next: number) => {
    const audio = audioRef.current;
    if (audio?.duration) audio.currentTime = next * audio.duration;
    setProgress(next);
  }, []);

  const findSimilar = () => {
    const sound = selectedRef.current;
    if (!sound) return;
    setQuery("");
    setSearchScope("all");
    setActiveLibrary(null);
    setActiveFolder(null);
    setFavoritesOnly(false);
    setActiveCollection(null);
    setActiveCategory(sound.category);
    setActiveSubcategory(sound.subcategory);
    showToast(`正在查找相似声音：${sound.subcategory.split(" / ")[0]}`);
  };

  const cyclePitch = () => {
    setPitchSemitones((current) => pitchOptions[(pitchOptions.indexOf(current) + 1) % pitchOptions.length]);
  };

  const selectedFormat = useMemo(() => selected?.extension.replace(".", "").toUpperCase() ?? "—", [selected?.extension]);
  const activeTitle = favoritesOnly
    ? "我的收藏"
    : activeCollection
      ? smartCollections.find(([key]) => key === activeCollection)?.[1] ?? "智能集合"
      : activeSubcategory ?? activeCategory;
  const miniPeaks = waveform.filter((_, index) => index % Math.max(1, Math.floor(waveform.length / 34)) === 0).slice(0, 34);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><i/><i/><i/><i/><i/></div><div><strong>声屿</strong><small>SOUND ISLAND · 0.3</small></div></div>
        <label className="search-box"><Icon name="search" size={18}/><select aria-label="搜索范围" value={searchScope} onChange={(event) => setSearchScope(event.target.value as typeof searchScope)}><option value="all">全库</option><option value="name">名称</option><option value="category">分类</option><option value="tags">标签</option><option value="path">路径</option></select><i className="search-divider"/><input ref={searchInputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入中文或英文，搜索原名、显示名、分类、标签与路径…"/>{query ? <button onClick={() => setQuery("")} aria-label="清空"><Icon name="close" size={14}/></button> : null}<span className="search-engine">FTS5</span><kbd>⌘ K</kbd></label>
        <div className="status-area"><button className="lab-top" disabled={!selected} onClick={() => { stopAudio(); setSoundLabOpen(true); }} title={selected ? "将当前选中声音送入声音实验室" : "请先选择一个声音"}><Icon name="lab" size={16}/>声音实验室</button><div className="privacy-pill"><i className={desktop ? "online" : "offline"}/><span><strong>{desktop ? "本地智能在线" : "界面预览"}</strong><small>{stats.total.toLocaleString()} 个音频 · 零上传</small></span></div><button className="add-top" onClick={addLibrary}><Icon name="plus" size={16}/>添加素材库</button></div>
      </header>

      <aside className="sidebar">
        <nav className="nav-section smart-nav">
          <label><span>智能视图</span><em>LIVE</em></label>
          <button className={favoritesOnly ? "active" : ""} onClick={() => { setFavoritesOnly(true); setActiveCollection(null); setActiveSubcategory(null); }}><span className="glyph"><Icon name="heart" size={14}/></span><span>我的收藏</span><em>{stats.favorites.toLocaleString()}</em></button>
          {smartCollections.map(([key, label, glyph]) => <button key={key} className={!favoritesOnly && activeCollection === key ? "active" : ""} onClick={() => { setFavoritesOnly(false); setActiveCollection(key); setActiveCategory("全部声音"); setActiveSubcategory(null); }}><span className="glyph">{glyph}</span><span>{label}</span><em>{(stats.smartCollections[key] ?? 0).toLocaleString()}</em></button>)}
        </nav>
        <nav className="nav-section category-nav">
          <label><span>智能分类</span><em>{Object.keys(stats.categories).length}</em></label>
          {categories.map(([label, glyph]) => <div className="category-group" key={label}><button className={!favoritesOnly && !activeCollection && activeCategory === label && !activeSubcategory ? "active" : ""} aria-expanded={label === "全部声音" ? undefined : expandedCategory === label} onClick={() => { setFavoritesOnly(false); setActiveCollection(null); setActiveCategory(label); setActiveSubcategory(null); setExpandedCategory((current) => label === "全部声音" ? null : current === label ? null : label); }}><span className="glyph">{glyph}</span><span>{label}</span><span className="nav-count"><em>{(label === "全部声音" ? stats.total : stats.categories[label] ?? 0).toLocaleString()}</em>{label !== "全部声音" ? <i className={expandedCategory === label ? "expanded" : ""}><Icon name="chevron" size={11}/></i> : null}</span></button>{expandedCategory === label && label !== "全部声音" ? <div className="subcategory-list">{Object.entries(stats.subcategories[label] ?? {}).map(([subcategory, count]) => <button key={subcategory} className={activeSubcategory === subcategory ? "active" : ""} onClick={() => setActiveSubcategory(activeSubcategory === subcategory ? null : subcategory)}><span>{subcategory.split(" / ")[0]}</span><em>{count.toLocaleString()}</em></button>)}</div> : null}</div>)}
        </nav>
        <nav className="library-section">
          <label>本地素材库</label>
          {stats.libraries.map((library) => <div className="library-group" key={library.path}><div className={`library-item ${activeLibrary === library.path && !activeFolder ? "active" : ""}`}><button className="library-name" aria-expanded={expandedLibrary === library.path} onClick={() => { const closing = expandedLibrary === library.path; setExpandedLibrary(closing ? null : library.path); setActiveLibrary(closing ? null : library.path); setActiveFolder(null); }} title={library.path}><i/><span><strong>{library.name}</strong><small>{library.soundCount.toLocaleString()} 个文件 · {library.childFolders.length} 个子文件夹</small></span><b className={expandedLibrary === library.path ? "expanded" : ""}><Icon name="chevron" size={11}/></b></button><button className="mini-action" onClick={() => void rescan(library.path)} title="重新扫描"><Icon name="refresh" size={13}/></button><button className="mini-action danger" onClick={() => void removeLibraryFromIndex(library.path)} title="从索引移除"><Icon name="trash" size={13}/></button></div>{expandedLibrary === library.path ? <div className="library-children">{library.childFolders.length ? library.childFolders.map((folder) => <button key={folder.path} className={activeFolder === folder.path ? "active" : ""} onClick={() => { setActiveLibrary(library.path); setActiveFolder(activeFolder === folder.path ? null : folder.path); }} title={folder.path}><span><Icon name="folder" size={12}/>{folder.name}</span><em>{folder.soundCount.toLocaleString()}</em></button>) : <p>母文件夹下没有可索引的直属子文件夹</p>}</div> : null}</div>)}
          {!stats.libraries.length ? <p className="sidebar-empty">还没有添加任何素材库</p> : null}
        </nav>
      </aside>

      <section className="workspace">
        {!desktop ? <div className="preview-notice"><Icon name="info" size={15}/><span>界面预览模式：桌面版会读取真实 SQLite 索引与本地波形。</span></div> : null}
        <div className="workspace-head"><div><span className="eyebrow">声景视图</span><strong>{activeTitle}</strong><span>{activeFolder ? activeFolder.split(/[\\/]/).pop() : activeLibrary ? stats.libraries.find((item) => item.path === activeLibrary)?.name : "全部素材库"}</span></div><p><strong>{sounds.length.toLocaleString()}</strong> 条结果{stats.total > 500 ? " · 显示前 500 条" : ""}</p></div>
        <div className="filter-strip"><span className="filter-label"><Icon name="spark" size={13}/>声音速查</span><div className="quick-filter-list">{quickFilters.map((term) => <button key={term} className={query === term ? "active" : ""} onClick={() => { setSearchScope("all"); setQuery(query === term ? "" : term); }}>{term}</button>)}</div><span className="key-hint"><kbd>W/S</kbd> 或 <kbd>↑↓</kbd> 选择 <kbd>Space</kbd> 试听</span></div>
        <div className="table-head"><span>声音</span><span>智能分类</span><span>时长</span><span>规格</span><span>素材库</span><span/></div>
        <div className={`sound-list ${loading ? "loading" : ""}`}>
          {sounds.map((sound, index) => <article key={sound.path} data-sound-index={index} className={`${selected?.path === sound.path ? "selected" : ""} ${playing && selected?.path === sound.path ? "is-playing" : ""}`} onClick={() => selectSound(sound)} onDoubleClick={() => void togglePlay(sound)}>
            <div className="sound-name"><button className={sound.favorite ? "favorite active" : "favorite"} onClick={(event) => { event.stopPropagation(); void toggleFavorite(sound); }} aria-label="收藏"><Icon name="heart" size={14}/></button><span><strong>{soundTitle(sound)}</strong>{sound.displayName ? <small className="original-name">原名 · {sound.name}</small> : <small title={sound.path}>{sound.path}</small>}</span>{sound.displayName ? <b className="translated-badge">中</b> : null}</div>
            <div className="category-cell"><strong>{sound.category}</strong><small>{sound.subcategory}</small></div>
            <span className="mono">{formatTime(sound.duration)}</span>
            <div className="spec-cell"><strong>{sound.sampleRate ? `${sound.sampleRate / 1000} kHz` : "—"}{sound.bitDepth ? ` · ${sound.bitDepth} bit` : ""}</strong><small>{sound.extension.replace(".", "").toUpperCase()} · {channelName(sound.channels)}</small></div>
            <span className="library-cell">{sound.libraryName}</span>
            <button className="locate-row" onClick={(event) => { event.stopPropagation(); void locate(sound); }} title="在 Finder / 资源管理器中定位"><Icon name="locate" size={16}/></button>
          </article>)}
          {!loading && sounds.length === 0 ? <div className="empty-state"><div><Icon name={stats.total ? "search" : "folder"} size={30}/></div><strong>{stats.total ? "没有找到匹配的声音" : "素材库是空的"}</strong><p>{stats.total ? "换一个关键词、智能集合或分类试试。" : "选择本地音效文件夹后，声屿会离线建立索引。"}</p>{!stats.total ? <button onClick={addLibrary}><Icon name="plus" size={15}/>添加第一个素材库</button> : null}</div> : null}
        </div>
        <footer><span>SQLite + FTS5 本地全文索引</span><span>已自动忽略 macOS `._` 资源分叉文件</span></footer>
      </section>

      <aside className="inspector">
        <header><div><span>声音检视</span><strong>声音详情</strong></div><b>本地文件</b></header>
        {selected ? <>
          <div className="file-card"><div className={`file-art ${playing ? "active" : ""}`}><span>{selectedFormat}</span><div className="mini-wave">{miniPeaks.length ? miniPeaks.map((peak, index) => <i key={index} style={{ height: `${Math.max(5, peak * 68)}%` }}/>) : <div className="signal-orb"><i/><i/><i/></div>}</div></div><strong>{soundTitle(selected)}</strong>{selected.displayName ? <small>原始文件名 · {selected.name}</small> : <small>{selected.libraryName}</small>}</div>
          <section className="name-lab"><div className="section-title"><span><Icon name="spark" size={13}/>中文显示名</span><em>仅本地索引</em></div><p>只翻译原始文件名；不读取路径、不重命名硬盘文件。</p><label><input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} placeholder="生成或输入中文显示名"/><button onClick={() => void saveNameDraft()} aria-label="保存显示名"><Icon name="edit" size={14}/></button></label><div className="name-actions"><button className="translate-button" disabled={translating} onClick={() => void translateSelected()}><Icon name="spark" size={14}/>{translating ? "生成中…" : "专业释义"}</button><button disabled={!selected.canUndoName} onClick={() => void undoName()}><Icon name="undo" size={14}/>撤回</button><button disabled={!selected.displayName} onClick={() => { setNameDraft(""); void setSoundDisplayName(selected.path, null).then((update) => { applyNameUpdate(selected.path, update); void refreshStats(); }); }}>原名</button></div></section>
          <div className="classification"><label>智能分类</label><strong>{selected.category}</strong><span>{selected.subcategory}</span><p>由文件名与目录语义匹配，仅改变虚拟视图。</p></div>
          <dl><div><dt>时长</dt><dd className="mono">{formatTime(selected.duration)}</dd></div><div><dt>采样率</dt><dd>{selected.sampleRate ? `${selected.sampleRate / 1000} kHz` : "未读取"}</dd></div><div><dt>位深 / 声道</dt><dd>{selected.bitDepth ? `${selected.bitDepth} bit · ` : ""}{channelName(selected.channels)}</dd></div><div><dt>格式 / 大小</dt><dd>{selectedFormat} · {formatBytes(selected.fileSize)}</dd></div><div><dt>试听次数</dt><dd>{selected.playCount.toLocaleString()}</dd></div></dl>
          {selected.tags.length ? <section className="tag-section"><label>语义标签</label><div>{selected.tags.map((tag) => <button key={tag} onClick={() => setQuery(tag)}>{tag}</button>)}</div></section> : null}
          <section className="path-section"><label>真实路径</label><p title={selected.path}>{selected.path}</p></section>
          <div className="inspector-actions"><button className="primary" onClick={() => void locate(selected)}><Icon name="locate" size={16}/>定位原文件</button><button onClick={findSimilar}><Icon name="similar" size={15}/>找相似</button><button className={selected.favorite ? "active" : ""} onClick={() => void toggleFavorite(selected)}><Icon name="heart" size={16}/>{selected.favorite ? "已收藏" : "收藏"}</button></div>
        </> : <div className="no-selection"><Icon name="info" size={26}/><strong>选择一个声音</strong><p>这里会显示真实波形、中文别名、分类和规格。</p></div>}
      </aside>

      <section className="player">
        <div className="now-playing"><button className={selected?.favorite ? "favorite active" : "favorite"} onClick={() => selected && void toggleFavorite(selected)}><Icon name="heart" size={16}/></button><span><small>正在试听</small><strong>{soundTitle(selected)}</strong><em>{selected ? `${selected.category} · ${selectedFormat}` : "添加素材库后开始试听"}</em></span></div>
        <button className="play-button" disabled={!selected} onClick={() => void togglePlay()} aria-label={playing ? "暂停" : "播放"}><Icon name={playing ? "pause" : "play"} size={22}/></button>
        <div className="waveform-wrap"><Waveform peaks={waveform} progress={progress} loading={waveformLoading} disabled={!selected} onSeek={seek}/><div><span className="mono">{formatTime((selected?.duration ?? 0) * progress)}</span><span className="mono">{formatTime(selected?.duration)}</span></div></div>
        <div className="transport-tools"><button className={autoAdvance ? "active" : ""} onClick={() => { setAutoAdvance((value) => !value); setLoopPlayback(false); }} title="播放结束后自动试听下一条"><Icon name="next" size={15}/>连播</button><button className={loopPlayback ? "active" : ""} onClick={() => { setLoopPlayback((value) => !value); setAutoAdvance(false); }} title="循环当前声音"><Icon name="loop" size={14}/>循环</button><button className={pitchSemitones ? "active pitch-button" : "pitch-button"} onClick={cyclePitch} title="切换原速、降六半音、升六半音">音高 {pitchSemitones === 0 ? "原速" : `${pitchSemitones > 0 ? "+" : ""}${pitchSemitones}`}</button><kbd>SPACE</kbd><div className="volume"><Icon name="volume" size={17}/><input aria-label="音量" type="range" min="0" max="1" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))}/></div></div>
      </section>

      {soundLabOpen && selected ? <SoundLab sound={selected} peaks={waveform} onClose={() => setSoundLabOpen(false)} onNotice={showToast}/> : null}
      {scanning ? <div className="scan-overlay"><div className="scan-dialog"><div className="spinner"/><strong>正在建立本地智能索引</strong><p>{scanning.currentFile || "分析文件名与音频规格…"}</p><div className="scan-progress"><span style={{ width: scanning.discovered ? `${Math.min(100, scanning.processed / scanning.discovered * 100)}%` : "12%" }}/></div><small>已处理 {scanning.processed.toLocaleString()} / {scanning.discovered.toLocaleString()} · 音频不会上传</small></div></div> : null}
      {toast ? <div className="toast"><i>✓</i>{toast}</div> : null}
    </main>
  );
}
