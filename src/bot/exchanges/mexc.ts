import WebSocket from 'ws';
import { BaseExchange } from './base';

export class MEXCExchange extends BaseExchange {
  connect(): void {
    this.ws = new WebSocket(this.config.wsEndpoint);

    this.ws.on('open', () => {
      console.log('Connected to MEXC WebSocket');
    });

    this.ws.on('message', (data: string) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error) => {
      console.error('MEXC WebSocket error:', error);
    });
  }

  subscribeToSymbols(symbols: string[]): void {
    if (!this.ws) return;

    const formattedSymbols = symbols.map(symbol => 
      symbol.replace('/', '').toLowerCase()
    );

    const subscribeMsg = {
      method: 'SUBSCRIPTION',
      params: formattedSymbols.map(symbol => `spot@public.ticker.v3.${symbol}`),
    };

    this.ws.send(JSON.stringify(subscribeMsg));
  }

  handleMessage(message: string): void {
    try {
      const data = JSON.parse(message);
      if (data.c === 'spot@public.ticker.v3') {
        const symbol = data.d.symbol;
        const price = parseFloat(data.d.c);
        this.updatePrice(symbol, price);
      }
    } catch (error) {
      console.error('Error handling MEXC message:', error);
    }
  }

  async fetchTradingPairs(): Promise<string[]> {
    try {
      const response = await this.makeRequest('/api/v3/exchangeInfo');
      const pairs = response.symbols
        .filter((symbol: any) => symbol.status === 'ENABLED')
        .map((symbol: any) => {
          const pair = `${symbol.baseAsset}/${symbol.quoteAsset}`;
          this.tradingPairs.add(pair);
          return pair;
        });
      console.log(`Fetched ${pairs.length} trading pairs from MEXC`);
      return pairs;
    } catch (error) {
      console.error('Error fetching MEXC trading pairs:', error);
      return [];
    }
  }
}