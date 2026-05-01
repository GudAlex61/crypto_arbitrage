import { BaseExchange } from './base';
import { MarketType, OrderBook } from '../types';
import { BLACKLIST } from '../config';

export class MEXCExchange extends BaseExchange {
  connect(): void {
    console.log('[MEXC] Using REST ticker snapshots');
  }

  async subscribeToSymbols(symbols: string[], marketType: MarketType): Promise<void> {
    this.rememberSubscriptions(symbols, marketType);
  }

  handleMessage(_message: Buffer, _marketType: MarketType): void {
    return;
  }

  async fetchTickerSnapshot(marketType: MarketType): Promise<void> {
    if (marketType === MarketType.SPOT) {
      const response = await this.makeRequest('/api/v3/ticker/bookTicker', 'GET', {}, marketType);
      if (!Array.isArray(response)) return;
      for (const ticker of response) {
        const bid = parseFloat(ticker.bidPrice);
        const ask = parseFloat(ticker.askPrice);
        if (ticker.symbol && this.isUsdtPairSymbol(ticker.symbol)) this.updatePrice(ticker.symbol, bid, ask, marketType);
      }
      return;
    }

    const response = await this.makeRequest('/api/v1/contract/ticker', 'GET', {}, marketType);
    const list = response?.data;
    if (!Array.isArray(list)) return;
    for (const ticker of list) {
      const symbol = ticker.symbol;
      const bid = parseFloat(ticker.bid1);
      const ask = parseFloat(ticker.ask1);
      if (symbol && this.isUsdtPairSymbol(symbol)) this.updatePrice(symbol, bid, ask, marketType);
    }
  }

  async fetchOrderBook(symbol: string, marketType: MarketType, limit = 100): Promise<OrderBook | null> {
    if (marketType === MarketType.SPOT) {
      const response = await this.makeRequest('/api/v3/depth', 'GET', { symbol: this.compactSymbol(symbol), limit }, marketType);
      return this.buildOrderBook(symbol, marketType, response?.bids, response?.asks);
    }

    const response = await this.makeRequest(`/api/v1/contract/depth/${this.underscoredSymbol(symbol)}`, 'GET', { limit }, marketType);
    const data = response?.data ?? response;
    return this.buildOrderBook(symbol, marketType, data?.bids, data?.asks);
  }

  async fetchTradingPairs(marketType: MarketType): Promise<string[]> {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (marketType === MarketType.SPOT) {
          const response = await this.makeRequest('/api/v3/exchangeInfo', 'GET', {}, marketType);
          const list = response?.symbols;
          if (!Array.isArray(list)) throw new Error('Invalid MEXC spot exchangeInfo response');

          const pairs = list
            .filter((s: any) => (s.status === '1' || s.status === 'ENABLED' || s.status === 'TRADING') && s.quoteAsset === 'USDT')
            .filter((s: any) => !BLACKLIST.includes(String(s.baseAsset).toUpperCase()))
            .map((s: any) => this.addTradingPair(`${s.baseAsset}/USDT`, marketType));

          const unique: string[] = [...new Set<string>(pairs)];
          console.log(`[MEXC] Fetched ${unique.length} ${marketType} pairs`);
          return unique;
        }

        const response = await this.makeRequest('/api/v1/contract/detail', 'GET', {}, marketType);
        const list = response?.data;
        if (!Array.isArray(list)) throw new Error('Invalid MEXC futures detail response');

        const pairs = list
          .filter((s: any) => s.quoteCoin === 'USDT' && (s.state === 0 || s.state === '0' || s.state === 'ENABLED'))
          .filter((s: any) => !BLACKLIST.includes(String(s.baseCoin).toUpperCase()))
          .map((s: any) => {
            const pair = this.addTradingPair(`${s.baseCoin}/USDT`, marketType);
            this.setOrderBookQuantityMultiplier(pair, marketType, parseFloat(s.contractSize || s.contract_size || '1'));
            return pair;
          });

        const unique: string[] = [...new Set<string>(pairs)];
        console.log(`[MEXC] Fetched ${unique.length} ${marketType} pairs`);
        return unique;
      } catch (err) {
        console.error(`[MEXC] fetchTradingPairs attempt ${attempt}/${maxRetries}:`, err);
        if (attempt < maxRetries) await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
      }
    }
    return [];
  }
}
