class ApiError extends Error {
  constructor(statusCode, message, code = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export default ApiError;
