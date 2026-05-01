import { BaseExchange } from './base';
import { MarketType, OrderBook } from '../types';
import { BLACKLIST } from '../config';

export class BitgetExchange extends BaseExchange {
  connect(): void {
    console.log('[Bitget] Using REST ticker snapshots');
  }

  async subscribeToSymbols(symbols: string[], marketType: MarketType): Promise<void> {
    this.rememberSubscriptions(symbols, marketType);
  }

  handleMessage(_message: Buffer, _marketType: MarketType): void {
    return;
  }

  async fetchTickerSnapshot(marketType: MarketType): Promise<void> {
    const endpoint = marketType === MarketType.SPOT ? '/api/v2/spot/market/tickers' : '/api/v2/mix/market/tickers';
    const params = marketType === MarketType.SPOT ? {} : { productType: 'USDT-FUTURES' };
    const response = await this.makeRequest(endpoint, 'GET', params, marketType);
    const list = response?.data;
    if (!Array.isArray(list)) return;

    for (const ticker of list) {
      const symbol = ticker.symbol;
      const bid = parseFloat(ticker.bidPr ?? ticker.bidPrice ?? ticker.bestBid);
      const ask = parseFloat(ticker.askPr ?? ticker.askPrice ?? ticker.bestAsk);
      if (symbol && this.isUsdtPairSymbol(symbol)) this.updatePrice(symbol, bid, ask, marketType);
    }
  }

  async fetchOrderBook(symbol: string, marketType: MarketType, limit = 100): Promise<OrderBook | null> {
    const category = marketType === MarketType.SPOT ? 'SPOT' : 'USDT-FUTURES';
    const response = await this.makeRequest('/api/v3/market/orderbook', 'GET', {
      category,
      symbol: this.compactSymbol(symbol),
      limit,
    }, marketType);
    const data = response?.data ?? response;
    let book = this.buildOrderBook(symbol, marketType, data?.bids, data?.asks);
    if (book) return book;

    const fallbackEndpoint = marketType === MarketType.SPOT ? '/api/v2/spot/market/orderbook' : '/api/v2/mix/market/orderbook';
    const fallbackParams = marketType === MarketType.SPOT
      ? { symbol: this.compactSymbol(symbol), type: 'step0', limit }
      : { symbol: this.compactSymbol(symbol), productType: 'USDT-FUTURES', limit };
    const fallback = await this.makeRequest(fallbackEndpoint, 'GET', fallbackParams, marketType);
    const fallbackData = fallback?.data ?? fallback;
    book = this.buildOrderBook(symbol, marketType, fallbackData?.bids, fallbackData?.asks);
    return book;
  }

  async fetchTradingPairs(marketType: MarketType): Promise<string[]> {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const endpoint = marketType === MarketType.SPOT ? '/api/v2/spot/public/symbols' : '/api/v2/mix/market/contracts';
        const params = marketType === MarketType.SPOT ? {} : { productType: 'USDT-FUTURES' };
        const response = await this.makeRequest(endpoint, 'GET', params, marketType);
        const list = response?.data;
        if (!Array.isArray(list)) throw new Error('Invalid Bitget symbols response');

        const pairs = list
          .filter((s: any) => {
            const status = String(s.status || s.symbolStatus || '').toLowerCase();
            const quote = s.quoteCoin || s.quoteCurrency || s.quote;
            return quote === 'USDT' && (!status || ['online', 'normal', 'listed'].includes(status));
          })
          .filter((s: any) => !BLACKLIST.includes(String(s.baseCoin || s.baseCurrency || '').toUpperCase()))
          .map((s: any) => {
            const pair = this.addTradingPair(`${s.baseCoin || s.baseCurrency}/USDT`, marketType);
            if (marketType === MarketType.FUTURES) {
              this.setOrderBookQuantityMultiplier(pair, marketType, parseFloat(s.sizeMultiplier || s.contractSize || '1'));
            }
            return pair;
          });

        const unique: string[] = [...new Set<string>(pairs)];
        console.log(`[Bitget] Fetched ${unique.length} ${marketType} pairs`);
        return unique;
      } catch (err) {
        console.error(`[Bitget] fetchTradingPairs attempt ${attempt}/${maxRetries}:`, err);
        if (attempt < maxRetries) await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
      }
    }
    return [];
  }
}
