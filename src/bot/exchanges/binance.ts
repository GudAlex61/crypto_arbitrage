import WebSocket from 'ws';
import { BaseExchange } from './base';
import {BLACKLIST} from "../config.ts";

export class BinanceExchange extends BaseExchange {
  private pendingSubscriptions: string[] = [];

  connect(): void {
    this.ws = new WebSocket(this.config.wsEndpoint);

    this.ws.on('open', () => {
      console.log('Connected to Binance WebSocket');
      // Send any pending subscriptions once connected
      if (this.pendingSubscriptions.length > 0) {
        this.sendSubscriptions(this.pendingSubscriptions);
        this.pendingSubscriptions = [];
      }
    });

    this.ws.on('message', (data: string) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (error) => {
      console.error('Binance WebSocket error:', error);
    });

    this.ws.on('close', () => {
      console.log('Binance WebSocket connection closed. Attempting to reconnect...');
      setTimeout(() => this.connect(), 5000); // Reconnect after 5 seconds
    });
  }

  private sendSubscriptions(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log('WebSocket not ready, queueing subscriptions');
      return;
    }

    const subscriptions = symbols.map(symbol => {
      const formattedSymbol = symbol.toLowerCase().replace('/', '');
      return `${formattedSymbol}@ticker`;
    });

    const subscribeMsg = {
      method: 'SUBSCRIBE',
      params: subscriptions,
      id: 1,
    };

    try {
      // console.log(`Sending ws data: ${JSON.stringify(subscribeMsg)}`)
      this.ws.send(JSON.stringify(subscribeMsg));
      console.log(`Subscribed to ${symbols.length} symbols on Binance`);
    } catch (error) {
      console.error('Error sending subscription message:', error);
    }
  }

  subscribeToSymbols(symbols: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Store subscriptions to be sent when connection is ready
      this.pendingSubscriptions = symbols;
      return;
    }
    this.sendSubscriptions(symbols);
  }

  handleMessage(message: string): void {
    // console.log(`Binance websocket data: ${message}`)
    try {
      const data = JSON.parse(message);
      if (data.e === '24hrTicker') {
        const symbol = data.s;
        const price = parseFloat(data.c);
        this.updatePrice(symbol, price);
      }
    } catch (error) {
      console.error('Error handling Binance message:', error);
    }
  }

  async fetchTradingPairs(): Promise<string[]> {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const response = await this.makeRequest('/api/v3/exchangeInfo');

        if (!response || !response.symbols) {
          throw new Error('Invalid response format from Binance API');
        }

        const pairs = response.symbols
            .filter((symbol: any) => symbol.status === 'TRADING')
            .filter((symbol: any) => symbol.quoteAsset === 'USDT')
            .filter((symbol: any) => !BLACKLIST.includes(symbol.baseAsset))
            .map((symbol: any) => {
              const pair = `${symbol.baseAsset}/${symbol.quoteAsset}`;
              this.tradingPairs.add(pair);
              return pair;
            });

        console.log(`Fetched ${pairs.length} trading pairs from Binance`);
        return pairs;
      } catch (error) {
        retryCount++;
        console.error(`Error fetching Binance trading pairs (attempt ${retryCount}/${maxRetries}):`, error);

        if (retryCount === maxRetries) {
          console.error('Max retries reached, returning empty array');
          return [];
        }

        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return [];
  }
}