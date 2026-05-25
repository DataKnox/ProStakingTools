# ProStakingTools — agent notes

React 19 + `@solana/web3.js` single-page app for managing Solana stake accounts (create/delegate, deactivate, merge, split). Signing is always delegated to the connected wallet (Phantom); this app never handles a user private key, and stake-account keypairs generated for `createAccount`/`split` are discarded after use because authorities are set to the user's wallet.

## Architecture at a glance

- `src/App.js` — wraps the tree in `ConnectionProvider` / `WalletProvider` / `WalletModalProvider`; holds the `StakeModal` open/close state and a `refreshKey` used to remount `StakeAccountList` after a successful stake.
- `src/components/StakeAccountList.js` — fetches the user's stake accounts via `connection.getParsedProgramAccounts(StakeProgram.programId, {filters: [memcmp at offset 44]})` (offset 44 = withdrawer pubkey in the stake layout), enriches each row with validator info from `api.stakewiz.com`, and exposes per-row Merge/Split/Deactivate actions.
- `src/components/StakeModal.js` — creates a new stake account (`Keypair.generate()`) + delegates to the hardcoded ProStaking vote account in one transaction.
- `src/components/MergeStakeModal.js` / `SplitStakeModal.js` — merge/split flows using `signTransaction` + `sendRawTransaction` with blockhash-expiry-aware polling.
- `src/config/solana.js` — single source of truth for RPC endpoint + shared `Connection`. Do **not** instantiate `new Connection(...)` in components; import `connection` from here.
- `src/utils/validation.js` — `parseSolAmount`, `toPublicKey`, `isSafeHttpsUrl`. All user-supplied numeric/URL/pubkey input must route through these (they enforce integer-safe lamport math, bounded amounts, and HTTPS-only URLs).

## Conventions

- **Never re-introduce a hardcoded RPC URL.** Use `RPC_ENDPOINT` / `connection` from `src/config/solana.js`. The endpoint comes from `REACT_APP_RPC_ENDPOINT` at build time with a public-mainnet fallback. Any `REACT_APP_*` value is baked into the shipped bundle — treat it as public.
- **Never mutate instruction keys.** The original merge flow had `transaction.instructions[0].keys[1].pubkey = ...`, which relied on undocumented web3.js key ordering. Build the instruction correctly via the program builder and leave it alone.
- **Modern blockhash / confirmation only.** Use `getLatestBlockhash()` and `confirmTransaction({ signature, blockhash, lastValidBlockHeight })`. Never `getRecentBlockhash()` or single-arg `confirmTransaction(sig)` — they silently drop expired TXs.
- **Third-party data is untrusted.** Any field from `api.stakewiz.com` (or future RPC/third-party sources) must be type-checked, length-clamped, and scheme-validated before being rendered or embedded in a URL. The validator image URL goes through `isSafeHttpsUrl`.
- **No `console.log` on user/wallet state.** Pubkeys, amounts, and signatures must not be logged in production paths.
- **No `window.location.reload()` for refresh.** Use a React `key` bump.
- Web3.js resolved version is 1.98.2 (via `^1.87.6`). `StakeProgram.split(params, rentExemptReserve)` is the required two-arg signature — omitting the second arg produces a broken transaction.

## Build & run

- Node is pinned to `20.18.0` via `.nvmrc` and `package.json` `engines`. The app will refuse to install/build on other versions.
- `yarn start` — CRA dev server on `:3000` (craco config). Expect source-map warnings from `@trezor/*` and `@reown/*`; those are cosmetic.
- `yarn build` — production bundle. Needs `"vm": false` in `craco.config.js`'s `resolve.fallback` for `asn1.js` to compile under webpack 5 (already set).
- Container: `docker buildx build --builder desktop-linux --platform linux/amd64 --build-arg REACT_APP_RPC_ENDPOINT=<url> -t juicystake/tools:<tag> --load .` (`REACT_APP_RPC_ENDPOINT` is a build ARG in `Dockerfile`; without it the fallback `api.mainnet-beta.solana.com` is baked in and 403s on `getParsedProgramAccounts`.)
  - Deployment target is `linux/amd64`; default `docker build` on an arm64 Mac produces arm64 images that won't run on the host.
  - Build stage is now pure JS — no Alpine native toolchain needed. The `@solana/wallet-adapter-wallets` meta-package (which pulled Trezor → native `usb`) was dropped in favor of `@solana/wallet-adapter-phantom`, so `node-gyp` no longer runs during install.
  - Runtime is `nginx:1.30.2-alpine` (was 1.27 — bumped 2026-05-25 to clear CVE-2026-42945 "NGINX Rift" and the 1.28/1.29/1.30 quarterly CVEs); security headers live in `nginx.conf` (strict CSP, frame-ancestors none, HSTS, etc.).
- Meta CSP in `public/index.html` is intentionally lenient (`'unsafe-inline' 'unsafe-eval'`) so CRA HMR works in dev. The nginx CSP header is strict and takes precedence in prod because browsers enforce the intersection of meta + header.

## Gotchas / known landmines

- Only Phantom is supported. `@solana/wallet-adapter-phantom` is the sole wallet dependency; the `@solana/wallet-adapter-wallets` meta-package (which bundled Trezor/WalletConnect/Torus/Keystone/Solflare/Ledger) was removed 2026-05-25. Adding another wallet means a targeted dep, not the meta-package — re-introducing the meta-package brings back hundreds of transitive vulns and a native `usb` build dependency.
- `bn.js` is pinned via `package.json` `resolutions` to `^5.2.3` to dodge the pre-5.2.3 infinite-loop DoS reachable through `@solana/web3.js > borsh`. Don't remove the resolution unless `borsh`/web3.js itself ships a fix.
- `crypto-browserify`/`stream-browserify`/etc. are listed as runtime deps but are NOT in the production bundle — they only activate as webpack `resolve.fallback` shims, and nothing in the Phantom-only tree calls `require('crypto')`. The npm audit advisories under those packages (`sha.js`, `pbkdf2`) are dev-install noise, not runtime risk.
- `react-scripts@5.0.1` is unmaintained; `npm audit` will flag transitive build-time CVEs (`nth-check@1.0.2`, `svgo@1.3.2`, `webpack-dev-server@4.15.2`, jsdom→form-data, etc.). These do not ship in the runtime bundle and are not reachable in the production container (nginx serves the built static files). A migration off CRA is on the follow-up list.
- The Helius RPC URL (`cherise-ldxzh0-…-helius-rpc.com`) is an intentionally-public, rate-limited, origin-scoped "webapp frontend" key. Baking it into the bundle via `REACT_APP_RPC_ENDPOINT` is the designed flow, not a leak — confirmed with the project owner. No rotation needed.
- `SECURITY_AUDIT.md` at the repo root is the canonical record of the 2026-04-20 audit; see the 2026-05-25 delta in commit history for the follow-up that dropped the wallet meta-package, bumped nginx, and pinned `bn.js`.
