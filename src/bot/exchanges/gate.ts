import WebSocket from 'ws';
import { BaseExchange } from './base';
import { MarketType, OrderBook } from '../types';
import { BLACKLIST } from '../config';

export class GateExchange extends BaseExchange {
  private readonly BATCH_SIZE = 50;
  private spotPingInterval: NodeJS.Timeout | null = null;
  private futuresPingInterval: NodeJS.Timeout | null = null;

  connect(): void {
    this.spotWs = new WebSocket(this.config.wsSpotEndpoint);
    this.setupWebSocket(this.spotWs, MarketType.SPOT);

    this.futuresWs = new WebSocket(this.config.wsFuturesEndpoint);
    this.setupWebSocket(this.futuresWs, MarketType.FUTURES);
  }

  private setupWebSocket(ws: WebSocket, marketType: MarketType): void {
    ws.on('open', () => {
      console.log(`[Gate] Connected ${marketType} WebSocket`);
      const ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            time: Math.floor(Date.now() / 1000),
            channel: marketType === MarketType.SPOT ? 'spot.ping' : 'futures.ping',
          }));
        }
      }, 10000);
      if (marketType === MarketType.SPOT) this.spotPingInterval = ping;
      else this.futuresPingInterval = ping;
      void this.sendSubscriptions(this.getDesiredSubscriptions(marketType), marketType);
    });

    ws.on('message', (data: Buffer) => this.handleMessage(data, marketType));
    ws.on('error', (err) => console.error(`[Gate] ${marketType} WS error:`, err));
    ws.on('close', () => {
      if (marketType === MarketType.SPOT && this.spotPingInterval) clearInterval(this.spotPingInterval);
      if (marketType === MarketType.FUTURES && this.futuresPingInterval) clearInterval(this.futuresPingInterval);
      console.log(`[Gate] ${marketType} WS closed, reconnecting...`);
      setTimeout(() => {
        const next = new WebSocket(marketType === MarketType.SPOT ? this.config.wsSpotEndpoint : this.config.wsFuturesEndpoint);
        if (marketType === MarketType.SPOT) this.spotWs = next;
        else this.futuresWs = next;
        this.setupWebSocket(next, marketType);
      }, 5000);
    });
  }

  private toGateSymbol(pair: string): string {
    return pair.replace('/', '_');
  }

  private async sendSubscriptions(symbols: string[], marketType: MarketType): Promise<void> {
    const ws = marketType === MarketType.SPOT ? this.spotWs : this.futuresWs;
    if (!symbols.length || !ws || ws.readyState !== WebSocket.OPEN) return;

    const channel = marketType === MarketType.SPOT ? 'spot.book_ticker' : 'futures.book_ticker';
    const gateSymbols = symbols.map((s) => this.toGateSymbol(s));

    for (let i = 0; i < gateSymbols.length; i += this.BATCH_SIZE) {
      const batch = gateSymbols.slice(i, i + this.BATCH_SIZE);
      ws.send(JSON.stringify({ time: Math.floor(Date.now() / 1000), channel, event: 'subscribe', payload: batch }));
      if (i + this.BATCH_SIZE < gateSymbols.length) await new Promise((r) => setTimeout(r, 200));
    }
    console.log(`[Gate] Subscribed to ${symbols.length} ${marketType} book_ticker`);
  }

  async subscribeToSymbols(symbols: string[], marketType: MarketType): Promise<void> {
    this.rememberSubscriptions(symbols, marketType);
    await this.sendSubscriptions(symbols, marketType);
  }

  handleMessage(message: Buffer, marketType: MarketType): void {
    try {
      const data = JSON.parse(message.toString());
      if (data.event === 'subscribe' || data.channel?.includes('ping') || data.channel?.includes('pong')) return;
      if (!data.result) return;

      const r = data.result;
      const symbol = r.s || r.contract || r.currency_pair;
      const bid = parseFloat(r.b ?? r.highest_bid);
      const ask = parseFloat(r.a ?? r.lowest_ask);
      if (symbol && bid > 0 && ask > 0) this.updatePrice(symbol, bid, ask, marketType);
    } catch (err) {
      console.error(`[Gate] message parse error (${marketType}):`, err);
    }
  }

  async fetchTickerSnapshot(marketType: MarketType): Promise<void> {
    const endpoint = marketType === MarketType.SPOT ? '/api/v4/spot/tickers' : '/api/v4/futures/usdt/tickers';
    const response = await this.makeRequest(endpoint, 'GET', {}, marketType);
    if (!Array.isArray(response)) return;

    for (const ticker of response) {
      const symbol = ticker.currency_pair || ticker.contract;
      const bid = parseFloat(ticker.highest_bid ?? ticker.b);
      const ask = parseFloat(ticker.lowest_ask ?? ticker.a);
      if (symbol && this.isUsdtPairSymbol(symbol)) this.updatePrice(symbol, bid, ask, marketType);
    }
  }

  async fetchOrderBook(symbol: string, marketType: MarketType, limit = 100): Promise<OrderBook | null> {
    const endpoint = marketType === MarketType.SPOT ? '/api/v4/spot/order_book' : '/api/v4/futures/usdt/order_book';
    const params = marketType === MarketType.SPOT
      ? { currency_pair: this.underscoredSymbol(symbol), limit }
      : { contract: this.underscoredSymbol(symbol), limit };
    const response = await this.makeRequest(endpoint, 'GET', params, marketType);
    return this.buildOrderBook(symbol, marketType, response?.bids, response?.asks);
  }

  async fetchTradingPairs(marketType: MarketType): Promise<string[]> {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const endpoint = marketType === MarketType.SPOT ? '/api/v4/spot/currency_pairs' : '/api/v4/futures/usdt/contracts';
        const response = await this.makeRequest(endpoint, 'GET', {}, marketType);
        if (!Array.isArray(response)) throw new Error('Invalid Gate response');

        const pairs = response
          .filter((s: any) => marketType === MarketType.SPOT ? s.trade_status === 'tradable' && s.quote === 'USDT' : !s.in_delisting && String(s.name || '').endsWith('_USDT'))
          .filter((s: any) => {
            const base = marketType === MarketType.SPOT ? s.base : String(s.name || '').split('_USDT')[0];
            return base && !BLACKLIST.includes(String(base).toUpperCase());
          })
          .map((s: any) => {
            const base = marketType === MarketType.SPOT ? s.base : String(s.name || '').split('_USDT')[0];
            const pair = this.addTradingPair(`${base}/USDT`, marketType);
            if (marketType === MarketType.FUTURES) {
              this.setOrderBookQuantityMultiplier(pair, marketType, parseFloat(s.quanto_multiplier || '1'));
            }
            return pair;
          });

        const unique: string[] = [...new Set<string>(pairs)];
        console.log(`[Gate] Fetched ${unique.length} ${marketType} pairs`);
        return unique;
      } catch (err) {
        console.error(`[Gate] fetchTradingPairs attempt ${attempt}/${maxRetries}:`, err);
        if (attempt < maxRetries) await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** attempt, 10000)));
      }
    }
    return [];
  }
}
