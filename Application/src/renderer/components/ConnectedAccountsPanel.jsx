import React, { useEffect, useMemo, useState } from 'react';

const DEFAULT_OAUTH_CLIENT_CONFIG = {
  google: {
    provider: 'google',
    label: 'Google',
    clientId: '',
    clientIdConfigured: false,
    clientIdSource: '',
    redirectUri: 'http://127.0.0.1:45781/oauth/google/callback',
    redirectUriSource: 'default',
    defaultRedirectUri: 'http://127.0.0.1:45781/oauth/google/callback',
  },
  microsoft: {
    provider: 'microsoft',
    label: 'Outlook',
    clientId: '',
    clientIdConfigured: false,
    clientIdSource: '',
    redirectUri: 'http://127.0.0.1:45782/oauth/microsoft/callback',
    redirectUriSource: 'default',
    defaultRedirectUri: 'http://127.0.0.1:45782/oauth/microsoft/callback',
  },
};

const PROVIDER_ORDER = ['google', 'microsoft'];
const ACCOUNT_BADGE_CLASS =
  'inline-flex min-h-6 items-center rounded-full border border-[var(--border-color)] bg-[var(--accent-soft)] px-2 py-[3px] text-[0.72rem] font-extrabold text-[var(--text-primary)]';
const ACCOUNT_BADGE_MUTED_CLASS = 'bg-[var(--surface-secondary)] text-[var(--text-muted)]';

function getProviderLabel(providerId) {
  if (providerId === 'google') {
    return 'Google';
  }
  if (providerId === 'microsoft') {
    return 'Outlook';
  }
  return providerId || 'Provider';
}

function getAccountTitle(account = {}) {
  return account.email || account.displayName || `${getProviderLabel(account.provider)} account`;
}

function buildSupportedProviders(providers = [], oauthClientConfig = {}) {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  return PROVIDER_ORDER.map((providerId) => {
    const fallbackConfig = DEFAULT_OAUTH_CLIENT_CONFIG[providerId];
    const clientConfig = {
      ...fallbackConfig,
      ...(oauthClientConfig?.[providerId] || {}),
    };
    const provider = byId.get(providerId) || {
      id: providerId,
      label: getProviderLabel(providerId),
      configured: Boolean(clientConfig.clientIdConfigured),
    };

    return {
      ...provider,
      label: provider.label || getProviderLabel(providerId),
      configured: Boolean(provider.configured || clientConfig.clientIdConfigured),
      clientConfig,
    };
  });
}

function buildConfigDraft(oauthClientConfig = {}) {
  return Object.fromEntries(
    PROVIDER_ORDER.map((providerId) => {
      const providerConfig = {
        ...DEFAULT_OAUTH_CLIENT_CONFIG[providerId],
        ...(oauthClientConfig?.[providerId] || {}),
      };
      return [
        providerId,
        {
          clientId: providerConfig.clientId || '',
          redirectUri: providerConfig.redirectUri || providerConfig.defaultRedirectUri || '',
        },
      ];
    })
  );
}

