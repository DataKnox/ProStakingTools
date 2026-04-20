import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

const MAX_STAKE_SOL = 1_000_000;

export const parseSolAmount = (raw) => {
    if (typeof raw !== 'string' && typeof raw !== 'number') {
        throw new Error('Amount is required');
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error('Enter a positive numeric amount');
    }
    if (value > MAX_STAKE_SOL) {
        throw new Error(`Amount must be ≤ ${MAX_STAKE_SOL} SOL`);
    }
    const lamports = Math.round(value * LAMPORTS_PER_SOL);
    if (!Number.isSafeInteger(lamports) || lamports <= 0) {
        throw new Error('Amount has too many decimals');
    }
    return lamports;
};

export const toPublicKey = (address, label = 'address') => {
    try {
        return new PublicKey(address);
    } catch {
        throw new Error(`Invalid ${label}`);
    }
};

export const isSafeHttpsUrl = (value) => {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
        return false;
    }
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return false;
    }
    return parsed.protocol === 'https:';
};
