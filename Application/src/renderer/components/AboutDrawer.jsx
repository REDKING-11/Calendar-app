import React from 'react';
import HeroCard from './HeroCard';

function formatDateTime(value) {
  if (!value) {
    return 'Not yet';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function StatCard({ label, value }) {
  return (
    <div className="settings-stat-card">
      <p className="settings-stat-label">{label}</p>
      <p className="settings-stat-value">{value}</p>
    </div>
  );
}

export default function AboutDrawer({
  isOpen,
  onClose,
  platform,
  deviceId,
  changeCount,
  activeEventCount,
  security,
}) {
  return (
    <aside className={`about-drawer ${isOpen ? 'about-drawer--open' : ''}`} aria-hidden={!isOpen}>
      <section className="about-drawer-panel h-full overflow-auto p-6">
        <div className="about-header">
          <div>
            <p className="eyebrow">About</p>
            <h2 className="settings-page-title">About this app</h2>
            <p className="settings-page-copy">
              Local-first calendar tools, encrypted storage, and optional hosted sync with your own
              backend. Editable sync controls now live in Settings.
            </p>
          </div>
          <button type="button" className="app-button app-button--secondary" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="settings-section-grid mt-6">
          <HeroCard
            platform={platform}
            deviceId={deviceId}
            changeCount={changeCount}
            activeEventCount={activeEventCount}
            security={security}
          />

          <section className="settings-card">
            <p className="settings-section-eyebrow">Security overview</p>
            <h3 className="settings-card-title">Current protection status</h3>
            <div className="settings-stats-grid mt-5">
              <StatCard
                label="Vault mode"
                value={security?.storage?.vault?.protectionMode || 'Unknown'}
              />
              <StatCard
                label="Trusted devices"
                value={security?.devices?.trustedDeviceCount || 0}
              />
              <StatCard label="Audit events" value={security?.audit?.eventCount || 0} />
              <StatCard
                label="Hosted sync"
                value={security?.hosted?.connectionStatus || 'disconnected'}
              />
            </div>
          </section>

          <section className="settings-card">
            <p className="settings-section-eyebrow">Device information</p>
            <h3 className="settings-card-title">Local device snapshot</h3>
            <div className="settings-info-list">
              <div className="settings-info-row">
                <span>Platform</span>
                <strong>{platform}</strong>
              </div>
              <div className="settings-info-row">
                <span>Device ID</span>
                <strong>{deviceId || 'Loading'}</strong>
              </div>
              <div className="settings-info-row">
                <span>Database path</span>
                <strong>{security?.storage?.databasePath || 'Unavailable'}</strong>
              </div>
              <div className="settings-info-row">
                <span>Latest audit event</span>
                <strong>{formatDateTime(security?.audit?.latestEvent?.createdAt)}</strong>
              </div>
            </div>
          </section>

          <section className="settings-card">
            <p className="settings-section-eyebrow">Where to manage things</p>
            <h3 className="settings-card-title">Settings now handles configuration</h3>
            <ul className="settings-bullet-list">
              <li>Appearance options now live in the dedicated Settings window.</li>
              <li>Profile, timezone, and holiday setup are managed from Settings.</li>
              <li>SelfHdb connection, account actions, sync, and .env export moved to Settings.</li>
            </ul>
          </section>
        </div>
      </section>
    </aside>
  );
}
