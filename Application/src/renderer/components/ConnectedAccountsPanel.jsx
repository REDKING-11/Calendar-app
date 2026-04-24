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
    redirectUri: 'http://localhost:45782/oauth/microsoft/callback',
    redirectUriSource: 'default',
    defaultRedirectUri: 'http://localhost:45782/oauth/microsoft/callback',
    authority: 'common',
    authoritySource: 'default',
    defaultAuthority: 'common',
  },
};

const PROVIDER_ORDER = ['google', 'microsoft'];
const ACCOUNT_BADGE_CLASS =
  'inline-flex min-h-6 items-center rounded-full border border-[var(--border-color)] bg-[var(--accent-soft)] px-2 py-[3px] text-[0.72rem] font-extrabold text-[var(--text-primary)]';
const ACCOUNT_BADGE_MUTED_CLASS = 'bg-[var(--surface-secondary)] text-[var(--text-muted)]';
const EXTERNAL_LINKS = {
  googleCloudConsole: 'https://console.cloud.google.com/',
  googleAuthClients: 'https://console.cloud.google.com/auth/clients',
  googleApiLibrary: 'https://console.cloud.google.com/apis/library',
  googleOAuthHelp: 'https://support.google.com/cloud/answer/6158849?hl=en',
  azureAccount:
    'https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account?icid=get-started-portal',
  azurePortalApps: 'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  entraApps: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  microsoftRedirectHelp: 'https://learn.microsoft.com/entra/identity-platform/how-to-add-redirect-uri',
  microsoftPkceHelp: 'https://learn.microsoft.com/entra/identity-platform/v2-oauth2-auth-code-flow',
};

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
          authority: providerConfig.authority || providerConfig.defaultAuthority || '',
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
  externalCalendarsByAccount = {},
  externalCalendarSources = [],
  onLoadExternalCalendars,
  onImportExternalCalendar,
  externalCalendarBusyId = '',
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
  const savedConfigDraftSignature = useMemo(
    () => JSON.stringify(buildConfigDraft(oauthClientConfig)),
    [oauthClientConfig]
  );

  useEffect(() => {
    setClientConfigDraft(buildConfigDraft(oauthClientConfig));
  }, [savedConfigDraftSignature]);

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

  const saveSetupDraft = async ({ successMessage = 'Connection setup saved.' } = {}) => {
    if (!onSaveOAuthClientConfig) {
      setSetupMessage('Connection setup cannot be saved from this window yet.');
      return false;
    }

    setIsSavingSetup(true);
    setSetupMessage('');
    try {
      await onSaveOAuthClientConfig(clientConfigDraft);
      if (successMessage) {
        setSetupMessage(successMessage);
      }
      return true;
    } catch (error) {
      setSetupMessage(error?.message || 'Connection setup could not be saved.');
      return false;
    } finally {
      setIsSavingSetup(false);
    }
  };

  const handleSaveSetup = async () => {
    await saveSetupDraft({
      successMessage: 'Connection setup saved. You can connect accounts now.',
    });
  };

  const handleConnectProvider = async (providerId) => {
    const label = getProviderLabel(providerId);
    const saved = await saveSetupDraft({
      successMessage: `Connection setup saved. Opening ${label} sign-in...`,
    });
    if (!saved) {
      return;
    }

    onConnectProvider?.(providerId);
  };

  const handleOpenExternalLink = async (url) => {
    try {
      await window.calendarApp?.openExternalLink?.(url);
    } catch (error) {
      setSetupMessage(error?.message || 'That help link could not be opened.');
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
            Connect accounts for online provider features. For a normal .ics or .json file, use
            Calendar file import in Settings instead.
          </p>
        </div>
      </div>

      <div className="rounded-[18px] border border-[var(--border-color)] bg-[var(--surface-secondary)] px-4 py-3.5 text-[0.9rem] leading-[1.55] text-[var(--text-secondary)]">
        <strong className="text-[var(--text-primary)]">What connecting means:</strong> provider
        permissions unlock capabilities. Calendar App still waits for your choices: it does not
        import every remote calendar automatically, and it only writes provider invite events when
        you choose an account and calendar while creating an event.
      </div>

      <div className="flex flex-wrap gap-2.5">
        {supportedProviders.map((provider) => {
          const label = getProviderLabel(provider.id);
          return (
            <button
              key={provider.id}
              type="button"
              className="app-button app-button--secondary"
              disabled={oauthBusyProvider === provider.id || isSavingSetup}
              onClick={() => handleConnectProvider(provider.id)}
              title={
                provider.configured
                  ? `Connect ${label}`
                  : `Add a ${label} OAuth client ID, then Connect will save setup automatically`
              }
            >
              {oauthBusyProvider === provider.id
                ? `Connecting ${label}...`
                : isSavingSetup
                  ? 'Saving setup...'
                  : `Connect ${label}`}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 rounded-[18px] border border-[var(--border-color)] bg-[color-mix(in_srgb,var(--surface-primary)_70%,transparent)] p-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="settings-section-eyebrow">OAuth setup</p>
            <p className="notification-helper-copy">
              Add public desktop OAuth client IDs once. Connect saves the current setup first, then
              opens browser sign-in. Redirect URIs must match your Google Cloud / Azure app
              settings. These settings identify the app to Google or Microsoft; they do not grant
              Calendar App a client secret.
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
                {provider.id === 'microsoft' ? (
                  <>
                    <label className="settings-field">
                      <span>Authority / tenant</span>
                      <input
                        type="text"
                        className="app-input"
                        value={providerDraft.authority || ''}
                        placeholder={provider.clientConfig.defaultAuthority || 'common'}
                        onChange={(event) =>
                          handleSetupFieldChange(provider.id, 'authority', event.target.value)
                        }
                      />
                    </label>
                    <p className="notification-helper-copy m-0">
                      Use <code className="text-[var(--text-primary)]">common</code> for mixed
                      work/personal sign-in, <code className="text-[var(--text-primary)]">organizations</code> for work or school only, <code className="text-[var(--text-primary)]">consumers</code> for personal-only, or your tenant domain/GUID for a single-tenant app.
                    </p>
                  </>
                ) : null}
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
            className="app-subsurface grid max-h-[calc(100vh-48px)] w-[min(1040px,calc(100vw-48px))] gap-4 overflow-auto rounded-[28px] border border-[var(--border-color)] p-[22px] shadow-[0_28px_70px_var(--shadow-color)]"
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
                <p className="notification-helper-copy m-0">
                  Calendar App uses public desktop OAuth clients. The redirect URI has to match
                  exactly in the provider console and in the setup fields below.
                </p>
              </div>
              <button
                type="button"
                className="app-button app-button--secondary"
                onClick={() => setIsTutorialOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] gap-3.5">
              <article className="grid content-start gap-3 rounded-[20px] border border-[var(--border-color)] bg-[var(--surface-secondary)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h4 className="m-0 text-[0.95rem] font-extrabold text-[var(--text-primary)]">Google</h4>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-left text-[0.82rem] font-bold text-[var(--accent)] underline underline-offset-4"
                      onClick={() => handleOpenExternalLink(EXTERNAL_LINKS.googleCloudConsole)}
                    >
                      Cloud Console
                    </button>
                    <button
                      type="button"
                      className="text-left text-[0.82rem] font-bold text-[var(--accent)] underline underline-offset-4"
                      onClick={() => handleOpenExternalLink(EXTERNAL_LINKS.googleAuthClients)}
                    >
                      OAuth clients
                    </button>
                    <button
                      type="button"
                      className="text-left text-[0.82rem] font-bold text-[var(--accent)] underline underline-offset-4"
                      onClick={() => handleOpenExternalLink(EXTERNAL_LINKS.googleApiLibrary)}
                    >
                      API Library
                    </button>
                  </div>
                </div>
                <ol className="m-0 pl-[1.1rem] text-[0.88rem] leading-[1.55] text-[var(--text-secondary)]">
                  <li>Open Google Cloud Console and create or choose the project for this calendar app.</li>
                  <li>If Google asks for it, configure the OAuth consent screen. While the app is in testing, add your Google account as a test user.</li>
                  <li>Open the API Library and enable Google Calendar API. Gmail API / Gmail send access is only needed when you want email reminders.</li>
                  <li>Open OAuth clients / Credentials and create an OAuth client ID for an installed, native, or desktop app. Do not use a service account for personal calendar sign-in.</li>
                  <li>Copy only the OAuth client ID. Do not paste the client secret.</li>
                  <li>Add or keep this exact redirect URI in Calendar App: <code className="break-all text-[var(--text-primary)]">http://127.0.0.1:45781/oauth/google/callback</code></li>
                  <li>Paste the client ID into Calendar App, then press Connect Google. Calendar App saves the setup automatically before opening browser sign-in.</li>
                </ol>
                <div className="rounded-[16px] border border-[var(--border-color)] bg-[var(--surface-muted)] px-3.5 py-3 text-[0.84rem] leading-[1.5] text-[var(--text-secondary)]">
                  <strong className="text-[var(--text-primary)]">Google exact-match checks:</strong> the port must be <code className="text-[var(--text-primary)]">45781</code>, the host must be <code className="text-[var(--text-primary)]">127.0.0.1</code>, the protocol must be <code className="text-[var(--text-primary)]">http</code>, and the path must be <code className="break-all text-[var(--text-primary)]">/oauth/google/callback</code>.
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="text-left text-[0.82rem] font-bold text-[var(--accent)] underline underline-offset-4"
                    onClick={() => handleOpenExternalLink(EXTERNAL_LINKS.googleOAuthHelp)}
                  >
                    Google OAuth client help
                  </button>
                </div>
              </article>

              <article className="grid content-start gap-3 rounded-[20px] border border-[var(--border-color)] bg-[var(--surface-secondary)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <h4 className="m-0 text-[0.95rem] font-extrabold text-[var(--text-primary)]">Outlook / Microsoft</h4>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-left text-[0.82rem] font-bold text-[var(--accent)] underline underline-offset-4"
                      onClick={() => handleOpenExternalLink(EXTERNAL_LINKS.azureAccount)}
                    >
                      Azure account
                    </button>
                    <button
                      type="button"
                      className="text-left text-[0.82rem] font-bold text-[var(--accent)] underline underline-offset-4"
                      onClick={() => handleOpenExternalLink(EXTERNAL_LINKS.azurePortalApps)}
                    >
                      Azure apps
                    </button>
                    <button
                      type="button"
                      className="text-left text-[0.82rem] font-bold text-[var(--accent)] underline underline-offset-4"
                      onClick={() => handleOpenExternalLink(EXTERNAL_LINKS.entraApps)}
                    >
                      Entra apps
                    </button>
                  </div>
                </div>
                <ol className="m-0 pl-[1.1rem] text-[0.88rem] leading-[1.55] text-[var(--text-secondary)]">
                  <li>Create or open an Azure account, then open Azure Portal or Microsoft Entra admin center.</li>
                  <li>Go to App registrations and create or choose the app registration for Calendar App.</li>
                  <li>On the Overview page, copy the Application (client) ID. Do not copy the tenant ID, object ID, client secret, or certificate value.</li>
                  <li>Go to Authentication, choose Add a platform, then choose Mobile and desktop applications. Do not configure only a Web redirect.</li>
                  <li>Add this redirect URI for the simplest portal setup: <code className="break-all text-[var(--text-primary)]">http://localhost:45782/oauth/microsoft/callback</code></li>
                  <li>Make sure Supported account types matches who should sign in. Calendar App authority <code className="text-[var(--text-primary)]">common</code> expects a multitenant app, <code className="text-[var(--text-primary)]">organizations</code> is work/school only, <code className="text-[var(--text-primary)]">consumers</code> is personal-only, and a tenant domain/GUID is for single-tenant apps.</li>
                  <li>Go to API permissions and add delegated Microsoft Graph permissions for <code className="text-[var(--text-primary)]">Calendars.Read</code>, <code className="text-[var(--text-primary)]">Calendars.ReadWrite</code>, and <code className="text-[var(--text-primary)]">Mail.Send</code>. Work or school tenants may need admin consent.</li>
                  <li>Save the Microsoft app changes, paste only the Application (client) ID into Calendar App, leave the Microsoft authority on <code className="text-[var(--text-primary)]">common</code> unless your app registration needs a different audience, then press Connect Outlook.</li>
                </ol>
                <div className="rounded-[16px] border border-[var(--border-color)] bg-[var(--surface-muted)] px-3.5 py-3 text-[0.84rem] leading-[1.5] text-[var(--text-secondary)]">
                  <strong className="text-[var(--text-primary)]">Outlook exact-match checks:</strong> for the normal portal flow, keep <code className="text-[var(--text-primary)]">http://localhost:45782/oauth/microsoft/callback</code> on the Mobile and desktop platform. If you prefer <code className="text-[var(--text-primary)]">127.0.0.1</code>, Microsoft Learn says the HTTP loopback IP version currently needs app-manifest editing instead of the normal Redirect URIs text box.
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="text-left text-[0.82rem] font-bold text-[var(--accent)] underline underline-offset-4"
                    onClick={() => handleOpenExternalLink(EXTERNAL_LINKS.microsoftRedirectHelp)}
                  >
                    Microsoft redirect help
                  </button>
                  <button
                    type="button"
                    className="text-left text-[0.82rem] font-bold text-[var(--accent)] underline underline-offset-4"
                    onClick={() => handleOpenExternalLink(EXTERNAL_LINKS.microsoftPkceHelp)}
                  >
                    Microsoft OAuth flow
                  </button>
                </div>
              </article>
            </div>

            <div className="rounded-[18px] border border-[color-mix(in_srgb,var(--warning-text)_42%,var(--border-color))] bg-[color-mix(in_srgb,var(--warning-text)_10%,var(--surface-secondary))] px-4 py-3.5 text-[0.9rem] leading-[1.55] text-[var(--text-secondary)]">
              <strong className="text-[var(--text-primary)]">What to paste:</strong> paste only public client IDs. Never paste client secrets,
              refresh tokens, authorization codes, exported app data with tokens, tenant secrets, or
              certificate values. Calendar App is designed to stay client-secret-free.
            </div>

            <div className="rounded-[18px] border border-[var(--border-color)] bg-[var(--surface-secondary)] px-4 py-3.5 text-[0.9rem] leading-[1.55] text-[var(--text-secondary)]">
              <strong className="text-[var(--text-primary)]">Why this setup exists:</strong> the client ID tells Google or Microsoft which desktop app is asking to sign in. The redirect URI sends the browser result back to Calendar App on this computer. Read permission lets Calendar App list and import calendars you choose. Write permission lets it create or update provider-backed invite events only when you choose provider invite delivery and a target calendar. Mail send permission is only for email reminders.
            </div>

            <div className="rounded-[18px] border border-[var(--border-color)] bg-[var(--surface-secondary)] px-4 py-3.5 text-[0.9rem] leading-[1.55] text-[var(--text-secondary)]">
              <strong className="text-[var(--text-primary)]">What Calendar App will not do automatically:</strong> it will not read or import all provider calendars just because the account is connected. It will not rewrite your existing Google or Outlook calendars in the background. It will not send real invites unless an event uses provider invite delivery and you select the sending account and calendar.
            </div>

            <div className="rounded-[18px] border border-[var(--border-color)] bg-[var(--surface-secondary)] px-4 py-3.5 text-[0.9rem] leading-[1.55] text-[var(--text-secondary)]">
              <strong className="text-[var(--text-primary)]">Multiple accounts:</strong> one Google client ID can connect many Google
              accounts, and one Microsoft client ID can connect many Outlook accounts. Save the client
              ID once, then press Connect again for each account. If the browser auto-picks the wrong
              account, use the provider account picker, another browser profile, or sign out in the
              browser and try again.
            </div>

            <div className="rounded-[18px] border border-[var(--border-color)] bg-[var(--surface-secondary)] px-4 py-3.5 text-[0.9rem] leading-[1.55] text-[var(--text-secondary)]">
              <strong className="text-[var(--text-primary)]">Troubleshooting:</strong> if Google shows an unverified app warning, add your account as a test user or publish and verify the app later. If Google says access is blocked, check consent screen status, test users, and enabled APIs. If Microsoft shows an <code className="text-[var(--text-primary)]">AADSTS...</code> or <code className="text-[var(--text-primary)]">invalid_request</code> error, check the Mobile and desktop redirect URI, supported account types, Microsoft authority value, delegated permissions, and admin consent. If the local callback page says Calendar connection failed, the browser reached Calendar App and the remaining issue is probably provider configuration or token exchange. If Calendar App stays pending, retry and confirm the browser returned to your configured localhost callback URL.
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
                className="grid gap-3.5 rounded-[18px] border border-[var(--border-color)] bg-[var(--surface-muted)] p-3.5 md:grid-cols-[minmax(0,1fr)_auto]"
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
                <div className="grid justify-items-end gap-2.5">
                  <div className="flex flex-wrap justify-end gap-2.5">
                    <button
                      type="button"
                      className="app-button app-button--secondary"
                      disabled={oauthBusyProvider === account.provider || isSavingSetup}
                      onClick={() => handleConnectProvider(account.provider)}
                    >
                      {oauthBusyProvider === account.provider
                        ? 'Reconnecting...'
                        : isSavingSetup
                          ? 'Saving setup...'
                          : needsReconnect
                            ? 'Reconnect'
                            : 'Reconnect'}
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
                  {account.status === 'connected' ? (
                    <button
                      type="button"
                      className="app-button app-button--secondary"
                      disabled={externalCalendarsByAccount[account.accountId]?.status === 'loading'}
                      onClick={() => onLoadExternalCalendars?.(account.accountId, { force: true })}
                    >
                      {externalCalendarsByAccount[account.accountId]?.status === 'loading'
                        ? 'Loading calendars...'
                        : 'Show calendars to import'}
                    </button>
                  ) : null}
                </div>
                {account.status === 'connected' ? (
                  <div className="col-span-full mt-2 grid gap-2 border-t border-[var(--border-color)] pt-3">
                    {externalCalendarsByAccount[account.accountId]?.error ? (
                      <p className="notification-helper-copy m-0">
                        {externalCalendarsByAccount[account.accountId].error}
                      </p>
                    ) : null}
                    {(externalCalendarsByAccount[account.accountId]?.items || []).length > 0 ? (
                      <div className="grid gap-2">
                        {(externalCalendarsByAccount[account.accountId]?.items || []).map(
                          (calendar) => {
                            const importedSource = externalCalendarSources.find(
                              (source) =>
                                source.accountId === account.accountId &&
                                source.provider === calendar.provider &&
                                source.remoteCalendarId === calendar.remoteCalendarId
                            );
                            const calendarBusyId = `${account.accountId}:${calendar.remoteCalendarId}`;
                            const isCalendarBusy = externalCalendarBusyId === calendarBusyId;
                            return (
                              <div
                                key={calendar.remoteCalendarId}
                                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border-color)] bg-[var(--surface-secondary)] px-3 py-2"
                              >
                                <div>
                                  <p className="m-0 text-[0.9rem] font-extrabold text-[var(--text-primary)]">
                                    {calendar.displayName || 'Calendar'}
                                  </p>
                                  <p className="notification-helper-copy m-0">
                                    {importedSource ? 'Already imported' : 'Ready to import'}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  className="app-button app-button--secondary"
                                  disabled={Boolean(importedSource) || isCalendarBusy}
                                  onClick={() =>
                                    onImportExternalCalendar?.({
                                      accountId: account.accountId,
                                      remoteCalendarId: calendar.remoteCalendarId,
                                    })
                                  }
                                >
                                  {isCalendarBusy
                                    ? 'Importing...'
                                    : importedSource
                                      ? 'Imported'
                                      : 'Import'}
                                </button>
                              </div>
                            );
                          }
                        )}
                      </div>
                    ) : null}
                    {externalCalendarsByAccount[account.accountId]?.status === 'ready' &&
                    (externalCalendarsByAccount[account.accountId]?.items || []).length === 0 ? (
                      <p className="notification-helper-copy m-0">
                        No calendars were returned for this account.
                      </p>
                    ) : null}
                  </div>
                ) : null}
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
