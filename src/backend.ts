import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { resolveResource } from "@tauri-apps/api/path";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import type { FileExport, LibraryStats, ScanSummary, SearchRequest, Sound, SoundLabExport, SoundLabSettings, SoundNameUpdate } from "./types";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const isDesktop = () => typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

export async function chooseLibraryFolder() {
  if (!isDesktop()) return null;
  const result = await open({ directory: true, multiple: false, title: "选择音效素材库文件夹" });
  return typeof result === "string" ? result : null;
}

export async function scanLibrary(path: string) {
  return invoke<ScanSummary>("scan_library", { path });
}

export async function searchSounds(request: SearchRequest) {
  return invoke<Sound[]>("search_sounds", { request });
}

export async function getStats() {
  return invoke<LibraryStats>("get_library_stats");
}

export async function setFavorite(path: string, favorite: boolean) {
  return invoke<void>("set_favorite", { path, favorite });
}

export async function removeLibrary(path: string) {
  return invoke<void>("remove_library", { path });
}

export async function revealSound(path: string) {
  await invoke<void>("reveal_in_file_manager", { path });
}

export async function getWaveform(path: string, bins = 220) {
  return invoke<number[]>("get_waveform", { path, bins });
}

export async function translateSoundName(path: string, originalName: string) {
  return invoke<SoundNameUpdate>("translate_sound_name", { path, originalName });
}

export async function setSoundDisplayName(path: string, displayName: string | null) {
  return invoke<SoundNameUpdate>("set_sound_display_name", { path, displayName });
}

export async function undoSoundDisplayName(path: string) {
  return invoke<SoundNameUpdate>("undo_sound_display_name", { path });
}

export async function recordSoundPlayed(path: string) {
  return invoke<void>("record_sound_played", { path });
}

export async function dragSoundOutside(path: string, onResult?: (result: "Dropped" | "Cancelled") => void) {
  const icon = await resolveResource("icons/128x128.png");
  await startDrag({ item: [path], icon, mode: "copy" }, (payload) => onResult?.(payload.result));
}

export async function exportSelectedSound(inputPath: string) {
  const filename = inputPath.split(/[\\/]/).pop() || "声屿导出音频.wav";
  const extension = filename.includes(".") ? filename.split(".").pop() || "wav" : "wav";
  const outputPath = await save({
    title: "导出所选音频副本",
    defaultPath: filename,
    filters: [{ name: `${extension.toUpperCase()} 音频`, extensions: [extension] }],
  });
  if (!outputPath) return null;
  return invoke<FileExport>("export_selected_sound", { inputPath, outputPath });
}

export async function exportSoundLabAudio(inputPath: string, settings: SoundLabSettings) {
  const stem = inputPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "声屿处理音频";
  const outputPath = await save({
    title: "导出声音实验室处理结果",
    defaultPath: `${stem}_声屿实验室.wav`,
    filters: [{ name: "WAV 音频", extensions: ["wav"] }],
  });
  if (!outputPath) return null;
  return invoke<SoundLabExport>("export_sound_lab_audio", { inputPath, outputPath, settings });
}

export function audioSource(path: string) {
  return convertFileSrc(path);
}
