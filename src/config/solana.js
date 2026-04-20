import { Connection, PublicKey } from '@solana/web3.js';

const FALLBACK_ENDPOINT = 'https://api.mainnet-beta.solana.com';

export const RPC_ENDPOINT = process.env.REACT_APP_RPC_ENDPOINT || FALLBACK_ENDPOINT;

export const connection = new Connection(RPC_ENDPOINT, 'confirmed');

export const PROSTAKING_VOTE_ACCOUNT = new PublicKey(
    'juicQdAnksqZ5Yb8NQwCLjLWhykvXGktxnQCDvMe6Nx'
);
