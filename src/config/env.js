import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 3000,
  HOST: process.env.HOST || '0.0.0.0',
  DATABASE_PATH: process.env.DATABASE_PATH || './database/database.sqlite',
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev_session_secret_min_32_characters_long_!',
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'dev_cookie_secret_min_32_characters_long_!',
  BOT_ACESS_API_URL: process.env.BOT_ACESS_API_URL || 'http://localhost:8000',
  BOT_ACESS_API_KEY: process.env.BOT_ACESS_API_KEY || ''
};
