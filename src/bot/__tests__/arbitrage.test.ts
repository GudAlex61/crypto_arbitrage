import { describe, it, expect } from 'vitest';
import { ArbitrageAnalyzer } from '../arbitrage';
import { PriceData } from '../types';

describe('ArbitrageAnalyzer', () => {
  const analyzer = new ArbitrageAnalyzer();

  describe('findOpportunities', () => {
    it('should find arbitrage opportunities when price difference exceeds threshold', () => {
      const prices: PriceData[] = [
        { symbol: 'BTC/USDT', price: 50000, exchange: 'Binance', timestamp: Date.now() },
        { symbol: 'BTC/USDT', price: 50300, exchange: 'Bybit', timestamp: Date.now() },
        { symbol: 'BTC/USDT', price: 50100, exchange: 'MEXC', timestamp: Date.now() }
      ];

      const opportunities = analyzer.findOpportunities(prices);

      expect(opportunities).toHaveLength(1);
      expect(opportunities[0]).toMatchObject({
        symbol: 'BTC/USDT',
        buyExchange: 'Binance',
        sellExchange: 'Bybit',
        buyPrice: 50000,
        sellPrice: 50300,
      });
      expect(opportunities[0].profitPercentage).toBeCloseTo(0.6, 1);
    });

    it('should not find opportunities when price differences are below threshold', () => {
      const prices: PriceData[] = [
        { symbol: 'ETH/USDT', price: 2000, exchange: 'Binance', timestamp: Date.now() },
        { symbol: 'ETH/USDT', price: 2001, exchange: 'Bybit', timestamp: Date.now() },
        { symbol: 'ETH/USDT', price: 2002, exchange: 'MEXC', timestamp: Date.now() }
      ];

      const opportunities = analyzer.findOpportunities(prices);
      expect(opportunities).toHaveLength(0);
    });

    it('should handle multiple trading pairs correctly', () => {
      const prices: PriceData[] = [
        { symbol: 'BTC/USDT', price: 50000, exchange: 'Binance', timestamp: Date.now() },
        { symbol: 'BTC/USDT', price: 50300, exchange: 'Bybit', timestamp: Date.now() },
        { symbol: 'ETH/USDT', price: 2000, exchange: 'Binance', timestamp: Date.now() },
        { symbol: 'ETH/USDT', price: 2001, exchange: 'Bybit', timestamp: Date.now() }
      ];

      const opportunities = analyzer.findOpportunities(prices);
      expect(opportunities).toHaveLength(1);
      expect(opportunities[0].symbol).toBe('BTC/USDT');
    });

    it('should ignore single exchange prices', () => {
      const prices: PriceData[] = [
        { symbol: 'BTC/USDT', price: 50000, exchange: 'Binance', timestamp: Date.now() }
      ];

      const opportunities = analyzer.findOpportunities(prices);
      expect(opportunities).toHaveLength(0);
    });

    it('should handle empty price data', () => {
      const opportunities = analyzer.findOpportunities([]);
      expect(opportunities).toHaveLength(0);
    });

    it('should find multiple opportunities across different pairs', () => {
      const prices: PriceData[] = [
        { symbol: 'BTC/USDT', price: 50000, exchange: 'Binance', timestamp: Date.now() },
        { symbol: 'BTC/USDT', price: 50300, exchange: 'Bybit', timestamp: Date.now() },
        { symbol: 'ETH/USDT', price: 2000, exchange: 'Binance', timestamp: Date.now() },
        { symbol: 'ETH/USDT', price: 2020, exchange: 'MEXC', timestamp: Date.now() }
      ];

      const opportunities = analyzer.findOpportunities(prices);
      expect(opportunities).toHaveLength(2);
      
      // Verify BTC opportunity
      expect(opportunities).toContainEqual(expect.objectContaining({
        symbol: 'BTC/USDT',
        buyExchange: 'Binance',
        sellExchange: 'Bybit',
      }));
      
      // Verify ETH opportunity
      expect(opportunities).toContainEqual(expect.objectContaining({
        symbol: 'ETH/USDT',
        buyExchange: 'Binance',
        sellExchange: 'MEXC',
      }));
    });
  });
});