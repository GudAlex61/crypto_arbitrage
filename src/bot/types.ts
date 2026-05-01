export enum MarketType {
  SPOT = 'spot',
  FUTURES = 'futures'
}

export interface ExchangeFees {
  takerFee: number;   // % e.g. 0.1 = 0.1%
  makerFee: number;
  // комиссия вывода в USD/USDT-эквиваленте для грубой оценки
  withdrawalFees: Record<string, number>;
}

export interface ExchangeConfig {
  name: string;
  wsSpotEndpoint: string;
  wsFuturesEndpoint: string;
  restSpotEndpoint: string;
  restFuturesEndpoint: string;
  fees: ExchangeFees;
  apiKey?: string;
  apiSecret?: string;
}

export interface PriceData {
  symbol: string;
  bid: number;       // лучшая цена покупателя — по ней мы продаём
  ask: number;       // лучшая цена продавца  — по ней мы покупаем
  exchange: string;
  marketType: MarketType;
  timestamp: number;
}

export interface OrderBookLevel {
  price: number;
  quantity: number; // base coin/contracts amount from exchange depth snapshot
}

export interface OrderBook {
  symbol: string;
  exchange: string;
  marketType: MarketType;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

export interface MarketExecution {
  requestedQuoteAmountUSDT: number;
  filledQuoteAmountUSDT: number;
  baseAmount: number;
  avgPrice: number;
  worstPrice: number;
  levelsUsed: number;
  slippagePct: number;
  filled: boolean;
}

export interface ArbitrageOpportunity {
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  /** Effective buy VWAP after order-book verification when liquidityChecked=true. */
  buyPrice: number;
  /** Effective sell VWAP after order-book verification when liquidityChecked=true. */
  sellPrice: number;
  grossProfitPct: number;
  netProfitPct: number;
  /** Backward-compatible alias for the old dashboard template. */
  profitPercentage?: number;
  buyFeePct: number;
  sellFeePct: number;
  withdrawalFeeUSDT: number;
  marketType: MarketType;
  timestamp: number;

  /** Order-book / execution details. Present after liquidity verification. */
  liquidityChecked?: boolean;
  tradeAmountUSDT?: number;
  executableBaseAmount?: number;
  buyTopPrice?: number;
  sellTopPrice?: number;
  buyAveragePrice?: number;
  sellAveragePrice?: number;
  buyWorstPrice?: number;
  sellWorstPrice?: number;
  buyLevelsUsed?: number;
  sellLevelsUsed?: number;
  buySlippagePct?: number;
  sellSlippagePct?: number;
}

export interface ExchangeRuntimeStatus {
  exchange: string;
  spotPairs: number;
  futuresPairs: number;
  spotPrices: number;
  futuresPrices: number;
  lastUpdated: number;
}
