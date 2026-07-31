export function errorHandler(err, _req, res, _next) {
  const statusCode = err.statusCode || 500;
  const message = statusCode >= 500 ? "Internal server error" : err.message || "Internal server error";

  res.status(statusCode).json({
    success: false,
    message,
    errors: err.errors || {},
    data: {},
  });
}
