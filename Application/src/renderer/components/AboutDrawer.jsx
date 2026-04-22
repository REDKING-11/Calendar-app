import React from 'react';
import HeroCard from './HeroCard';

function StatCard({ label, value }) {
  return (
    <div className="settings-stat-card">
      <p className="settings-stat-label">{label}</p>
      <p className="settings-stat-value">{value}</p>
    </div>
  );
}

const KEYBOARD_SHORTCUT_GROUPS = [
  {
    title: 'Main app regions',
    items: [
      {
        keys: ['Tab'],
        description: 'Move forward through buttons, inputs, calendar targets, and form controls.',
      },
      {
        keys: ['Shift', 'Tab'],
        description: 'Move backward through focusable controls.',
      },
      {
        keys: ['Ctrl', '1'],
        description: 'Focus the sidebar. Lands on Create first, then search as fallback.',
      },
      {
        keys: ['Ctrl', '2'],
        description: 'Focus the header/calendar controls.',
      },
      {
        keys: ['Ctrl', '3'],
        description: 'Focus the active calendar view.',
      },
    ],
  },
  {
    title: 'Calendar movement',
    items: [
      {
        keys: ['Arrow keys'],
        description: 'Move through Month dates, Week days/time slots, Day time slots, or Year months.',
      },
      {
        keys: ['Home'],
        description: 'Move to the first item in the current calendar row.',
      },
      {
        keys: ['End'],
        description: 'Move to the last item in the current calendar row.',
      },
      {
        keys: ['Ctrl', 'Mouse wheel'],
        description: 'Zoom the Day timeline around the hovered time.',
      },
    ],
  },
  {
    title: 'Create and edit',
    items: [
      {
        keys: ['Enter'],
        description: 'Open quick create on a focused slot/date, quick edit on an event, or open a Year month.',
      },
      {
        keys: ['Space'],
        description: 'Open quick create/edit from focused slots and events where supported.',
      },
      {
        keys: ['Ctrl', 'Enter'],
        description: 'Open the full editor from a focused calendar slot, date, or event.',
      },
      {
        keys: ['Shift', 'Enter'],
        description: 'Also opens the full editor from focused calendar slots, dates, or events.',
      },
    ],
  },
  {
    title: 'Closing and field editing',
    items: [
      {
        keys: ['Escape'],
        description: 'Close quick composer, full editor, sidebar pickers/menus, OAuth tutorial, or revert an active date/time edit.',
      },
      {
        keys: ['Enter'],
        description: 'Commit focused quick date/time text fields.',
      },
      {
        keys: ['Arrow Up'],
        description: 'Increase focused time text fields by 15 minutes.',
      },
      {
        keys: ['Arrow Down'],
        description: 'Decrease focused time text fields by 15 minutes.',
      },
    ],
  },
];

function KeyChip({ children }) {
  return <kbd className="keyboard-shortcut-key">{children}</kbd>;
}

function KeyboardShortcutList() {
  return (
    <div className="keyboard-shortcut-groups">
      {KEYBOARD_SHORTCUT_GROUPS.map((group) => (
        <section key={group.title} className="keyboard-shortcut-group">
          <h4 className="keyboard-shortcut-group-title">{group.title}</h4>
          <div className="keyboard-shortcut-list">
            {group.items.map((item) => (
              <div key={`${group.title}-${item.keys.join('-')}`} className="keyboard-shortcut-row">
                <div className="keyboard-shortcut-keys" aria-label={item.keys.join(' plus ')}>
                  {item.keys.map((key, index) => (
                    <React.Fragment key={`${key}-${index}`}>
                      {index > 0 ? <span className="keyboard-shortcut-plus">+</span> : null}
                      <KeyChip>{key}</KeyChip>
                    </React.Fragment>
                  ))}
                </div>
                <p>{item.description}</p>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export default function AboutDrawer({
  isOpen,
  onClose,
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
              <StatCard label="Active events" value={activeEventCount || 0} />
              <StatCard
                label="Hosted sync"
                value={security?.hosted?.connectionStatus || 'disconnected'}
              />
            </div>
          </section>

          <section className="settings-card">
            <p className="settings-section-eyebrow">Keyboard</p>
            <h3 className="settings-card-title">Keyboard shortcuts</h3>
            <p className="settings-card-copy">
              The app ignores global shortcuts while you are typing in normal text fields.
            </p>
            <KeyboardShortcutList />
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
