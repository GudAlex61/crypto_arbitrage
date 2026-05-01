import axios from 'axios';
import WebSocket from 'ws';
import { REST_REQUEST_TIMEOUT_MS } from '../config';
import { ExchangeConfig, MarketType, OrderBook, OrderBookLevel, PriceData } from '../types';

export interface BidAsk {
  bid: number;
  ask: number;
  timestamp: number;
}

export abstract class BaseExchange {
  protected spotWs: WebSocket | null = null;
  protected futuresWs: WebSocket | null = null;

  protected spotPrices: Map<string, BidAsk> = new Map();
  protected futuresPrices: Map<string, BidAsk> = new Map();

  protected spotTradingPairs: Set<string> = new Set();
  protected futuresTradingPairs: Set<string> = new Set();
  /** Converts order-book size units to base-asset units. Spot is 1; some futures venues return contracts. */
  protected orderBookQuantityMultipliers: Map<string, number> = new Map();

  protected desiredSpotSymbols: string[] = [];
  protected desiredFuturesSymbols: string[] = [];

  constructor(protected config: ExchangeConfig) {}

  abstract connect(): void;
  abstract subscribeToSymbols(symbols: string[], marketType: MarketType): Promise<void>;
  abstract handleMessage(message: Buffer, marketType: MarketType): void;
  abstract fetchTradingPairs(marketType: MarketType): Promise<string[]>;

  /**
   * Optional REST fallback. WebSockets are fast, but REST snapshots make startup,
   * reconnects and futures much more reliable across exchanges.
   */
  async fetchTickerSnapshot(_marketType: MarketType): Promise<void> {
    return;
  }

  /**
   * Optional order-book snapshot used to estimate the real executable VWAP.
   */
  async fetchOrderBook(_symbol: string, _marketType: MarketType, _limit = 100): Promise<OrderBook | null> {
    return null;
  }

  protected rememberSubscriptions(symbols: string[], marketType: MarketType): void {
    const unique = [...new Set(symbols)];
    if (marketType === MarketType.SPOT) this.desiredSpotSymbols = unique;
    else this.desiredFuturesSymbols = unique;
  }

  protected getDesiredSubscriptions(marketType: MarketType): string[] {
    return marketType === MarketType.SPOT ? this.desiredSpotSymbols : this.desiredFuturesSymbols;
  }

  protected async makeRequest(
    endpoint: string,
    method = 'GET',
    params: Record<string, unknown> = {},
    marketType: MarketType
  ) {
    const baseUrl =
      marketType === MarketType.SPOT
        ? this.config.restSpotEndpoint
        : this.config.restFuturesEndpoint;

    try {
      const response = await axios({
        method,
        url: `${baseUrl}${endpoint}`,
        params,
        timeout: REST_REQUEST_TIMEOUT_MS,
        headers: {
          'User-Agent': 'crypto-arbitrage-bot/1.0',
        },
      });
      return response.data;
    } catch (error: any) {
      const details = error?.response
        ? `${error.response.status} ${JSON.stringify(error.response.data).slice(0, 300)}`
        : error?.message || String(error);
      console.error(`[${this.config.name}] REST ${marketType} ${endpoint} error: ${details}`);
      return null;
    }
  }

  protected normalizeSymbolKey(symbol: string): string {
    return symbol
      .toUpperCase()
      .replace('-SWAP', '')
      .replace(/[-_/]/g, '')
      .replace(/^XBT/, 'BTC')
      .replace(/USDTM$/, 'USDT');
  }

  protected compactSymbol(symbol: string): string {
    return this.normalizeSymbolKey(symbol);
  }

  protected dashedSymbol(symbol: string, suffix = ''): string {
    const compact = this.normalizeSymbolKey(symbol);
    const base = compact.slice(0, -4);
    return `${base}-USDT${suffix}`;
  }

  protected underscoredSymbol(symbol: string): string {
    const compact = this.normalizeSymbolKey(symbol);
    const base = compact.slice(0, -4);
    return `${base}_USDT`;
  }

  protected pairFromBase(base: string, quote = 'USDT'): string {
    const normalizedBase = base.toUpperCase() === 'XBT' ? 'BTC' : base.toUpperCase();
    return `${normalizedBase}/${quote.toUpperCase()}`;
  }

  protected isUsdtPairSymbol(symbol: string): boolean {
    const normalized = this.normalizeSymbolKey(symbol);
    return normalized.endsWith('USDT') && normalized.length > 4;
  }

