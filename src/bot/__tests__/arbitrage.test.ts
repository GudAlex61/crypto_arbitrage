import { describe, it, expect } from 'vitest';
import { ArbitrageAnalyzer } from '../arbitrage';
import { ExchangeConfig, MarketType, PriceData } from '../types';

const exchangeConfigs: ExchangeConfig[] = ['Binance', 'Bybit', 'MEXC'].map((name) => ({
  name,
  wsSpotEndpoint: '',
  wsFuturesEndpoint: '',
  restSpotEndpoint: '',
  restFuturesEndpoint: '',
  fees: { takerFee: 0.1, makerFee: 0.1, withdrawalFees: {} },
}));

function price(symbol: string, exchange: string, bid: number, ask = bid, marketType = MarketType.SPOT): PriceData {
  return { symbol, bid, ask, exchange, marketType, timestamp: Date.now() };
}

describe('ArbitrageAnalyzer', () => {
  const analyzer = new ArbitrageAnalyzer(exchangeConfigs);

  describe('findOpportunities', () => {
    it('finds arbitrage opportunities when net price difference exceeds threshold', () => {
      const prices: PriceData[] = [
        price('BTC/USDT', 'Binance', 49990, 50000),
        price('BTC/USDT', 'Bybit', 50300, 50310),
        price('BTC/USDT', 'MEXC', 50100, 50110),
      ];

      const opportunities = analyzer.findOpportunities(prices, MarketType.SPOT);

      expect(opportunities.length).toBeGreaterThanOrEqual(1);
      expect(opportunities[0]).toMatchObject({
        symbol: 'BTC/USDT',
        buyExchange: 'Binance',
        sellExchange: 'Bybit',
        buyPrice: 50000,
        sellPrice: 50300,
      });
      expect(opportunities[0].grossProfitPct).toBeCloseTo(0.6, 1);
      expect(opportunities[0].netProfitPct).toBeCloseTo(0.4, 1);
    });

    it('does not find opportunities when net price differences are below threshold', () => {
      const prices: PriceData[] = [
        price('ETH/USDT', 'Binance', 1999, 2000),
        price('ETH/USDT', 'Bybit', 2001, 2002),
        price('ETH/USDT', 'MEXC', 2002, 2003),
      ];

      const opportunities = analyzer.findOpportunities(prices, MarketType.SPOT);
      expect(opportunities).toHaveLength(0);
    });

    it('handles multiple trading pairs correctly', () => {
      const prices: PriceData[] = [
        price('BTC/USDT', 'Binance', 49990, 50000),
        price('BTC/USDT', 'Bybit', 50300, 50310),
        price('ETH/USDT', 'Binance', 1999, 2000),
        price('ETH/USDT', 'Bybit', 2001, 2002),
      ];

      const opportunities = analyzer.findOpportunities(prices, MarketType.SPOT);
      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].symbol).toBe('BTC/USDT');
    });

    it('ignores single exchange prices', () => {
      const opportunities = analyzer.findOpportunities([
        price('BTC/USDT', 'Binance', 49990, 50000),
      ], MarketType.SPOT);

      expect(opportunities).toHaveLength(0);
    });

    it('handles empty price data', () => {
      const opportunities = analyzer.findOpportunities([], MarketType.SPOT);
      expect(opportunities).toHaveLength(0);
    });

    it('finds multiple opportunities across different pairs', () => {
      const prices: PriceData[] = [
        price('BTC/USDT', 'Binance', 49990, 50000),
        price('BTC/USDT', 'Bybit', 50300, 50310),
        price('ETH/USDT', 'Binance', 1999, 2000),
        price('ETH/USDT', 'MEXC', 2020, 2022),
      ];

      const opportunities = analyzer.findOpportunities(prices, MarketType.SPOT);
      expect(opportunities).toHaveLength(2);
      expect(opportunities).toContainEqual(expect.objectContaining({
        symbol: 'BTC/USDT',
        buyExchange: 'Binance',
        sellExchange: 'Bybit',
      }));
      expect(opportunities).toContainEqual(expect.objectContaining({
        symbol: 'ETH/USDT',
        buyExchange: 'Binance',
        sellExchange: 'MEXC',
      }));
    });
  });
});
