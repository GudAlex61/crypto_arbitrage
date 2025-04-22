import WebSocket from 'ws';
import { BaseExchange } from './base';
import { BLACKLIST } from "../config.ts";
import { MarketType } from '../types.ts';

export class BinanceExchange extends BaseExchange {
  private pendingSubscriptions: { spot: boolean, futures: boolean } = { spot: false, futures: false };

  connect(): void {
    // Connect to spot market
    this.spotWs = new WebSocket(this.config.wsSpotEndpoint);
    this.setupWebSocket(this.spotWs, MarketType.SPOT);

    // Connect to futures market
    this.futuresWs = new WebSocket(this.config.wsFuturesEndpoint);
    this.setupWebSocket(this.futuresWs, MarketType.FUTURES);
  }

  private setupWebSocket(ws: WebSocket, marketType: MarketType): void {
    ws.on('open', () => {
      console.log(`Connected to Binance ${marketType} WebSocket`);
      // Send any pending subscriptions once connected
      if (this.pendingSubscriptions[marketType]) {
        this.sendSubscriptions(marketType);
        this.pendingSubscriptions[marketType] = false;
      }
    });

    ws.on('message', (data: Buffer) => {
      this.handleMessage(data, marketType);
    });

    ws.on('error', (error) => {
      console.error(`Binance ${marketType} WebSocket error:`, error);
    });

    ws.on('close', () => {
      console.log(`Binance ${marketType} WebSocket connection closed. Attempting to reconnect...`);
      setTimeout(() => {
        if (marketType === MarketType.SPOT) {
          this.spotWs = new WebSocket(this.config.wsSpotEndpoint);
          this.setupWebSocket(this.spotWs, MarketType.SPOT);
        } else {
          this.futuresWs = new WebSocket('wss://fstream.binance.com/ws');
          this.setupWebSocket(this.futuresWs, MarketType.FUTURES);
        }
      }, 5000);
    });
  }

  private async sendSubscriptions(marketType: MarketType): Promise<void> {
    const subscribeMsg = {
      method: 'SUBSCRIBE',
      params: ["!miniTicker@arr"],
      id: 1,
    };

    try {
      const ws = marketType === 'spot' ? this.spotWs : this.futuresWs;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(subscribeMsg));
        console.log(`Subscribed to ${marketType}`);
      }
    } catch (error) {
      console.error(`Error sending ${marketType} subscription: `, error);
    }
  }

  // @ts-expect-error not used variable
  async subscribeToSymbols(symbols: string[], marketType: MarketType): Promise<void> {
    const ws = marketType === MarketType.SPOT ? this.spotWs : this.futuresWs;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Store subscriptions to be sent when connection is ready
      this.pendingSubscriptions[marketType] = true;
      return;
    }
    await this.sendSubscriptions(marketType);
  }

  handleMessage(message: Buffer, marketType: MarketType): void {
    try {
      const data = JSON.parse(message.toString());
      if (!data.length) {
        return;
      }
      for (const item of data) {
        if (item.e === '24hrMiniTicker') {
          const symbol = item.s;
          const price = parseFloat(item.c);
          this.updatePrice(symbol, price, marketType);
        }
      }
    } catch (error) {
      console.error(`Error handling Binance ${marketType} message:`, error);
    }
  }

  async fetchTradingPairs(marketType: MarketType): Promise<string[]> {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        const endpoint = marketType === MarketType.SPOT
          ? '/api/v3/exchangeInfo'
          : '/fapi/v1/exchangeInfo';

        const response = await this.makeRequest(endpoint, 'GET', {}, marketType);

        if (!response || !response.symbols) {
          throw new Error(`Invalid response format from Binance ${marketType} API`);
        }

        const pairs = response.symbols
          .filter((symbol: any) => symbol.status === 'TRADING')
          .filter((symbol: any) => symbol.quoteAsset === 'USDT')
          .filter((symbol: any) => !BLACKLIST.includes(symbol.baseAsset))
          .map((symbol: any) => {
            const pair = `${symbol.baseAsset}/${symbol.quoteAsset}`;
            if (marketType === MarketType.SPOT) {
              this.spotTradingPairs.add(pair);
            } else {
              this.futuresTradingPairs.add(pair);
            }
            return pair;
          });

        console.log(`Fetched ${pairs.length} ${marketType} trading pairs from Binance`);
        return pairs;
      } catch (error) {
        retryCount++;
        console.error(`Error fetching Binance ${marketType} trading pairs (attempt ${retryCount}/${maxRetries}):`, error);

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