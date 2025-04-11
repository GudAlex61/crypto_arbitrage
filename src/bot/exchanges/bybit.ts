import WebSocket from 'ws';
import { BaseExchange } from './base';

export class BybitExchange extends BaseExchange {
  connect(): void {
    this.ws = new WebSocket(this.config.wsEndpoint);

    this.ws.on('open', () => {
      console.log('Connected to Bybit WebSocket');
    });

    this.ws.on('message', (data: string) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error) => {
      console.error('Bybit WebSocket error:', error);
    });
  }

  subscribeToSymbols(symbols: string[]): void {
    if (!this.ws) return;

    const formattedSymbols = symbols.map(symbol => 
      symbol.replace('/', '').toUpperCase()
    );

    const subscribeMsg = {
      op: 'subscribe',
      args: formattedSymbols.map(symbol => `tickers.${symbol}`),
    };

    this.ws.send(JSON.stringify(subscribeMsg));
  }

  handleMessage(message: string): void {
    try {
      const data = JSON.parse(message);
      if (data.topic?.startsWith('tickers.')) {
        const symbol = data.data.symbol;
        const price = parseFloat(data.data.lastPrice);
        this.updatePrice(symbol, price);
      }
    } catch (error) {
      console.error('Error handling Bybit message:', error);
    }
  }

  async fetchTradingPairs(): Promise<string[]> {
    try {
      const response = await this.makeRequest('/v5/market/instruments-info', 'GET', {
        category: 'spot'
      });
      const pairs = response.result.list
        .filter((symbol: any) => symbol.status === 'Trading')
        .map((symbol: any) => {
          const pair = `${symbol.baseCoin}/${symbol.quoteCoin}`;
          this.tradingPairs.add(pair);
          return pair;
        });
      console.log(`Fetched ${pairs.length} trading pairs from Bybit`);
      return pairs;
    } catch (error) {
      console.error('Error fetching Bybit trading pairs:', error);
      return [];
    }
  }
}