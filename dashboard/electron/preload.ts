// Author: Max Stoddard
import { contextBridge, ipcRenderer } from 'electron';

interface DesktopFolderOpenResult {
  ok: boolean;
  error?: string;
}

interface DesktopSupportBundleExportResult {
  ok: boolean;
  path?: string;
  files?: string[];
  error?: string;
}

contextBridge.exposeInMainWorld('ukHousingDesktop', {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('uk-housing-desktop:get-app-version'),
  getApiAuthToken: (): Promise<string> => ipcRenderer.invoke('uk-housing-desktop:get-api-auth-token'),
  openResultsFolder: (): Promise<DesktopFolderOpenResult> => ipcRenderer.invoke('uk-housing-desktop:open-results-folder'),
  openLogsFolder: (): Promise<DesktopFolderOpenResult> => ipcRenderer.invoke('uk-housing-desktop:open-logs-folder'),
  exportSupportBundle: (): Promise<DesktopSupportBundleExportResult> =>
    ipcRenderer.invoke('uk-housing-desktop:export-support-bundle')
});
