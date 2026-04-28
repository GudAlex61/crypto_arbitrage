import { ExchangeConfig } from './types';
import dotenv from 'dotenv';

dotenv.config();

export const EXCHANGES: ExchangeConfig[] = [
  {
    name: 'Binance',
    wsSpotEndpoint: 'wss://stream.binance.com:9443/ws',
    wsFuturesEndpoint: 'wss://fstream.binance.com/ws',
    restSpotEndpoint: 'https://api.binance.com',
    restFuturesEndpoint: 'https://fapi.binance.com',
  },
  {
    name: 'Bybit',
    wsSpotEndpoint: 'wss://stream.bybit.com/v5/public/spot',
    restSpotEndpoint: 'https://api.bybit.com',
    wsFuturesEndpoint: 'wss://stream.bybit.com/v5/public/linear',
    restFuturesEndpoint: 'https://api.bybit.com'
  },
  {
    name: 'MEXC',
    wsSpotEndpoint: 'wss://wbs-api.mexc.com/ws',
    restSpotEndpoint: 'https://api.mexc.com',
    wsFuturesEndpoint: 'ss://wbs-api.mexc.com/ws',
    restFuturesEndpoint: 'https://api.mexc.com'
  },
];

// Token name mappings between exchanges
export const TOKEN_MAPPINGS: Record<string, Record<string, string>> = {
  'Binance': {
    'QI': 'BENQI',
    'PEOPLE': 'CONSTITUTION',
    'BTTC': 'BTT',
    // Add more mappings as needed
  },
  'MEXC': {
    'BENQI': 'QI',
    'CONSTITUTION': 'PEOPLE',
    'BTT': 'BTTC',
    // Add more mappings as needed
  },
  'Bybit': {
    // Add Bybit specific mappings if needed
  }
};

export const MIN_PROFIT_PERCENTAGE = 0.1; // 0.5%
export const PRICE_UPDATE_INTERVAL = 5 * 1000; // 5 second

// Telegram Configuration
export const TELEGRAM_CONFIG = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || '',
};

export const BLACKLIST = [
    'TST',
    'NEIRO',
];

export const config = {
  // ... existing config ...
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || 'your_redis_password',
  },
  // ... existing config ...
};