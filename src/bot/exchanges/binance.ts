import WebSocket from 'ws';
import { BaseExchange } from './base';

export class BinanceExchange extends BaseExchange {
  connect(): void {
    this.ws = new WebSocket(this.config.wsEndpoint);

    this.ws.on('open', () => {
      console.log('Connected to Binance WebSocket');
    });

    this.ws.on('message', (data: string) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error) => {
      console.error('Binance WebSocket error:', error);
    });
  }

  subscribeToSymbols(symbols: string[]): void {
    if (!this.ws) return;

    const subscriptions = symbols.map(symbol => {
      const formattedSymbol = symbol.toLowerCase().replace('/', '');
      return `${formattedSymbol}@ticker`;
    });

    const subscribeMsg = {
      method: 'SUBSCRIBE',
      params: subscriptions,
      id: 1,
    };

    this.ws.send(JSON.stringify(subscribeMsg));
  }

  handleMessage(message: string): void {
    try {
      const data = JSON.parse(message);
      if (data.e === 'ticker') {
        const symbol = data.s;
        const price = parseFloat(data.c);
        this.updatePrice(symbol, price);
      }
    } catch (error) {
      console.error('Error handling Binance message:', error);
    }
  }

  async fetchTradingPairs(): Promise<string[]> {
    try {
      const response = await this.makeRequest('/api/v3/exchangeInfo');
      const pairs = response.symbols
        .filter((symbol: any) => symbol.status === 'TRADING')
        .map((symbol: any) => {
          const pair = `${symbol.baseAsset}/${symbol.quoteAsset}`;
          this.tradingPairs.add(pair);
          return pair;
        });
      console.log(`Fetched ${pairs.length} trading pairs from Binance`);
      return pairs;
    } catch (error) {
      console.error('Error fetching Binance trading pairs:', error);
      return [];
    }
  }
}