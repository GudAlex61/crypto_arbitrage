export enum MarketType {
  SPOT = 'spot',
  FUTURES = 'futures'
}

export interface ExchangeConfig {
  name: string;
  wsSpotEndpoint: string;
  wsFuturesEndpoint: string;
  restSpotEndpoint: string;
  restFuturesEndpoint: string;
  apiKey?: string;
  apiSecret?: string;
}

export interface PriceData {
  symbol: string;
  price: number;
  exchange: string;
  marketType: MarketType;
  timestamp: number;
}

export interface ArbitrageOpportunity {
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  profitPercentage: number;
  marketType: MarketType;
  timestamp: number;
}