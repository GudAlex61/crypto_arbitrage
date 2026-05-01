import TelegramBot from 'node-telegram-bot-api';
import { ENABLE_TELEGRAM, TELEGRAM_CONFIG } from '../config';
import { ArbitrageOpportunity } from '../types';

export class TelegramService {
  private bot: TelegramBot | null = null;
  private messageQueue: Array<{ message: string; retryCount: number }> = [];
  private isProcessing = false;
  private readonly RATE_LIMIT_DELAY = 3000;
  private readonly MAX_RETRIES = 3;
  private readonly MAX_QUEUE_SIZE = 1000;
  private readonly COOLDOWN_MS = 5 * 60 * 1000;
  private lastNotified: Map<string, number> = new Map();
  private errorBackoff = 3000;
  private lastErrorTime = 0;

  constructor() {
    if (!ENABLE_TELEGRAM) return;
    if (!TELEGRAM_CONFIG.botToken || !TELEGRAM_CONFIG.chatId) {
      console.warn('[Telegram] TELEGRAM_ENABLED=true, but token/chat id are missing. Telegram disabled.');
      return;
    }

    this.bot = new TelegramBot(TELEGRAM_CONFIG.botToken, { polling: false });
    setInterval(() => void this.processQueue(), this.RATE_LIMIT_DELAY);
  }

  private async processQueue(): Promise<void> {
    if (!this.bot || this.isProcessing || !this.messageQueue.length) return;
    if (Date.now() - this.lastErrorTime < this.errorBackoff) return;

    this.isProcessing = true;
    try {
      const item = this.messageQueue[0];
      await this.bot.sendMessage(TELEGRAM_CONFIG.chatId, item.message, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      });
      this.errorBackoff = 3000;
      this.lastErrorTime = 0;
      this.messageQueue.shift();
    } catch (err: any) {
      if (err.response?.statusCode === 429) {
        this.lastErrorTime = Date.now();
        this.errorBackoff = Math.min(this.errorBackoff * 2, 30000);
        const item = this.messageQueue[0];
        if (item.retryCount < this.MAX_RETRIES) item.retryCount++;
        else this.messageQueue.shift();
      } else {
        console.error('[Telegram] send failed:', err?.message || err);
        this.messageQueue.shift();
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private isOnCooldown(key: string): boolean {
    const last = this.lastNotified.get(key);
    return !!last && Date.now() - last < this.COOLDOWN_MS;
  }

  async sendOpportunityAlert(opp: ArbitrageOpportunity): Promise<void> {
    if (!this.bot) return;
    const key = `${opp.marketType}:${opp.symbol}:${opp.buyExchange}:${opp.sellExchange}`;
    if (this.isOnCooldown(key)) return;
    if (this.messageQueue.length >= this.MAX_QUEUE_SIZE) return;

    this.lastNotified.set(key, Date.now());
    this.messageQueue.push({ message: this.formatMessage(opp), retryCount: 0 });
  }

  private formatMessage(opp: ArbitrageOpportunity): string {
    const fmt = (p: number) =>
      p >= 1 ? p.toFixed(2) : p >= 0.01 ? p.toFixed(4) : p >= 0.0001 ? p.toFixed(6) : p.toFixed(8);

    const withdrawalNote = opp.withdrawalFeeUSDT > 0
      ? `\n💸 <b>Вывод:</b> ~$${opp.withdrawalFeeUSDT.toFixed(2)} (грубая оценка, не включена в net по умолчанию)`
      : '';

    const liquidityNote = opp.liquidityChecked
      ? `\n📚 <b>Стакан:</b> ${(opp.tradeAmountUSDT ?? 0).toFixed(2)} USDT, base ${(opp.executableBaseAmount ?? 0).toFixed(8)}\n   Buy slip: ${(opp.buySlippagePct ?? 0).toFixed(3)}%, levels ${opp.buyLevelsUsed ?? '-'}\n   Sell slip: ${(opp.sellSlippagePct ?? 0).toFixed(3)}%, levels ${opp.sellLevelsUsed ?? '-'}`
      : '';

    return `
🔍 <b>Арбитражная возможность!</b>

💱 <b>Пара:</b> ${opp.symbol} [${opp.marketType.toUpperCase()}]
📊 <b>Gross:</b> ${opp.grossProfitPct.toFixed(3)}%
✅ <b>Net:</b> ${opp.netProfitPct.toFixed(3)}%

🟢 <b>Купить на ${opp.buyExchange}</b>
   VWAP: $${fmt(opp.buyPrice)} (top $${fmt(opp.buyTopPrice ?? opp.buyPrice)}, fee ${opp.buyFeePct}%)

🔴 <b>Продать на ${opp.sellExchange}</b>
   VWAP: $${fmt(opp.sellPrice)} (top $${fmt(opp.sellTopPrice ?? opp.sellPrice)}, fee ${opp.sellFeePct}%)
${liquidityNote}
${withdrawalNote}
⏰ ${new Date(opp.timestamp).toLocaleString()}
`.trim();
  }
}
