import { Resend } from 'resend';

// Lazy initialization to prevent build-time errors when env var isn't set
let _resend: Resend | null = null;
export function getResend(): Resend {
    if (!_resend) {
        _resend = new Resend(process.env.RESEND_API_KEY);
    }
    return _resend;
}

// Separate Resend instance for agency → client emails
let _resendClient: Resend | null = null;
export function getResendClient(): Resend {
    if (!_resendClient) {
        _resendClient = new Resend(process.env.RESEND_CLIENT_API_KEY);
    }
    return _resendClient;
}

function darkenHex(hex: string, amount: number = 0.15): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const nr = Math.max(0, Math.round(r * (1 - amount)));
    const ng = Math.max(0, Math.round(g * (1 - amount)));
    const nb = Math.max(0, Math.round(b * (1 - amount)));
    return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

function hexToRgb(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${r}, ${g}, ${b}`;
}

export function buildGradientColors(brandColor?: string): { primary: string; darker: string; shadow: string } {
    if (brandColor) {
        return {
            primary: brandColor,
            darker: darkenHex(brandColor),
            shadow: hexToRgb(brandColor),
        };
    }
    return {
        primary: '#F59E0B',
        darker: '#D97706',
        shadow: '245, 158, 11',
    };
}
