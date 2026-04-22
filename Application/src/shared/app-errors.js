const ERROR_CODES = {
  calendarCreate: 'CAL-553',
  calendarUpdate: 'CAL-554',
  calendarDelete: 'CAL-555',
  calendarImportExport: 'CAL-560',
  externalCalendar: 'CAL-570',
  auth: 'AUTH-401',
  hosted: 'HOST-502',
  security: 'SEC-601',
  validation: 'VAL-422',
  unexpected: 'APP-500',
};

const CODED_MESSAGE_PATTERN = /^\[([A-Z]+-\d{3})\]\s*(.*)$/;

function formatCodedMessage(code, message) {
  const safeCode = code || ERROR_CODES.unexpected;
  const safeMessage = String(message || 'An unexpected app error occurred.').trim();
  return `[${safeCode}] ${safeMessage}`;
}

function parseCodedErrorMessage(message = '') {
  const text = String(message || '').trim();
  const match = text.match(CODED_MESSAGE_PATTERN);
  if (!match) {
    return {
      code: '',
      message: text,
      formattedMessage: text,
    };
  }

  return {
    code: match[1],
    message: match[2] || '',
    formattedMessage: text,
  };
}

function createAppError({ code = ERROR_CODES.unexpected, message, cause } = {}) {
  const error = new Error(formatCodedMessage(code, message));
  error.code = code;
  if (cause) {
    error.cause = cause;
  }
  return error;
}

function isValidationError(error) {
  const message = String(error?.message || '');
  return /required|valid|unsupported|cannot be empty|must be|allowed|whole number|end time/i.test(message);
}

function normalizeAppError(error, fallbackCode = ERROR_CODES.unexpected) {
  const parsed = parseCodedErrorMessage(error?.message);
  const code = error?.code || parsed.code || (isValidationError(error) ? ERROR_CODES.validation : fallbackCode);
  const message = parsed.message || error?.message || 'An unexpected app error occurred.';

  if (parsed.code && error?.message === formatCodedMessage(parsed.code, parsed.message)) {
    if (error && !error.code) {
      error.code = parsed.code;
    }
    return error;
  }

  return createAppError({
    code,
    message,
    cause: error,
  });
}

module.exports = {
  ERROR_CODES,
  createAppError,
  formatCodedMessage,
  normalizeAppError,
  parseCodedErrorMessage,
};
