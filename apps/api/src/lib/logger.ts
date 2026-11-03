import pino from 'pino';
import { config } from '../config.js';

export const logger = pino({
  level: config.logLevel,
  base: { service: 'orca-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'current_password',
      'new_password',
      'api_key',
      'apiKey',
      'token',
      '*.password',
      '*.api_key',
      '*.token'
    ],
    censor: '[REDACTED]'
  }
});
