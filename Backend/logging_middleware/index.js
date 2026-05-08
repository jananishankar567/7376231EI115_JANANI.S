

const TEST_SERVER_LOG_ENDPOINT = process.env.TEST_SERVER_LOG_ENDPOINT || 'http://20.244.56.144/evaluation-service/logs';

/**
 * Log function - Makes API call to Test Server
 * @param {string} stack - Stack identifier (e.g., "request", "response", "error")
 * @param {string} level - Log level (e.g., "info", "warn", "error", "debug")
 * @param {string} package - Package/module name (e.g., "vehicle-scheduler", "notification-service")
 * @param {string} message - Descriptive log message
 */
const Log = async (stack, level, packageName, message) => {
  try {
    const logPayload = {
      stack,
      level,
      package: packageName,
      message,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
    };

    const response = await fetch(TEST_SERVER_LOG_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.ACCESS_TOKEN || ''}`,
      },
      body: JSON.stringify(logPayload),
    });

    if (!response.ok) {
      console.error(`[LocalLog] Failed to send log to Test Server: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    // Fallback to console if Test Server is unavailable
    console.error(`[LocalLog] Error sending log:`, err.message);
    console.log(`[${level.toUpperCase()}] [${packageName}] ${message}`);
  }
};


const createLoggingMiddleware = () => {
  return (req, res, next) => {
    const start = Date.now();
    const requestId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const requestMessage = `[${requestId}] ${req.method} ${req.originalUrl} - IP: ${req.ip}`;
    Log('request', 'info', 'http-middleware', requestMessage).catch(() => {});

    // Capture response
    res.on('finish', () => {
      const duration = Date.now() - start;
      const logLevel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      const responseMessage = `[${requestId}] ${req.method} ${req.originalUrl} - Status: ${res.statusCode} - Duration: ${duration}ms`;

      Log('response', logLevel, 'http-middleware', responseMessage).catch(() => {});
    });

    next();
  };
};


const errorLoggingMiddleware = () => {
  return (err, req, res, next) => {
    const errorMessage = `${req.method} ${req.originalUrl} - ${err.message} - Stack: ${err.stack}`;
    Log('error', 'error', 'error-handler', errorMessage).catch(() => {});

    next(err);
  };
};


const logToServer = Log;

module.exports = {
  Log,
  logToServer,
  createLoggingMiddleware,
  errorLoggingMiddleware,
};
