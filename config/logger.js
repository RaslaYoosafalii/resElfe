import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = 'logs';

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

const logger = winston.createLogger({
  level: 'info',

  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(
      info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`
    )
  ),

  transports: [
    new winston.transports.Console(),

    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error'
    }),

    new winston.transports.File({
      filename: path.join(logDir, 'combined.log')
    })
  ]
});

export default logger;