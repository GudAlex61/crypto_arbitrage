import dotenv from 'dotenv';
import { ExchangeConfig } from './types';

dotenv.config();

const COMMON_WITHDRAWAL_FEES: Record<string, number> = {
  USDT: 1.0,
  BTC: 0.0004 * 65_000,
  ETH: 0.005 * 3_500,
  BNB: 0.0005 * 600,
  SOL: 0.01 * 170,
  XRP: 0.25 * 0.6,
  DOGE: 5 * 0.15,
  ADA: 1.0,
  AVAX: 0.01 * 35,
  MATIC: 0.1 * 0.9,
  POL: 0.1 * 0.9,
  DOT: 0.1 * 7,
  LINK: 0.3 * 18,
  UNI: 0.3 * 10,
  ATOM: 0.005 * 10,
  LTC: 0.001 * 85,
};

const enabledExchangeNames = (process.env.ENABLED_EXCHANGES || '')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

const allExchanges: ExchangeConfig[] = [
  {
    name: 'Binance',
    wsSpotEndpoint: 'wss://stream.binance.com:9443/ws',
    wsFuturesEndpoint: 'wss://fstream.binance.com/ws',
    restSpotEndpoint: 'https://api.binance.com',
    restFuturesEndpoint: 'https://fapi.binance.com',
    fees: { takerFee: 0.1, makerFee: 0.1, withdrawalFees: COMMON_WITHDRAWAL_FEES },
  },
  {
    name: 'Bybit',
    wsSpotEndpoint: 'wss://stream.bybit.com/v5/public/spot',
    wsFuturesEndpoint: 'wss://stream.bybit.com/v5/public/linear',
    restSpotEndpoint: 'https://api.bybit.com',
    restFuturesEndpoint: 'https://api.bybit.com',
    fees: { takerFee: 0.1, makerFee: 0.1, withdrawalFees: COMMON_WITHDRAWAL_FEES },
  },
  {
    name: 'OKX',
    wsSpotEndpoint: 'wss://ws.okx.com:8443/ws/v5/public',
    wsFuturesEndpoint: 'wss://ws.okx.com:8443/ws/v5/public',
    restSpotEndpoint: 'https://www.okx.com',
    restFuturesEndpoint: 'https://www.okx.com',
    fees: { takerFee: 0.1, makerFee: 0.08, withdrawalFees: COMMON_WITHDRAWAL_FEES },
  },
  {
    name: 'Gate',
    wsSpotEndpoint: 'wss://api.gateio.ws/ws/v4/',
    wsFuturesEndpoint: 'wss://fx-ws.gateio.ws/v4/ws/usdt',
    restSpotEndpoint: 'https://api.gateio.ws',
    restFuturesEndpoint: 'https://api.gateio.ws',
    fees: { takerFee: 0.2, makerFee: 0.2, withdrawalFees: COMMON_WITHDRAWAL_FEES },
  },
  {
    name: 'KuCoin',
    wsSpotEndpoint: '',
    wsFuturesEndpoint: '',
    restSpotEndpoint: 'https://api.kucoin.com',
    restFuturesEndpoint: 'https://api-futures.kucoin.com',
    fees: { takerFee: 0.1, makerFee: 0.1, withdrawalFees: COMMON_WITHDRAWAL_FEES },
  },
  {
    name: 'MEXC',
    wsSpotEndpoint: '',
    wsFuturesEndpoint: '',
    restSpotEndpoint: 'https://api.mexc.com',
    restFuturesEndpoint: 'https://contract.mexc.com',
    fees: { takerFee: 0.1, makerFee: 0.1, withdrawalFees: COMMON_WITHDRAWAL_FEES },
  },
  {
    name: 'Bitget',
    wsSpotEndpoint: '',
    wsFuturesEndpoint: '',
    restSpotEndpoint: 'https://api.bitget.com',
    restFuturesEndpoint: 'https://api.bitget.com',
    fees: { takerFee: 0.1, makerFee: 0.1, withdrawalFees: COMMON_WITHDRAWAL_FEES },
  },
];

export const EXCHANGES: ExchangeConfig[] = enabledExchangeNames.length
  ? allExchanges.filter((exchange) => enabledExchangeNames.includes(exchange.name))
  : allExchanges;

export const TOKEN_MAPPINGS: Record<string, Record<string, string>> = {
  Binance: { QI: 'BENQI', PEOPLE: 'CONSTITUTION', BTTC: 'BTT' },
  MEXC: { BENQI: 'QI', CONSTITUTION: 'PEOPLE', BTT: 'BTTC' },
  Bybit: {},
  OKX: {},
  Gate: {},
  KuCoin: {},
  Bitget: {},
};

export const MIN_NET_PROFIT_PCT = Number(process.env.MIN_NET_PROFIT_PCT || '0');
export const MAX_NET_PROFIT_PCT = Number(process.env.MAX_NET_PROFIT_PCT || '25');
export const MAX_PRICE_AGE_MS = Number(process.env.MAX_PRICE_AGE_MS || '45000');
export const INITIAL_DELAY_MS = Number(process.env.INITIAL_DELAY_MS || '10000');
export const PRICE_UPDATE_INTERVAL = Number(process.env.PRICE_UPDATE_INTERVAL || '5000');
export const REST_REQUEST_TIMEOUT_MS = Number(process.env.REST_REQUEST_TIMEOUT_MS || '8000');
export const ORDERBOOK_ENABLED = String(process.env.ORDERBOOK_ENABLED || 'true').toLowerCase() !== 'false';
export const ORDERBOOK_TRADE_AMOUNT_USDT = Number(process.env.ORDERBOOK_TRADE_AMOUNT_USDT || process.env.TRADE_AMOUNT_USDT || '100');
export const ORDERBOOK_DEPTH_LIMIT = Number(process.env.ORDERBOOK_DEPTH_LIMIT || '50');
export const ORDERBOOK_VERIFICATION_LIMIT = Number(process.env.ORDERBOOK_VERIFICATION_LIMIT || '15');
export const ORDERBOOK_CONCURRENCY = Number(process.env.ORDERBOOK_CONCURRENCY || '8');
export const ORDERBOOK_FETCH_TIMEOUT_MS = Number(process.env.ORDERBOOK_FETCH_TIMEOUT_MS || '5000');
export const INCLUDE_WITHDRAWAL_FEES = String(process.env.INCLUDE_WITHDRAWAL_FEES || 'false').toLowerCase() === 'true';
export const ENABLE_TELEGRAM = String(process.env.TELEGRAM_ENABLED || 'false').toLowerCase() === 'true';

export const TELEGRAM_CONFIG = {
  botToken: process.env.TELEGRAM_BOT_TOKEN || '',
  chatId: process.env.TELEGRAM_CHAT_ID || '',
};

export const BLACKLIST = (process.env.BLACKLIST || 'TST,NEIRO')
  .split(',')
  .map((x) => x.trim().toUpperCase())
  .filter(Boolean);

export const config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || 'your_redis_password',
  },
};
