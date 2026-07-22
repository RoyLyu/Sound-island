import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { LibraryStats, ScanSummary, SearchRequest, Sound, SoundNameUpdate } from "./types";

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

export async function translateSoundName(path: string) {
  return invoke<SoundNameUpdate>("translate_sound_name", { path });
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

export function audioSource(path: string) {
  return convertFileSrc(path);
}
