import { Decimal } from 'decimal.js';
import {PriceData, ArbitrageOpportunity, MarketType} from './types';
import { MIN_PROFIT_PERCENTAGE } from './config';

export class ArbitrageAnalyzer {
  findOpportunities(prices: PriceData[], marketType: MarketType): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    const symbolGroups = this.groupBySymbol(prices);

    for (const [symbol, symbolPrices] of symbolGroups) {
      if (symbolPrices.length < 2) continue;

      for (let i = 0; i < symbolPrices.length; i++) {
        for (let j = i + 1; j < symbolPrices.length; j++) {
          const price1 = new Decimal(symbolPrices[i].price);
          const price2 = new Decimal(symbolPrices[j].price);

          const profitPercentage = price2.minus(price1)
            .div(price1)
            .times(100)
            .toNumber();

          if (Math.abs(profitPercentage) >= MIN_PROFIT_PERCENTAGE) {
            const [buyPrice, sellPrice, buyExchange, sellExchange] =
              profitPercentage > 0
                ? [symbolPrices[i].price, symbolPrices[j].price, symbolPrices[i].exchange, symbolPrices[j].exchange]
                : [symbolPrices[j].price, symbolPrices[i].price, symbolPrices[j].exchange, symbolPrices[i].exchange];

            opportunities.push({
              symbol,
              buyExchange,
              sellExchange,
              buyPrice,
              sellPrice,
              profitPercentage: Math.abs(profitPercentage),
              marketType,
              timestamp: Date.now(),
            });
          }
        }
      }
    }

    return opportunities;
  }

  private groupBySymbol(prices: PriceData[]): Map<string, PriceData[]> {
    const groups = new Map<string, PriceData[]>();
    
    for (const price of prices) {
      if (!groups.has(price.symbol)) {
        groups.set(price.symbol, []);
      }
      groups.get(price.symbol)?.push(price);
    }

    return groups;
  }
}