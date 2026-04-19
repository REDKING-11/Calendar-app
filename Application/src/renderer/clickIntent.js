export const DEFAULT_CLICK_INTENT_DELAY_MS = 220;

export function createClickIntentRouter({
  onSingle,
  onDouble,
  delayMs = DEFAULT_CLICK_INTENT_DELAY_MS,
  schedule = (callback, timeout) => window.setTimeout(callback, timeout),
  cancel = (handle) => window.clearTimeout(handle),
}) {
  let pendingHandle = null;

  return {
    handleSingle(payload) {
      if (pendingHandle) {
        cancel(pendingHandle);
      }

      pendingHandle = schedule(() => {
        pendingHandle = null;
        onSingle(payload);
      }, delayMs);
    },

    handleDouble(payload) {
      if (pendingHandle) {
        cancel(pendingHandle);
        pendingHandle = null;
      }

      onDouble(payload);
    },

    cancelPending() {
      if (pendingHandle) {
        cancel(pendingHandle);
        pendingHandle = null;
      }
    },
  };
}
