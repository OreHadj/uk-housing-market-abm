/// <reference types="vite/client" />

interface UkHousingDesktopFolderOpenResult {
  ok: boolean;
  error?: string;
}

interface UkHousingDesktopSupportBundleExportResult {
  ok: boolean;
  path?: string;
  files?: string[];
  error?: string;
}

interface UkHousingDesktopApi {
  getAppVersion: () => Promise<string>;
  getApiAuthToken: () => Promise<string>;
  openResultsFolder: () => Promise<UkHousingDesktopFolderOpenResult>;
  openLogsFolder: () => Promise<UkHousingDesktopFolderOpenResult>;
  exportSupportBundle: () => Promise<UkHousingDesktopSupportBundleExportResult>;
}

interface Window {
  ukHousingDesktop?: UkHousingDesktopApi;
}
