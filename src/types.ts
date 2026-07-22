export type Category =
  | "环境 Ambience"
  | "拟音 Foley"
  | "硬音效 Hard FX"
  | "界面 UI"
  | "生物 Creature"
  | "交通 Vehicles"
  | "武器 Weapons"
  | "设计音 Design"
  | "未分类";

export type Sound = {
  path: string;
  name: string;
  displayName?: string | null;
  canUndoName: boolean;
  extension: string;
  fileSize: number;
  modifiedAt: number;
  category: Category;
  subcategory: string;
  tags: string[];
  libraryPath: string;
  libraryName: string;
  favorite: boolean;
  duration?: number | null;
  sampleRate?: number | null;
  channels?: number | null;
  bitDepth?: number | null;
  lastPlayedAt?: number | null;
  playCount: number;
};

export type Library = {
  path: string;
  name: string;
  soundCount: number;
  addedAt: number;
  childFolders: LibraryFolder[];
};

export type LibraryFolder = {
  path: string;
  name: string;
  soundCount: number;
};

export type LibraryStats = {
  total: number;
  totalBytes: number;
  favorites: number;
  categories: Record<string, number>;
  subcategories: Record<string, Record<string, number>>;
  smartCollections: Record<string, number>;
  libraries: Library[];
};

export type SearchRequest = {
  query: string;
  scope?: "all" | "name" | "category" | "tags" | "path";
  category?: string | null;
  subcategory?: string | null;
  collection?: string | null;
  favoritesOnly: boolean;
  libraryPath?: string | null;
  folderPath?: string | null;
  limit: number;
  offset: number;
};

export type SoundLabSettings = {
  preset: string;
  lowGainDb: number;
  midGainDb: number;
  highGainDb: number;
  reverbMix: number;
  delayMix: number;
  delayMs: number;
  delayFeedback: number;
  distortion: number;
  outputGainDb: number;
};

export type SoundLabExport = {
  outputPath: string;
  duration: number;
  sampleRate: number;
  channels: number;
};

export type SoundNameUpdate = {
  displayName?: string | null;
  canUndoName: boolean;
};

export type ScanSummary = {
  libraryPath: string;
  libraryName: string;
  scanned: number;
  added: number;
  updated: number;
  skipped: number;
};

export type ScanProgress = {
  libraryPath: string;
  processed: number;
  discovered: number;
  currentFile: string;
};
