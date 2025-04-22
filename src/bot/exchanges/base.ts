import WebSocket from 'ws';
import axios from 'axios';
import { ExchangeConfig, MarketType } from '../types';

export abstract class BaseExchange {
  protected spotWs: WebSocket | null = null;
  protected futuresWs: WebSocket | null = null;
  protected spotPrices: Map<string, number> = new Map();
  protected futuresPrices: Map<string, number> = new Map();
  protected spotTradingPairs: Set<string> = new Set();
  protected futuresTradingPairs: Set<string> = new Set();
  
  constructor(protected config: ExchangeConfig) {}

  abstract connect(): void;
  abstract subscribeToSymbols(symbols: string[], marketType: MarketType): Promise<void>;
  abstract handleMessage(message: Buffer, marketType: MarketType): void;
  abstract fetchTradingPairs(marketType: MarketType): Promise<string[]>;

  // protected async makeSpotRequest(endpoint: string, method = 'GET', params = {}) {
  //   return this.makeRequest(endpoint, method, params, MarketType.SPOT);
  // }

  // protected async makeFuturesRequest(endpoint: string, method = 'GET', params = {}) {
  //   return this.makeRequest(endpoint, method, params, MarketType.FUTURES);
  // }

  protected async makeRequest(endpoint: string, method = 'GET', params = {}, marketType: MarketType) {
    const baseUrl = marketType === MarketType.SPOT ? this.config.restSpotEndpoint : this.config.restFuturesEndpoint;
    try {
      const response = await axios({
        method,
        url: `${baseUrl}${endpoint}`,
        params,
      });
      return response.data;
    } catch (error) {
      console.error(`Error making request to ${this.config.name}:`, error);
      return null;
    }
  }

  public getPrice(symbol: string, marketType: MarketType): number | undefined {
    const prices = marketType === MarketType.SPOT ? this.spotPrices : this.futuresPrices;
    return prices.get(symbol.replace('/', ''));
  }

  protected updatePrice(symbol: string, price: number, marketType: MarketType) {
    const prices = marketType === MarketType.SPOT ? this.spotPrices : this.futuresPrices;
    prices.set(symbol, price);
  }

  public disconnect() {
    if (this.spotWs) {
      this.spotWs.close();
      this.spotWs = null;
    }
    if (this.futuresWs) {
      this.futuresWs.close();
      this.futuresWs = null;
    }
  }

  public getTradingPairs(marketType: 'spot' | 'futures' = 'spot'): string[] {
    const pairs = marketType === 'spot' ? this.spotTradingPairs : this.futuresTradingPairs;
    return Array.from(pairs);
  }
}
