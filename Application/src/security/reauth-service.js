const crypto = require('node:crypto');

function nowMs() {
  return Date.now();
}

class ReauthService {
  constructor() {
    this.pendingChallenges = new Map();
    this.approvedActions = new Map();
    this.challengeLifetimeMs = 5 * 60 * 1000;
    this.approvalLifetimeMs = 10 * 60 * 1000;
  }

  pruneExpiredEntries() {
    const now = nowMs();

    for (const [challengeId, challenge] of this.pendingChallenges.entries()) {
      if (challenge.expiresAt <= now) {
        this.pendingChallenges.delete(challengeId);
      }
    }

    for (const [approvalId, approval] of this.approvedActions.entries()) {
      if (approval.expiresAt <= now) {
        this.approvedActions.delete(approvalId);
      }
    }
  }

  begin(action) {
    this.pruneExpiredEntries();

    const challengeId = crypto.randomUUID();
    const confirmationPhrase = `APPROVE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const expiresAt = nowMs() + this.challengeLifetimeMs;

    this.pendingChallenges.set(challengeId, {
      action,
      confirmationPhrase,
      expiresAt,
    });

    return {
      challengeId,
      action,
      confirmationPhrase,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  complete(challengeId, response) {
    this.pruneExpiredEntries();
    const challenge = this.pendingChallenges.get(challengeId);
    if (!challenge) {
      throw new Error('Reauthentication challenge not found or expired.');
    }

    if (String(response || '').trim() !== challenge.confirmationPhrase) {
      throw new Error('Reauthentication response did not match the approval phrase.');
    }

    this.pendingChallenges.delete(challengeId);

    const approvalId = crypto.randomUUID();
    const expiresAt = nowMs() + this.approvalLifetimeMs;
    this.approvedActions.set(approvalId, {
      action: challenge.action,
      expiresAt,
    });

    return {
      approvalId,
      action: challenge.action,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  consumeApproval(action, approvalId) {
    this.pruneExpiredEntries();
    const approval = this.approvedActions.get(approvalId);
    if (!approval || approval.action !== action) {
      throw new Error(`A fresh reauthentication approval is required for ${action}.`);
    }

    this.approvedActions.delete(approvalId);
    return true;
  }
}

module.exports = { ReauthService };
