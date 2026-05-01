import { Decimal } from 'decimal.js';
import {
  PriceData,
  ArbitrageOpportunity,
  MarketType,
  ExchangeConfig,
  OrderBook,
  MarketExecution,
} from './types';
import {
  INCLUDE_WITHDRAWAL_FEES,
  MAX_NET_PROFIT_PCT,
  MAX_PRICE_AGE_MS,
  MIN_NET_PROFIT_PCT,
} from './config';

export class ArbitrageAnalyzer {
  constructor(private exchangeConfigs: ExchangeConfig[]) {}

  private getFees(exchangeName: string) {
    const cfg = this.exchangeConfigs.find(e => e.name === exchangeName);
    return {
      takerFee: cfg?.fees.takerFee ?? 0.1,
      withdrawalFees: cfg?.fees.withdrawalFees ?? {},
    };
  }

  private getWithdrawalFeeUSDT(symbol: string, exchangeName: string, marketType: MarketType): number {
    if (marketType === MarketType.FUTURES) return 0;
    const base = symbol.split('/')[0];
    return this.getFees(exchangeName).withdrawalFees[base] ?? 0;
  }

  findOpportunities(prices: PriceData[], marketType: MarketType): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];
    const now = Date.now();

    // --- ДИАГНОСТИКА ---
    const byExchange = new Map<string, number>();
    let staleCount = 0;
    let zeroBidAsk = 0;

    for (const p of prices) {
      byExchange.set(p.exchange, (byExchange.get(p.exchange) ?? 0) + 1);
      if (now - p.timestamp > MAX_PRICE_AGE_MS) staleCount++;
      if (p.bid <= 0 || p.ask <= 0) zeroBidAsk++;
    }

    console.log(`\n[Analyzer] ${marketType} — входящих цен: ${prices.length}`);
    for (const [ex, cnt] of byExchange) {
      console.log(`  ${ex}: ${cnt} пар`);
    }
    if (staleCount)  console.log(`  ⚠ Устаревших (>${MAX_PRICE_AGE_MS/1000}s): ${staleCount}`);
    if (zeroBidAsk)  console.log(`  ⚠ Нулевых bid/ask: ${zeroBidAsk}`);
    // --- КОНЕЦ ДИАГНОСТИКИ ---

    const symbolGroups = this.groupBySymbol(prices);
    let groupsWithTwo = 0;
    let filteredByAge = 0;
    let filteredByProfit = 0;

    for (const [symbol, symbolPrices] of symbolGroups) {
      if (symbolPrices.length < 2) continue;
      groupsWithTwo++;

      const freshPrices = symbolPrices.filter(p => now - p.timestamp <= MAX_PRICE_AGE_MS);
      if (freshPrices.length < 2) { filteredByAge++; continue; }

      for (let i = 0; i < freshPrices.length; i++) {
        for (let j = i + 1; j < freshPrices.length; j++) {
          const a = freshPrices[i];
          const b = freshPrices[j];
          const before = opportunities.length;
          this.evaluate(symbol, a, b, marketType, opportunities);
          this.evaluate(symbol, b, a, marketType, opportunities);
          if (opportunities.length === before) filteredByProfit++;
        }
      }
    }

    console.log(`  Пар на 2+ биржах: ${groupsWithTwo}, отфильтровано по возрасту: ${filteredByAge}, по профиту: ${filteredByProfit}, найдено кандидатов: ${opportunities.length}`);

    return opportunities.sort((a, b) => b.netProfitPct - a.netProfitPct);
  }

  verifyWithOrderBooks(
    opportunity: ArbitrageOpportunity,
    buyBook: OrderBook,
    sellBook: OrderBook,
    tradeAmountUSDT: number
  ): ArbitrageOpportunity | null {
    if (!Number.isFinite(tradeAmountUSDT) || tradeAmountUSDT <= 0) return null;

    const buyExecution = this.simulateMarketBuy(buyBook.asks, tradeAmountUSDT, opportunity.buyPrice);
    if (!buyExecution.filled || buyExecution.baseAmount <= 0) return null;

    const sellExecution = this.simulateMarketSell(sellBook.bids, buyExecution.baseAmount, opportunity.sellPrice);
    if (!sellExecution.filled || sellExecution.filledQuoteAmountUSDT <= 0) return null;

    const buyFeePct = this.getFees(opportunity.buyExchange).takerFee;
    const sellFeePct = this.getFees(opportunity.sellExchange).takerFee;
    const withdrawalFeeUSDT = this.getWithdrawalFeeUSDT(opportunity.symbol, opportunity.buyExchange, opportunity.marketType);
    const withdrawalFeePct = INCLUDE_WITHDRAWAL_FEES ? (withdrawalFeeUSDT / tradeAmountUSDT) * 100 : 0;

    const grossProfitPct = new Decimal(sellExecution.avgPrice)
      .minus(buyExecution.avgPrice)
      .div(buyExecution.avgPrice)
      .times(100)
      .toNumber();
    const netProfitPct = grossProfitPct - buyFeePct - sellFeePct - withdrawalFeePct;

    if (netProfitPct < MIN_NET_PROFIT_PCT || netProfitPct > MAX_NET_PROFIT_PCT) return null;

    return {
      ...opportunity,
      buyPrice: buyExecution.avgPrice,
      sellPrice: sellExecution.avgPrice,
      buyTopPrice: opportunity.buyPrice,
      sellTopPrice: opportunity.sellPrice,
      buyAveragePrice: buyExecution.avgPrice,
      sellAveragePrice: sellExecution.avgPrice,
      buyWorstPrice: buyExecution.worstPrice,
      sellWorstPrice: sellExecution.worstPrice,
      buyLevelsUsed: buyExecution.levelsUsed,
      sellLevelsUsed: sellExecution.levelsUsed,
      buySlippagePct: buyExecution.slippagePct,
      sellSlippagePct: sellExecution.slippagePct,
      executableBaseAmount: buyExecution.baseAmount,
      tradeAmountUSDT,
      grossProfitPct,
      netProfitPct,
      buyFeePct,
      sellFeePct,
      withdrawalFeeUSDT,
      profitPercentage: netProfitPct,
      liquidityChecked: true,
      timestamp: Date.now(),
    };
  }

  private simulateMarketBuy(
    asks: OrderBook['asks'],
    quoteAmountUSDT: number,
    referenceAsk: number
  ): MarketExecution {
    let remainingQuote = quoteAmountUSDT;
    let spentQuote = 0;
    let acquiredBase = 0;
    let levelsUsed = 0;
    let worstPrice = 0;

    for (const level of asks) {
      if (remainingQuote <= quoteAmountUSDT * 1e-10) break;
      const availableQuote = level.price * level.quantity;
      if (availableQuote <= 0) continue;

      const takeQuote = Math.min(remainingQuote, availableQuote);
      const takeBase = takeQuote / level.price;
      if (takeBase <= 0) continue;

      spentQuote += takeQuote;
      acquiredBase += takeBase;
      remainingQuote -= takeQuote;
      worstPrice = level.price;
      levelsUsed++;
    }

    const avgPrice = acquiredBase > 0 ? spentQuote / acquiredBase : 0;
    return {
      requestedQuoteAmountUSDT: quoteAmountUSDT,
      filledQuoteAmountUSDT: spentQuote,
      baseAmount: acquiredBase,
      avgPrice,
      worstPrice,
      levelsUsed,
      slippagePct: referenceAsk > 0 && avgPrice > 0 ? ((avgPrice - referenceAsk) / referenceAsk) * 100 : 0,
      filled: quoteAmountUSDT - spentQuote <= Math.max(0.01, quoteAmountUSDT * 0.0001),
    };
  }

  private simulateMarketSell(
    bids: OrderBook['bids'],
    baseAmount: number,
    referenceBid: number
  ): MarketExecution {
    let remainingBase = baseAmount;
    let soldBase = 0;
    let receivedQuote = 0;
    let levelsUsed = 0;
    let worstPrice = 0;

    for (const level of bids) {
      if (remainingBase <= baseAmount * 1e-10) break;
      const takeBase = Math.min(remainingBase, level.quantity);
      if (takeBase <= 0) continue;

      soldBase += takeBase;
      receivedQuote += takeBase * level.price;
      remainingBase -= takeBase;
      worstPrice = level.price;
      levelsUsed++;
    }

    const avgPrice = soldBase > 0 ? receivedQuote / soldBase : 0;
    return {
      requestedQuoteAmountUSDT: receivedQuote,
      filledQuoteAmountUSDT: receivedQuote,
      baseAmount: soldBase,
      avgPrice,
      worstPrice,
      levelsUsed,
      slippagePct: referenceBid > 0 && avgPrice > 0 ? ((referenceBid - avgPrice) / referenceBid) * 100 : 0,
      filled: baseAmount - soldBase <= Math.max(baseAmount * 0.0001, 1e-12),
    };
  }

  private evaluate(
    symbol: string,
    buySource: PriceData,
    sellSource: PriceData,
    marketType: MarketType,
    results: ArbitrageOpportunity[]
  ) {
    const buyAsk  = new Decimal(buySource.ask);
    const sellBid = new Decimal(sellSource.bid);

    if (buyAsk.lte(0) || sellBid.lte(0)) return;

    const grossProfitPct = sellBid.minus(buyAsk).div(buyAsk).times(100).toNumber();
    const buyFeePct  = this.getFees(buySource.exchange).takerFee;
    const sellFeePct = this.getFees(sellSource.exchange).takerFee;
    const netProfitPct = grossProfitPct - buyFeePct - sellFeePct;

    if (netProfitPct < MIN_NET_PROFIT_PCT || netProfitPct > MAX_NET_PROFIT_PCT) return;

    results.push({
      symbol,
      buyExchange:       buySource.exchange,
      sellExchange:      sellSource.exchange,
      buyPrice:          buySource.ask,
      sellPrice:         sellSource.bid,
      grossProfitPct,
      netProfitPct,
      buyFeePct,
      sellFeePct,
      withdrawalFeeUSDT: this.getWithdrawalFeeUSDT(symbol, buySource.exchange, marketType),
      profitPercentage: netProfitPct,
      marketType,
      timestamp: Date.now(),
    });
  }

  private groupBySymbol(prices: PriceData[]): Map<string, PriceData[]> {
    const groups = new Map<string, PriceData[]>();
    for (const price of prices) {
      if (!groups.has(price.symbol)) groups.set(price.symbol, []);
      groups.get(price.symbol)!.push(price);
    }
    return groups;
  }
}
