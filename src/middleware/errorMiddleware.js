export function errorHandler(err, req, res, _next) {
  if (err.code === "LIMIT_FILE_SIZE") {
    const isVoiceTranscription = req.originalUrl?.includes("/voice/transcribe");
    return res.status(400).json({
      success: false,
      message: isVoiceTranscription ? "Audio file is too large" : "Uploaded file is too large",
      data: {},
      code: isVoiceTranscription ? "AUDIO_TOO_LARGE" : "UPLOAD_TOO_LARGE",
    });
  }

  const databaseUnavailable = ["MongoNetworkError", "MongoServerSelectionError", "MongooseServerSelectionError"].includes(err.name);
  const statusCode = databaseUnavailable ? 503 : err.statusCode || 500;

  const exposeMessage = statusCode < 500 || process.env.NODE_ENV !== "production";
  return res.status(statusCode).json({
    success: false,
    message: databaseUnavailable ? "The service is temporarily unavailable. Please try again shortly." : exposeMessage ? (err.message || "Internal server error") : "Internal server error",
    data: {},
    ...(err.code ? { code: err.code } : {}),
  });
}
