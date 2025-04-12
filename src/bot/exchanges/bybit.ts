import WebSocket from 'ws';
import { BaseExchange } from './base';

export class BybitExchange extends BaseExchange {
  private pendingSubscriptions: string[] = [];
  private readonly BATCH_SIZE = 10; // Maximum symbols per subscription request

  connect(): void {
    this.ws = new WebSocket(this.config.wsEndpoint);

    this.ws.on('open', () => {
      console.log('Connected to Bybit WebSocket');
      if (this.pendingSubscriptions.length > 0) {
        this.sendSubscriptions(this.pendingSubscriptions);
        this.pendingSubscriptions = [];
      }
    });

    this.ws.on('message', (data: string) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error) => {
      console.error('Bybit WebSocket error:', error);
    });

    this.ws.on('close', () => {
      console.log('Bybit WebSocket connection closed. Attempting to reconnect...');
      setTimeout(() => this.connect(), 5000);
    });
  }

  private async sendSubscriptions(symbols: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('WebSocket not ready, queueing subscriptions');
      return;
    }

    const formattedSymbols = symbols.map(symbol =>
        symbol.replace('/', '').toUpperCase()
    );

    // Split symbols into batches
    for (let i = 0; i < formattedSymbols.length; i += this.BATCH_SIZE) {
      const batch = formattedSymbols.slice(i, i + this.BATCH_SIZE);
      const subscribeMsg = {
        op: 'subscribe',
        args: batch.map(symbol => `tickers.${symbol}`),
      };

      try {
        this.ws.send(JSON.stringify(subscribeMsg));
        console.log(`Subscribed to batch of ${batch.length} symbols on Bybit (${i + 1}-${Math.min(i + this.BATCH_SIZE, formattedSymbols.length)} of ${formattedSymbols.length})`);

        // Add a small delay between batches to avoid rate limiting
        if (i + this.BATCH_SIZE < formattedSymbols.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error('Error sending subscription message:', error);
      }
    }
  }

  async subscribeToSymbols(symbols: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingSubscriptions = symbols;
      return;
    }
    await this.sendSubscriptions(symbols);
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
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const response = await this.makeRequest('/v5/market/instruments-info', 'GET', {
          category: 'spot'
        });

        if (!response || !response.result || !response.result.list) {
          throw new Error('Invalid response format from Bybit API');
        }

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
        retryCount++;
        console.error(`Error fetching Bybit trading pairs (attempt ${retryCount}/${maxRetries}):`, error);

        if (retryCount === maxRetries) {
          console.error('Max retries reached, returning empty array');
          return [];
        }

        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return [];
  }
}