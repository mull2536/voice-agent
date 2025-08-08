const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom formatter to prevent verbose object logging
const sanitizeMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object') return metadata;
  
  // If metadata is too large, summarize it
  const stringified = JSON.stringify(metadata);
  if (stringified.length > 500) {
    // For large objects, just show keys and truncate values
    const summary = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value === 'string' && value.length > 100) {
        summary[key] = value.substring(0, 100) + '...';
      } else if (typeof value === 'object') {
        summary[key] = `[${typeof value}]`;
      } else {
        summary[key] = value;
      }
    }
    return summary;
  }
  
  return metadata;
};

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    let msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
    
    // Only add metadata if it's not empty and sanitize it
    if (Object.keys(metadata).length > 0) {
      const sanitized = sanitizeMetadata(metadata);
      const metaStr = JSON.stringify(sanitized);
      // Only add if it's meaningful
      if (metaStr !== '{}' && metaStr.length < 500) {
        msg += ` ${metaStr}`;
      }
    }
    
    return msg;
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [
    // Console transport with simplified format
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, ...metadata }) => {
          // For console, just show level and message
          let msg = `${level}: ${message}`;
          
          // Only show critical metadata
          if (metadata.error || metadata.stack) {
            msg += ` ${JSON.stringify({ error: metadata.error, stack: metadata.stack })}`;
          }
          
          return msg;
        })
      )
    }),
    
    // File transport for all logs
    new winston.transports.File({
      filename: path.join(logsDir, 'app.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    
    // File transport for error logs
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ],
  
  // Handle exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log')
    })
  ],
  
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log')
    })
  ]
});

// Add request logging middleware
logger.requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    
    // Only log basic request info
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`
    });
  });
  
  next();
};

module.exports = logger;