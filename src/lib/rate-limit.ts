import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { NextRequest, NextResponse } from 'next/server';
import { getClientIp } from '@/lib/network';

// Initialize Redis client (lazy — only created when first needed)
let redis: Redis | null = null;

function getRedis(): Redis | null {
    if (redis) return redis;

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
        // No Redis: the in-memory limiter below is used instead
        return null;
    }

    redis = new Redis({ url, token });
    return redis;
}

// ── Rate limit configurations ────────────────────────────────────────────────

type LimitType = 'login' | 'invite' | 'waitlist' | 'password-reset' | 'lookup' | 'claim' | 'upload' | 'sign' | 'sign-code';

const LIMITS: Record<LimitType, { limit: number; windowMs: number; window: `${number} m` | `${number} h`; prefix: string }> = {
    login: { limit: 5, windowMs: 60_000, window: '1 m', prefix: 'rl:login' }, // per IP
    invite: { limit: 3, windowMs: 60_000, window: '1 m', prefix: 'rl:invite' },
    waitlist: { limit: 3, windowMs: 60_000, window: '1 m', prefix: 'rl:waitlist' },
    'password-reset': { limit: 3, windowMs: 300_000, window: '5 m', prefix: 'rl:password-reset' },
    lookup: { limit: 30, windowMs: 60_000, window: '1 m', prefix: 'rl:lookup' }, // claim + reset page lookups
    claim: { limit: 10, windowMs: 300_000, window: '5 m', prefix: 'rl:claim' },
    upload: { limit: 60, windowMs: 3_600_000, window: '1 h', prefix: 'rl:upload' },
    sign: { limit: 10, windowMs: 3_600_000, window: '1 h', prefix: 'rl:sign' }, // per user
    'sign-code': { limit: 3, windowMs: 600_000, window: '10 m', prefix: 'rl:sign-code' },
};

function redisLimiter(type: LimitType): Ratelimit | null {
    const r = getRedis();
    if (!r) return null;
    const c = LIMITS[type];
    return new Ratelimit({ redis: r, limiter: Ratelimit.slidingWindow(c.limit, c.window), prefix: c.prefix });
}

// ── In-memory fallback (no Redis configured) ─────────────────────────────────
// Sliding window kept in this server process. Exact on a single server; on
// serverless each warm instance counts separately, so it is a floor, not a
// guarantee. Configure Upstash for shared limits across instances.

const MAX_KEYS = 10_000;
// Kept on globalThis so dev-server module reloads don't reset the counters.
const store = globalThis as typeof globalThis & { __rateLimitHits?: Map<string, number[]> };
const hits = (store.__rateLimitHits ??= new Map<string, number[]>());

export function memoryLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    const success = recent.length < limit;
    if (success) recent.push(now);
    hits.delete(key); // re-insert so the Map stays ordered by last use
    hits.set(key, recent);
    if (hits.size > MAX_KEYS) hits.delete(hits.keys().next().value!);
    return { success, remaining: Math.max(0, limit - recent.length), reset: recent[0] + windowMs };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function rateLimitResponse(limit: number, remaining: number, resetMs: number): NextResponse {
    const retryAfter = Math.ceil(resetMs / 1000);
    return NextResponse.json(
        { error: 'Too many requests. Please try again later.', code: 'RATE_LIMITED' },
        {
            status: 429,
            headers: {
                'Retry-After': String(retryAfter),
                'X-RateLimit-Limit': String(limit),
                'X-RateLimit-Remaining': '0',
                'X-RateLimit-Reset': String(Math.ceil(resetMs / 1000)),
            },
        }
    );
}

async function checkLimit(type: LimitType, identifier: string): Promise<RateLimitResult> {
    const { limit, windowMs, prefix } = LIMITS[type];
    const limiter = redisLimiter(type);
    const result = limiter ? await limiter.limit(identifier) : memoryLimit(`${prefix}:${identifier}`, limit, windowMs);
    if (!result.success) {
        return { blocked: rateLimitResponse(limit, 0, result.reset - Date.now()) };
    }

    return {
        headers: {
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': String(result.remaining),
            'X-RateLimit-Reset': String(Math.ceil((result.reset - Date.now()) / 1000)),
        },
    };
}

// ── Public API ───────────────────────────────────────────────────────────────

export type RateLimitResult = {
    blocked: NextResponse;
} | {
    headers: Record<string, string>;
} | null;

/**
 * Enhanced rate limit check that returns headers for successful requests.
 */
export async function rateLimitWithHeaders(request: NextRequest, type: LimitType): Promise<RateLimitResult> {
    return checkLimit(type, getClientIp(request));
}

/** Per-user limit. Used for file uploads (60 per hour). */
export async function rateLimitUser(userId: string, type: LimitType): Promise<RateLimitResult> {
    return checkLimit(type, `user:${userId}`);
}

/**
 * Apply rate limit headers from a successful check onto a response.
 */
export function applyRateLimitHeaders(
    response: NextResponse,
    result: RateLimitResult,
): NextResponse {
    if (result && 'headers' in result) {
        for (const [key, value] of Object.entries(result.headers)) {
            response.headers.set(key, value);
        }
    }
    return response;
}
