class ApiError extends Error {
  constructor(statusCode, message, code = 'api_error', details = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function assert(condition, statusCode, message, code = 'bad_request', details = null) {
  if (!condition) {
    throw new ApiError(statusCode, message, code, details);
  }
}

module.exports = {
  ApiError,
  assert,
};
