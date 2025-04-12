import { ExchangeConfig } from './types';
import dotenv from 'dotenv';

dotenv.config();

export const EXCHANGES: ExchangeConfig[] = [
  {
    name: 'Binance',
    wsEndpoint: 'wss://stream.binance.com:9443/ws',
    restEndpoint: 'https://api.binance.com',
  },
  {
    name: 'Bybit',
    wsEndpoint: 'wss://stream.bybit.com/v5/public/spot',
    restEndpoint: 'https://api.bybit.com',
  },
  // {
  //   name: 'MEXC',
  //   wsEndpoint: 'wss://wbs.mexc.com/ws',
  //   restEndpoint: 'https://api.mexc.com',
  // },
];

export const MIN_PROFIT_PERCENTAGE = 0.7; // 0.5%
export const PRICE_UPDATE_INTERVAL = 1000; // 1 second

// Telegram Configuration
export const TELEGRAM_CONFIG = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || '',
};

export const BLACKLIST = [
    'TST',
    'NEIRO',
];