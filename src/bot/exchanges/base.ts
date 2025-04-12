import WebSocket from 'ws';
import axios from 'axios';
import { ExchangeConfig } from '../types';

export abstract class BaseExchange {
  protected ws: WebSocket | null = null;
  protected prices: Map<string, number> = new Map();
  protected tradingPairs: Set<string> = new Set();
  
  constructor(protected config: ExchangeConfig) {}

  abstract connect(): void;
  abstract subscribeToSymbols(symbols: string[]): void;
  abstract handleMessage(message: string): void;
  abstract fetchTradingPairs(): Promise<string[]>;

  protected async makeRequest(endpoint: string, method = 'GET', params = {}) {
    try {
      const response = await axios({
        method,
        url: `${this.config.restEndpoint}${endpoint}`,
        params,
      });
      return response.data;
    } catch (error) {
      console.error(`Error making request to ${this.config.name}:`, error);
      return null;
    }
  }

  public getPrice(symbol: string): number | undefined {
    return this.prices.get(symbol.replace('/', ''));
  }

  protected updatePrice(symbol: string, price: number) {
    this.prices.set(symbol, price);
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  public getTradingPairs(): string[] {
    return Array.from(this.tradingPairs);
  }
}
