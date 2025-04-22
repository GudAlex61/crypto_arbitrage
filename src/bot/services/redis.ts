import Redis from 'ioredis';
import { config } from '../config';
import { MarketType } from '../types';

export class RedisService {
  private redis: Redis;

  constructor() {
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
    });

    this.redis.on('error', (error) => {
      console.error('Redis error:', error);
    });

    this.redis.on('connect', () => {
      console.log('Connected to Redis');
    });
  }

  async setCooldown(symbol: string, marketType: MarketType, cooldownMs: number): Promise<void> {
    const key = `cooldown:${marketType}:${symbol}`;
    await this.redis.set(key, '1', 'PX', cooldownMs);
  }

  async isOnCooldown(symbol: string, marketType: MarketType): Promise<boolean> {
    const key = `cooldown:${marketType}:${symbol}`;
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
} 