export default function ConnectedAccountsPanel({
  connectedAccounts = [],
  providers = [],
  oauthClientConfig = {},
  onConnectProvider,
  onSaveOAuthClientConfig,
  onDisconnectAccount,
  onRevokeAccount,
  oauthBusyProvider = '',
  accountBusyId = '',
  oauthStatusMessage = '',
  compact = false,
}) {
  const supportedProviders = useMemo(
    () => buildSupportedProviders(providers, oauthClientConfig),
    [oauthClientConfig, providers]
  );
  const [clientConfigDraft, setClientConfigDraft] = useState(() =>
    buildConfigDraft(oauthClientConfig)
  );
  const [setupMessage, setSetupMessage] = useState('');
  const [isSavingSetup, setIsSavingSetup] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const hasUnconfiguredProvider = supportedProviders.some((provider) => !provider.configured);

  useEffect(() => {
    setClientConfigDraft(buildConfigDraft(oauthClientConfig));
  }, [oauthClientConfig]);

  useEffect(() => {
    if (!isTutorialOpen) {
      return undefined;
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsTutorialOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isTutorialOpen]);

  const handleSetupFieldChange = (providerId, field, value) => {
    setSetupMessage('');
    setClientConfigDraft((current) => ({
      ...current,
      [providerId]: {
        ...(current[providerId] || {}),
        [field]: value,
      },
    }));
  };

  const handleSaveSetup = async () => {
    if (!onSaveOAuthClientConfig) {
      setSetupMessage('Connection setup cannot be saved from this window yet.');
      return;
    }

    setIsSavingSetup(true);
    setSetupMessage('');
    try {
      await onSaveOAuthClientConfig(clientConfigDraft);
      setSetupMessage('Connection setup saved. You can connect accounts now.');
    } catch (error) {
      setSetupMessage(error?.message || 'Connection setup could not be saved.');
    } finally {
      setIsSavingSetup(false);
    }
  };

  return (
    <section
      className={`grid gap-3.5 ${
        compact
          ? 'rounded-[22px] border border-[var(--border-color)] bg-[var(--surface-secondary)] p-4'
          : ''
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="settings-section-eyebrow">Connected calendar accounts</p>
          <h3 className="m-0 text-base font-extrabold text-[var(--text-primary)]">
            Google and Outlook
          </h3>
          <p className="settings-card-copy">
            Connect multiple accounts for imports, reminders, and real calendar invites.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2.5">
        {supportedProviders.map((provider) => {
          const label = getProviderLabel(provider.id);
          return (
            <button
              key={provider.id}
              type="button"
              className="app-button app-button--secondary"
              disabled={oauthBusyProvider === provider.id}
              onClick={() => onConnectProvider?.(provider.id)}
              title={
                provider.configured
                  ? `Connect ${label}`
                  : `Add and save a ${label} OAuth client ID first`
              }
            >
              {oauthBusyProvider === provider.id ? `Connecting ${label}...` : `Connect ${label}`}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 rounded-[18px] border border-[var(--border-color)] bg-[color-mix(in_srgb,var(--surface-primary)_70%,transparent)] p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="settings-section-eyebrow">OAuth setup</p>
            <p className="notification-helper-copy">
              Add public desktop OAuth client IDs once, then the connect buttons open the browser
              sign-in. Redirect URIs must match your Google Cloud / Azure app settings.
            </p>
          </div>
          <button
            type="button"
            className="app-button app-button--secondary"
            onClick={() => setIsTutorialOpen(true)}
          >
            OAuth ID help
          </button>
          <button
            type="button"
            className="app-button app-button--secondary"
            disabled={isSavingSetup}
            onClick={handleSaveSetup}
          >
            {isSavingSetup ? 'Saving setup...' : 'Save setup'}
          </button>
        </div>
        {hasUnconfiguredProvider ? (
          <p className="settings-inline-warning">
            At least one provider needs a client ID before sign-in can open.
          </p>
        ) : null}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-3">
          {supportedProviders.map((provider) => {
            const label = getProviderLabel(provider.id);
            const providerDraft = clientConfigDraft[provider.id] || {};
            const clientSource = provider.clientConfig.clientIdSource;
            return (
              <article
                key={provider.id}
                className="grid gap-2.5 rounded-2xl border border-[var(--border-color)] bg-[var(--surface-secondary)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <strong>{label}</strong>
                  <span
                    className={`${ACCOUNT_BADGE_CLASS} ${
                      provider.configured ? '' : ACCOUNT_BADGE_MUTED_CLASS
                    }`}
                  >
                    {provider.configured
                      ? clientSource === 'environment'
                        ? 'Configured by env'
                        : 'Configured'
                      : 'Needs client ID'}
                  </span>
                </div>
                <label className="settings-field">
                  <span>{label} client ID</span>
                  <input
                    type="text"
                    className="app-input"
                    value={providerDraft.clientId || ''}
                    placeholder={
                      provider.id === 'google'
                        ? 'Google OAuth client ID'
                        : 'Microsoft application client ID'
                    }
                    onChange={(event) =>
                      handleSetupFieldChange(provider.id, 'clientId', event.target.value)
                    }
                  />
                </label>
                <label className="settings-field">
                  <span>Redirect URI</span>
                  <input
                    type="url"
                    className="app-input"
                    value={providerDraft.redirectUri || ''}
                    placeholder={provider.clientConfig.defaultRedirectUri}
                    onChange={(event) =>
                      handleSetupFieldChange(provider.id, 'redirectUri', event.target.value)
                    }
                  />
                </label>
              </article>
            );
          })}
        </div>
        {setupMessage ? <p className="notification-helper-copy">{setupMessage}</p> : null}
      </div>

      {isTutorialOpen ? (
        <div
          className="fixed inset-0 z-[1200] flex items-center justify-center bg-[rgba(5,10,20,0.58)] p-6 backdrop-blur-[14px]"
          role="presentation"
          onClick={() => setIsTutorialOpen(false)}
        >
          <section
            className="app-subsurface grid max-h-[calc(100vh-48px)] w-[min(880px,calc(100vw-48px))] gap-4 overflow-auto rounded-[28px] border border-[var(--border-color)] p-[22px] shadow-[0_28px_70px_var(--shadow-color)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="oauth-tutorial-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="settings-section-eyebrow">Connection tutorial</p>
                <h3
                  id="oauth-tutorial-title"
                  className="m-0 text-base font-extrabold text-[var(--text-primary)]"
                >
                  Finding your OAuth client IDs
                </h3>
              </div>
              <button
                type="button"
                className="app-button app-button--secondary"
                onClick={() => setIsTutorialOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3.5">
              <article className="grid gap-2.5 rounded-[20px] border border-[var(--border-color)] bg-[var(--surface-secondary)] p-4">
                <h4 className="m-0 text-[0.95rem] font-extrabold text-[var(--text-primary)]">Google</h4>
                <ol className="m-0 pl-[1.1rem] text-[0.88rem] leading-[1.55] text-[var(--text-secondary)]">
                  <li>Open Google Cloud Console and create or choose a project.</li>
                  <li>Enable the Google Calendar API. Gmail send is needed for email reminders.</li>
                  <li>Create an OAuth client for a desktop or native app.</li>
                  <li>Add this redirect URI: <code className="break-all text-[var(--text-primary)]">http://127.0.0.1:45781/oauth/google/callback</code></li>
                  <li>Paste only the client ID into Calendar App, then press Connect Google.</li>
                </ol>
              </article>

              <article className="grid gap-2.5 rounded-[20px] border border-[var(--border-color)] bg-[var(--surface-secondary)] p-4">
                <h4 className="m-0 text-[0.95rem] font-extrabold text-[var(--text-primary)]">Outlook / Microsoft</h4>
                <ol className="m-0 pl-[1.1rem] text-[0.88rem] leading-[1.55] text-[var(--text-secondary)]">
                  <li>Open Azure Portal, then App registrations, and create or choose an app.</li>
                  <li>Add delegated permissions for calendars. Mail send is needed for email reminders.</li>
                  <li>Add this redirect URI as a public client/native redirect: <code className="break-all text-[var(--text-primary)]">http://127.0.0.1:45782/oauth/microsoft/callback</code></li>
                  <li>Copy the Application client ID.</li>
                  <li>Paste only that client ID into Calendar App, then press Connect Outlook.</li>
                </ol>
              </article>
            </div>

            <div className="rounded-[18px] border border-[color-mix(in_srgb,var(--warning-text)_42%,var(--border-color))] bg-[color-mix(in_srgb,var(--warning-text)_10%,var(--surface-secondary))] px-4 py-3.5 text-[0.9rem] leading-[1.55] text-[var(--text-secondary)]">
              <strong className="text-[var(--text-primary)]">Safety note:</strong> do not paste a client secret here. Calendar App only needs
              public desktop client IDs. Never share client secrets, refresh tokens, auth codes, or
              exported app data with tokens inside it.
            </div>

            <div className="rounded-[18px] border border-[var(--border-color)] bg-[var(--surface-secondary)] px-4 py-3.5 text-[0.9rem] leading-[1.55] text-[var(--text-secondary)]">
              <strong className="text-[var(--text-primary)]">Multiple accounts:</strong> one Google client ID can connect many Google
              accounts, and one Microsoft client ID can connect many Outlook accounts. Save the client
              ID once, then press Connect again for each account. If the browser auto-picks the wrong
              account, use the provider account picker, another browser profile, or sign out in the
              browser and try again.
            </div>
          </section>
        </div>
      ) : null}

      {connectedAccounts.length > 0 ? (
        <div className="grid gap-2.5">
          {connectedAccounts.map((account) => {
            const label = getProviderLabel(account.provider);
            const isBusy = accountBusyId === account.accountId;
            const needsReconnect =
              account.status !== 'connected' || !account.canWrite || !account.writeScopeGranted;
            return (
              <article
                key={account.accountId}
                className="flex items-center justify-between gap-3.5 rounded-[18px] border border-[var(--border-color)] bg-[var(--surface-muted)] p-3.5"
              >
                <div>
                  <p className="m-0 mb-1 text-[0.72rem] font-extrabold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                    {label}
                  </p>
                  <h4 className="m-0 text-[0.98rem] font-extrabold text-[var(--text-primary)]">
                    {getAccountTitle(account)}
                  </h4>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span
                      className={`${ACCOUNT_BADGE_CLASS} ${
                        account.status === 'disconnected' ? ACCOUNT_BADGE_MUTED_CLASS : ''
                      }`}
                    >
                      {account.status || 'unknown'}
                    </span>
                    <span
                      className={`${ACCOUNT_BADGE_CLASS} ${
                        account.canWrite ? '' : ACCOUNT_BADGE_MUTED_CLASS
                      }`}
                    >
                      {account.canWrite ? 'Calendar write' : 'Read only'}
                    </span>
                    <span
                      className={`${ACCOUNT_BADGE_CLASS} ${
                        account.mailScopeGranted ? '' : ACCOUNT_BADGE_MUTED_CLASS
                      }`}
                    >
                      {account.mailScopeGranted ? 'Mail send' : 'No mail send'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    className="app-button app-button--secondary"
                    disabled={oauthBusyProvider === account.provider}
                    onClick={() => onConnectProvider?.(account.provider)}
                  >
                    {needsReconnect ? 'Reconnect' : 'Reconnect'}
                  </button>
                  <button
                    type="button"
                    className="app-button app-button--secondary"
                    disabled={isBusy || account.status !== 'connected'}
                    onClick={() => onDisconnectAccount?.(account.accountId)}
                  >
                    Disconnect
                  </button>
                  <button
                    type="button"
                    className="app-button app-danger-button"
                    disabled={isBusy}
                    onClick={() => onRevokeAccount?.(account.accountId)}
                  >
                    Revoke
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="notification-helper-copy">
          No calendar accounts connected yet. You can add Google or Outlook now and add more later.
        </p>
      )}

      {oauthStatusMessage ? <p className="notification-helper-copy">{oauthStatusMessage}</p> : null}
    </section>
  );
}
