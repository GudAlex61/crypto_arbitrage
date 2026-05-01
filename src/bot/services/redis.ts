import Redis from 'ioredis';
import { config } from '../config';
import { MarketType } from '../types';

export class RedisService {
  private redis: Redis;
  private redisReady = false;
  private memoryCooldowns: Map<string, number> = new Map();

  constructor() {
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });

    this.redis.on('error', (error) => {
      this.redisReady = false;
      console.error('Redis error, using in-memory cooldown fallback:', error.message);
    });

    this.redis.on('connect', () => {
      this.redisReady = true;
      console.log('Connected to Redis');
    });

    void this.redis.connect().catch((error) => {
      this.redisReady = false;
      console.error('Redis connect failed, using in-memory cooldown fallback:', error.message);
    });
  }

  async setCooldown(symbol: string, marketType: MarketType, cooldownMs: number): Promise<void> {
    const key = `cooldown:${marketType}:${symbol}`;
    this.memoryCooldowns.set(key, Date.now() + cooldownMs);

    if (!this.redisReady) return;
    try {
      await this.redis.set(key, '1', 'PX', cooldownMs);
    } catch (error: any) {
      this.redisReady = false;
      console.error('Redis setCooldown failed:', error.message);
    }
  }

  async isOnCooldown(symbol: string, marketType: MarketType): Promise<boolean> {
    const key = `cooldown:${marketType}:${symbol}`;
    const memoryExpiresAt = this.memoryCooldowns.get(key) ?? 0;
    if (memoryExpiresAt > Date.now()) return true;
    if (memoryExpiresAt) this.memoryCooldowns.delete(key);

    if (!this.redisReady) return false;
    try {
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error: any) {
      this.redisReady = false;
      console.error('Redis isOnCooldown failed:', error.message);
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.redis.status !== 'end') await this.redis.quit().catch(() => undefined);
  }
}
