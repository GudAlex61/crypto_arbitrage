export interface ExchangeConfig {
  name: string;
  wsEndpoint: string;
  restEndpoint: string;
  apiKey?: string;
  apiSecret?: string;
}

export interface PriceData {
  symbol: string;
  price: number;
  exchange: string;
  timestamp: number;
}

export interface ArbitrageOpportunity {
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  profitPercentage: number;
  timestamp: number;
}