function resolveReminderScope(syncPolicy = 'internal_only', visibility = 'private') {
  if (String(visibility || '').toLowerCase() === 'private') {
    return 'internal';
  }

  const normalizedSyncPolicy = String(syncPolicy || '').toLowerCase();
  if (normalizedSyncPolicy === 'google_sync') {
    return 'work';
  }
  if (normalizedSyncPolicy === 'microsoft_sync') {
    return 'personal';
  }

  return 'internal';
}

function buildTimeLabel(dateValue) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(dateValue));
}

function buildDesktopBody(event) {
  const pieces = [`${buildTimeLabel(event.startsAt)} - ${buildTimeLabel(event.endsAt)}`];
  if (event.location) {
    pieces.push(event.location);
  }

  return pieces.join('  ');
}

function buildEmailBody(event) {
  const lines = [
    `Reminder: ${event.title}`,
    '',
    `Starts: ${new Date(event.startsAt).toLocaleString()}`,
    `Ends: ${new Date(event.endsAt).toLocaleString()}`,
  ];

  if (event.location) {
    lines.push(`Location: ${event.location}`);
  }

  if (event.description) {
    lines.push('', event.description);
  }

  return lines.join('\n');
}

function buildDispatchChannel(baseChannel, notificationId = '') {
  return notificationId ? `${baseChannel}:${notificationId}` : baseChannel;
}

class ReminderService {
  constructor({
    store,
    oauthService,
    NotificationClass,
    pollIntervalMs = 30 * 1000,
    gracePeriodMinutes = 5,
    now = () => new Date(),
    setIntervalImpl = global.setInterval,
    clearIntervalImpl = global.clearInterval,
  }) {
    this.store = store;
    this.oauthService = oauthService;
    this.NotificationClass = NotificationClass;
    this.pollIntervalMs = pollIntervalMs;
    this.gracePeriodMinutes = gracePeriodMinutes;
    this.now = now;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.intervalHandle = null;
    this.isPolling = false;
  }

  start() {
    if (this.intervalHandle) {
      return;
    }

    this.intervalHandle = this.setIntervalImpl(() => {
      void this.pollDueReminders();
    }, this.pollIntervalMs);

    void this.pollDueReminders();
  }

  stop() {
    if (this.intervalHandle) {
      this.clearIntervalImpl(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async pollDueReminders() {
    if (this.isPolling) {
      return;
    }

    this.isPolling = true;

    try {
      const dueEntries = this.store.listDueReminderEntries({
        now: this.now(),
        gracePeriodMinutes: this.gracePeriodMinutes,
      });

      for (const entry of dueEntries) {
        try {
          await this.dispatchReminderEntry(entry);
        } catch {
          // Keep polling remaining reminders even if one delivery fails.
        }
      }
    } finally {
      this.isPolling = false;
    }
  }

  showDesktopReminder(entry) {
    if (!this.NotificationClass) {
      return;
    }

    if (typeof this.NotificationClass.isSupported === 'function' && !this.NotificationClass.isSupported()) {
      return;
    }

    const notification = new this.NotificationClass({
      title: entry.title,
      body: buildDesktopBody(entry),
      silent: false,
    });
    notification.show();
  }

  async dispatchReminderEntry(entry) {
    const reminderAt = entry.reminderAt;
    const desktopDispatchChannel = buildDispatchChannel('desktop', entry.notificationId);
    const emailDispatchChannel = buildDispatchChannel('email', entry.notificationId);

    if (entry.desktopNotificationEnabled) {
      const alreadySentDesktop = this.store.hasReminderDispatch({
        eventId: entry.id,
        channel: desktopDispatchChannel,
        recipient: '',
        reminderAt,
      });

      if (!alreadySentDesktop) {
        this.showDesktopReminder(entry);
        this.store.recordReminderDispatch({
          eventId: entry.id,
          channel: desktopDispatchChannel,
          recipient: '',
          reminderAt,
          sentAt: this.now().toISOString(),
        });
      }
    }

    if (entry.emailNotificationEnabled && Array.isArray(entry.emailNotificationRecipients)) {
      const recipientsToSend = entry.emailNotificationRecipients.filter((recipient) => {
        return !this.store.hasReminderDispatch({
          eventId: entry.id,
          channel: emailDispatchChannel,
          recipient,
          reminderAt,
        });
      });

      if (recipientsToSend.length > 0) {
        const scope = resolveReminderScope(entry.syncPolicy, entry.visibility);
        await this.oauthService.sendReminderEmail({
          scope,
          recipients: recipientsToSend,
          subject: `Reminder: ${entry.title}`,
          bodyText: buildEmailBody(entry),
        });

        const sentAt = this.now().toISOString();
        for (const recipient of recipientsToSend) {
          this.store.recordReminderDispatch({
            eventId: entry.id,
            channel: emailDispatchChannel,
            recipient,
            reminderAt,
            sentAt,
          });
        }
      }
    }
  }
}

module.exports = {
  ReminderService,
  resolveReminderScope,
};
