import { useEffect, useState } from 'react';
import { version as browserAppVersion } from '../../package.json';
import { DesktopActionButton } from '../components/DesktopActionButton';

interface SettingsPageProps {
  desktopApi: UkHousingDesktopApi | null;
}

export function SettingsPage({ desktopApi }: SettingsPageProps) {
  const [appVersion, setAppVersion] = useState(desktopApi ? 'Loading…' : browserAppVersion);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);

  useEffect(() => {
    if (!desktopApi) {
      setAppVersion(browserAppVersion);
      return;
    }
    let cancelled = false;
    async function loadVersion(api: UkHousingDesktopApi) {
      try {
        const version = await api.getAppVersion();
        if (!cancelled) setAppVersion(version);
      } catch {
        if (!cancelled) setAppVersion('Unavailable');
      }
    }
    void loadVersion(desktopApi);
    return () => { cancelled = true; };
  }, [desktopApi]);

  return (
    <div className="settings-page">
      <p className="settings-intro">
        {desktopApi
          ? 'Local files, troubleshooting and application information.'
          : 'Application information for this browser version.'}
      </p>

      {desktopApi && (
        <>
          <section className="settings-section" aria-labelledby="settings-files-heading">
            <h3 id="settings-files-heading">Files</h3>
            <div className="settings-row">
              <h4>Results folder</h4>
              <p className="settings-description">Access saved experiment files for analysis in other software, or copy them to make a backup.</p>
              <DesktopActionButton
                label="Open results folder"
                pendingLabel="Opening folder…"
                action={() => desktopApi.openResultsFolder()}
                failureMessage="Unable to open the results folder."
              />
            </div>
          </section>

          <section className="settings-section" aria-labelledby="settings-support-heading">
            <h3 id="settings-support-heading">Support</h3>
            <div className="settings-row">
              <h4>Support bundle</h4>
              <p className="settings-description">Save recent logs and details of the application's setup in a local folder to send to the developer when reporting a problem. Nothing is sent automatically.</p>
              <DesktopActionButton
                label="Export support bundle"
                pendingLabel="Exporting bundle…"
                action={() => desktopApi.exportSupportBundle()}
                failureMessage="Unable to export a support bundle."
                successMessage={(result) => result.path
                  ? `Support bundle saved to: ${result.path}`
                  : 'Support bundle saved in the application’s support-bundles folder.'}
              />
            </div>
            <div className="settings-row">
              <h4>Logs folder</h4>
              <p className="settings-description">Inspect messages about application startup, simulation progress and errors. Mainly useful for developers investigating a problem.</p>
              <DesktopActionButton
                label="Open logs folder"
                pendingLabel="Opening folder…"
                action={() => desktopApi.openLogsFolder()}
                failureMessage="Unable to open the logs folder."
              />
            </div>
          </section>
        </>
      )}

      <section className="settings-section" aria-labelledby="settings-application-heading">
        <h3 id="settings-application-heading">Application information</h3>
        <dl className="settings-app-info">
          <div><dt>Application version</dt><dd>{appVersion}</dd></div>
          <div><dt>Running in</dt><dd>{desktopApi ? 'Desktop' : 'Browser'}</dd></div>
        </dl>
        {!desktopApi && (
          <p className="settings-note">Folder access and support bundles are available in the desktop application.</p>
        )}
      </section>
    </div>
  );
}