  protected setOrderBookQuantityMultiplier(symbol: string, marketType: MarketType, multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier <= 0) return;
    this.orderBookQuantityMultipliers.set(`${marketType}:${this.normalizeSymbolKey(symbol)}`, multiplier);
  }

  protected getOrderBookQuantityMultiplier(symbol: string, marketType: MarketType): number {
    return this.orderBookQuantityMultipliers.get(`${marketType}:${this.normalizeSymbolKey(symbol)}`) ?? 1;
  }

  protected parseBookLevel(level: unknown): OrderBookLevel | null {
    let price: number;
    let quantity: number;

    if (Array.isArray(level)) {
      price = parseFloat(String(level[0]));
      quantity = parseFloat(String(level[1]));
    } else if (level && typeof level === 'object') {
      const l = level as Record<string, unknown>;
      price = parseFloat(String(l.price ?? l.p ?? l.px ?? l.pr ?? l.rate ?? (l as any)[0] ?? '0'));
      quantity = parseFloat(String(l.quantity ?? l.qty ?? l.size ?? l.s ?? l.amount ?? l.vol ?? l.v ?? (l as any)[1] ?? '0'));
    } else {
      return null;
    }

    if (!Number.isFinite(price) || !Number.isFinite(quantity) || price <= 0 || quantity <= 0) return null;
    return { price, quantity };
  }

  protected buildOrderBook(symbol: string, marketType: MarketType, rawBids: unknown, rawAsks: unknown): OrderBook | null {
    const multiplier = this.getOrderBookQuantityMultiplier(symbol, marketType);
    const applyMultiplier = (level: OrderBookLevel): OrderBookLevel => ({
      price: level.price,
      quantity: level.quantity * multiplier,
    });

    const bids = Array.isArray(rawBids)
      ? rawBids.map((x) => this.parseBookLevel(x)).filter((x): x is OrderBookLevel => !!x).map(applyMultiplier)
      : [];
    const asks = Array.isArray(rawAsks)
      ? rawAsks.map((x) => this.parseBookLevel(x)).filter((x): x is OrderBookLevel => !!x).map(applyMultiplier)
      : [];

    if (!bids.length || !asks.length) return null;

    bids.sort((a, b) => b.price - a.price);
    asks.sort((a, b) => a.price - b.price);

    return {
      symbol,
      exchange: this.config.name,
      marketType,
      bids,
      asks,
      timestamp: Date.now(),
    };
  }

  public getPriceData(symbol: string, marketType: MarketType): PriceData | null {
    const store = marketType === MarketType.SPOT ? this.spotPrices : this.futuresPrices;
    const key = this.normalizeSymbolKey(symbol);
    const entry = store.get(key) ?? store.get(symbol);
    if (!entry) return null;

    return {
      symbol,
      bid: entry.bid,
      ask: entry.ask,
      exchange: this.config.name,
      marketType,
      timestamp: entry.timestamp,
    };
  }

  public getPrice(symbol: string, marketType: MarketType): number | undefined {
    const data = this.getPriceData(symbol, marketType);
    if (!data) return undefined;
    return (data.bid + data.ask) / 2;
  }

  protected updatePrice(symbol: string, bid: number, ask: number, marketType: MarketType): void {
    if (!Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0) return;
    const store = marketType === MarketType.SPOT ? this.spotPrices : this.futuresPrices;
    store.set(this.normalizeSymbolKey(symbol), { bid, ask, timestamp: Date.now() });
  }

  protected addTradingPair(pair: string, marketType: MarketType): string {
    const normalized = pair.toUpperCase().replace('-', '/').replace('_', '/');
    if (marketType === MarketType.SPOT) this.spotTradingPairs.add(normalized);
    else this.futuresTradingPairs.add(normalized);
    return normalized;
  }

  public disconnect(): void {
    this.spotWs?.close();
    this.spotWs = null;
    this.futuresWs?.close();
    this.futuresWs = null;
  }

  public getTradingPairs(marketType: MarketType): string[] {
    const pairs = marketType === MarketType.SPOT ? this.spotTradingPairs : this.futuresTradingPairs;
    return Array.from(pairs);
  }

  public getPriceCount(marketType: MarketType): number {
    const store = marketType === MarketType.SPOT ? this.spotPrices : this.futuresPrices;
    return store.size;
  }
}
