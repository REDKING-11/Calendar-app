import React, { useState } from 'react';

function DebugRow({ label, value }) {
  return (
    <div className="debug-panel-row">
      <span>{label}</span>
      <strong>{value === undefined || value === null || value === '' ? 'none' : String(value)}</strong>
    </div>
  );
}

export default function DebugPanel({
  debugSnapshot,
  onOpenSetup,
  onOpenSettings,
  onOpenAbout,
  onOpenComposer,
  onOpenUpcoming,
  onRefreshSnapshot,
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const app = debugSnapshot?.app || {};
  const ui = debugSnapshot?.ui || {};
  const data = debugSnapshot?.data || {};
  const integrations = debugSnapshot?.integrations || {};
  const lastAppError = debugSnapshot?.lastAppError || null;

  const handleCopySnapshot = async () => {
    const text = JSON.stringify(debugSnapshot || {}, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('Debug snapshot copied.');
    } catch {
      setCopyStatus('Clipboard copy failed.');
    }
  };

  return (
    <section className="debug-panel app-subsurface" aria-label="Developer debug panel">
      <div className="debug-panel-header">
        <div>
          <p className="settings-section-eyebrow">Developer mode</p>
          <h2 className="debug-panel-title">Debug controls</h2>
        </div>
        <span className="app-pill">Ctrl+Alt+D</span>
      </div>

      <div className="debug-panel-actions">
        <button type="button" className="app-button app-button--secondary" onClick={onOpenSetup}>
          Open first setup
        </button>
        <button type="button" className="app-button app-button--secondary" onClick={onOpenSettings}>
          Open Settings
        </button>
        <button type="button" className="app-button app-button--secondary" onClick={onOpenAbout}>
          Open About
        </button>
        <button type="button" className="app-button app-button--secondary" onClick={onOpenComposer}>
          Open full event editor
        </button>
        <button type="button" className="app-button app-button--secondary" onClick={onOpenUpcoming}>
          Open upcoming
        </button>
        <button type="button" className="app-button app-button--secondary" onClick={onRefreshSnapshot}>
          Refresh snapshot
        </button>
        <button type="button" className="app-button app-button--primary" onClick={handleCopySnapshot}>
          Copy debug snapshot
        </button>
      </div>

      {copyStatus ? <p className="settings-inline-warning">{copyStatus}</p> : null}

      <div className="debug-panel-grid">
        <div className="debug-panel-card">
          <h3>App</h3>
          <DebugRow label="Window mode" value={app.windowMode} />
          <DebugRow label="Setup complete" value={app.setupComplete} />
          <DebugRow label="Calendar view" value={ui.calendarView} />
          <DebugRow label="Selected date" value={ui.selectedDate} />
          <DebugRow label="Theme" value={`${app.themeMode || 'system'} / ${app.theme || 'unknown'}`} />
          <DebugRow label="Background motion" value={app.backgroundMotion ? 'on' : 'off'} />
        </div>

        <div className="debug-panel-card">
          <h3>Data</h3>
          <DebugRow label="Total events" value={data.totalEvents} />
          <DebugRow label="Active events" value={data.activeEvents} />
          <DebugRow label="Visible events" value={ui.visibleEventCount} />
          <DebugRow label="Tags" value={data.tags || ui.tagCount} />
          <DebugRow label="Stored changes" value={data.storedChanges} />
          <DebugRow label="External sources" value={data.externalSources} />
        </div>

        <div className="debug-panel-card">
          <h3>Integrations</h3>
          <DebugRow label="Connected accounts" value={integrations.connectedAccountCount} />
          <DebugRow label="Hosted sync" value={integrations.hostedSyncStatus} />
          <DebugRow label="Hosted busy action" value={integrations.hostedBusyAction} />
          <DebugRow label="OAuth busy provider" value={integrations.oauthBusyProvider} />
          <DebugRow label="OAuth polling" value={integrations.oauthPollingActive ? 'active' : 'idle'} />
          <DebugRow label="Holiday preload" value={integrations.holidayPreloadState?.status} />
        </div>

        <div className="debug-panel-card">
          <h3>Last error</h3>
          <DebugRow label="Code" value={lastAppError?.code} />
          <DebugRow label="Source" value={lastAppError?.source} />
          <DebugRow label="Time" value={lastAppError?.timestamp} />
          <p className="debug-panel-error">{lastAppError?.message || 'No app error recorded.'}</p>
        </div>
      </div>
    </section>
  );
}
