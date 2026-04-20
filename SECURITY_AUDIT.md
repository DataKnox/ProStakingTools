# Security Audit — ProStakingTools

**Date:** 2026-04-20
**Scope:** React + `@solana/web3.js` frontend for managing Solana stake accounts (stake, deactivate, merge, split). Files audited: `src/**`, `public/**`, `Dockerfile`, `package.json`, `yarn.lock`, build config, `.gitignore`, `.dockerignore`.
**Out of scope:** Phantom wallet adapter internals, the Solana StakeProgram itself, the Helius and Stakewiz services (third parties).

---

## Executive summary

Fifteen issues were identified across four categories: secret handling, transaction-integrity, client-side hardening, and deployment. The two high-severity issues (embedded RPC endpoint identifier and a Dockerfile that shipped the CRA dev server to production) were addressed; all medium-severity issues relating to transaction construction, input validation, and third-party data rendering were addressed; low/informational items either were addressed or documented as residual risk.

No runtime key-exfiltration or wallet-draining vulnerability was found in the reviewed code: the app never handles the user's private key (signing is delegated to the wallet), and authority pubkeys on new stake accounts are correctly set to the user's own wallet. Findings are primarily about **defense-in-depth**, **transaction-correctness bugs** (e.g. missing `rentExemptReserve` in split, unsafe mutation of instruction keys), and **deployment hygiene**.

---

## Findings

### H-1 — RPC endpoint identifier embedded in source and duplicated across files
**Severity:** High (operational/financial)
**Files:** `src/App.js:18`, `src/components/StakeModal.js:12`, `src/components/StakeAccountList.js:20`, `src/components/MergeStakeModal.js:13`, `src/components/SplitStakeModal.js:21`

The Helius RPC URL `https://cherise-ldxzh0-fast-mainnet.helius-rpc.com` was hardcoded in five places. Helius URLs contain a subdomain identifier that functions as the authentication token — anyone who opens the minified bundle can extract and reuse it, consuming the owner's quota. Duplication also meant any rotation required five edits.

**Fix:** Extracted into `src/config/solana.js`, reading `REACT_APP_RPC_ENDPOINT` with a public-mainnet fallback. Added `.env.example`. All five call sites now import a single shared `connection`. Note that any `REACT_APP_*` value is still baked into the built bundle — true secrecy requires a backend proxy; this change makes rotation and scoping feasible rather than providing cryptographic secrecy.

---

### H-2 — Dockerfile ran the CRA dev server as the production container
**Severity:** High
**File:** `Dockerfile`

The image used `FROM node:latest` (unpinned), copied the source, and ran `yarn start`. That starts `react-scripts` / `webpack-dev-server`, which is not designed for production: it lacks production-grade error handling, enables HMR endpoints, and has accumulated several CVEs (e.g. CVE-2024-29180 source-code leak). The multi-stage `AS build` alias was declared but never referenced.

**Fix:** Rewrote `Dockerfile` to a true multi-stage build:
1. Pinned `node:20.18.0-alpine` (matches `.nvmrc`) runs `yarn install --frozen-lockfile` and `yarn build`.
2. Final stage uses `nginx:1.27-alpine` to serve the static build from `/usr/share/nginx/html`.

Added `nginx.conf` setting standard security headers (see M-1).

---

### M-1 — No Content-Security-Policy or anti-clickjacking controls
**Severity:** Medium
**Files:** `public/index.html`, nginx config (did not exist)

The HTML template shipped with no CSP, no `X-Frame-Options`, no `Referrer-Policy`, and no `Permissions-Policy`. A wallet-signing dApp without frame protection is a plausible clickjacking target (the wallet extension still mediates approval, but surrounding UI can be spoofed).

**Fix:**
- Added a meta CSP in `public/index.html` permissive enough for CRA dev-mode HMR (`'unsafe-inline' 'unsafe-eval'` on `script-src`).
- Added a strict server-header CSP in `nginx.conf` for production (no `'unsafe-inline'` on scripts, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`). Browsers enforce the intersection of meta + header, so production gets the strict policy.
- Added `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, HSTS, `X-Content-Type-Options: nosniff` at the nginx layer.
- Added a small `top.location = self.location` frame-buster as a belt-and-braces measure for deployments without the nginx layer.
- Set `<meta name="referrer" content="no-referrer">`.

---

### M-2 — Third-party validator image URL rendered without scheme validation
**Severity:** Medium
**File:** `src/components/StakeAccountList.js` (original `fetchValidatorInfo` + render)

`data.image` from `api.stakewiz.com` was rendered directly into `<img src>`. `<img src>` will not execute `javascript:` URLs, so this is not a direct XSS, but unvalidated input from a third-party URL still enables tracking pixels, mixed-content (`http:`) leaks, and abuse of `data:` URIs. Additionally, the dead `validatorWebsite` `<a href>` JSX (never populated by the fetch) would have been a real XSS sink if a future developer wired it up — React 19 still renders `javascript:` URLs in `href` with a console warning.

**Fix:**
- Added `isSafeHttpsUrl` in `src/utils/validation.js` — only `https:` URLs ≤2048 chars pass.
- `fetchValidatorInfo` now rejects non-HTTPS images, clamps the `name` field to 128 chars, and adds an `AbortController`-based 5-second timeout so a slow third-party cannot stall the stake-account list indefinitely. It also sends `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, and base58-validates the vote account before building the URL (plus `encodeURIComponent` for defense-in-depth).
- Removed the dead `validatorWebsite` render path and dropped `alt={validatorName}` in favor of empty `alt=""` to prevent third-party text from becoming part of a screen-reader / tooltip surface.
- Added `referrerPolicy="no-referrer"` and `loading="lazy"` on the image.

---

### M-3 — Deprecated RPC calls (`getRecentBlockhash`, single-arg `confirmTransaction`)
**Severity:** Medium (reliability → can masquerade as correctness issue)
**Files:** `MergeStakeModal.js`, `SplitStakeModal.js`, `StakeAccountList.js#handleDeactivate`

`getRecentBlockhash` has been deprecated for >2 years and single-arg `confirmTransaction(signature)` uses a polling strategy that silently drops expired transactions. Both are relevant: dropped stake-deactivation or merge TXs could leave the user believing an action completed when it did not.

**Fix:** All flows now use `getLatestBlockhash()` and the structured `confirmTransaction({ signature, blockhash, lastValidBlockHeight })`. The merge/split polling loop also checks `getBlockHeight()` against `lastValidBlockHeight` and returns `false` when the blockhash is expired, so the UI shows the "status unknown" toast instead of silently reporting success.

---

### M-4 — Unsafe input parsing on stake/split amount
**Severity:** Medium
**Files:** `StakeModal.js` (original line 23), `SplitStakeModal.js` (original line 73)

`parseFloat(amount) * LAMPORTS_PER_SOL` can produce non-integer lamports (e.g. `1.0000000001 * 1e9 = 1000000000.1`). The resulting transaction fails on-chain with an opaque error. There was also no upper bound and no rejection of `NaN`, `Infinity`, or negative values beyond the HTML `min="0"` attribute (which still allows `0`). The HTML-level validation is bypassable.

**Fix:** Added `parseSolAmount` in `src/utils/validation.js` that enforces finite, positive, ≤1,000,000 SOL, safe-integer lamports via `Math.round`. Both the stake and split modal use it. HTML `min` was also tightened to `0.000000001` (one lamport) with matching `step`.

---

### M-5 — Unsafe mutation of instruction keys in merge flow
**Severity:** Medium (latent footgun)
**File:** `MergeStakeModal.js:112` (original)

```js
transaction.instructions[0].keys[1].pubkey = sourceStakeAccountPubkey;
```

This reassigned the pubkey of the second `AccountMeta` in the first instruction of the transaction, relying on the *undocumented* internal layout of `StakeProgram.merge`. If web3.js ever changed that layout (e.g. by prepending a compute-budget instruction or reordering keys), the merge would quietly corrupt a different AccountMeta's pubkey — potentially sending the merge authority or clock-sysvar position to the wrong pubkey, with on-chain consequences. In the current layout it is a no-op, but it creates future fragility.

**Fix:** Removed the line entirely; the merge instruction from `StakeProgram.merge(...)` already has the correct keys.

---

### M-6 — `StakeProgram.split` called without `rentExemptReserve`
**Severity:** Medium (functional bug found during audit)
**File:** `SplitStakeModal.js` (original line 80)

`StakeProgram.split(params, rentExemptReserve)` in the installed web3.js (v1.98.2) is a two-arg API that builds a `SystemProgram.createAccount` + split instruction. The original call passed only `params`, resulting in the generated `createAccount` using `lamports: undefined` — the serialized instruction would fail before submission or on-chain. Split was effectively broken.

**Fix:** Call site now passes the fetched `rentExemptBalance` as the second argument, and the transaction spreads `splitTx.instructions` into the outer transaction. The source account balance is not checked client-side (on-chain error path handles that), but rent-exemption is.

---

### M-7 — Merge allowed between stake accounts with different validators
**Severity:** Medium (UX → can cause user-visible failure) *(non-security but worth noting)*
**File:** `MergeStakeModal.js`

The dropdown filtered by `state` and "not same account", but on Solana the merge precondition is: same voter, same authorities, same lockup, compatible activation state. Picking accounts delegated to different validators produces a cryptic on-chain error.

**Fix:** Dropdown now additionally filters on `validatorAddress` equality. A helper message is shown when no compatible account exists.

---

### L-1 — `lockup.custodian` set to user's pubkey despite zero lockup
**Severity:** Low (semantic)
**File:** `StakeModal.js` (original line 63)

Setting `custodian` to the user's pubkey on a lockup that is otherwise zeroed (epoch 0, unixTimestamp 0) has no runtime effect — the lockup is inactive. But it is semantically misleading and would surprise readers. It also makes the on-chain account visibly "tagged" with the custodian, which would no longer be true if a future dev enabled the lockup without re-reading this memo.

**Fix:** Replaced the object literal with `new Lockup(0, 0, PublicKey.default)` and used `new Authorized(publicKey, publicKey)` for consistency with web3.js constructors.

---

### L-2 — Missing Vote program ownership check
**Severity:** Low
**File:** `StakeModal.js` (original line 49)

`getAccountInfo(PROSTAKING_VOTE_ACCOUNT)` only checked that the account exists (`!voteAccountInfo`). It did not verify the owner program. The constant is hardcoded, so this is not a user-input risk, but if the account were ever replaced by a non-vote account at that address (e.g. closed-and-repurposed), the delegation would silently produce an unexpected state.

**Fix:** Now asserts `voteAccountInfo.owner.equals(VOTE_PROGRAM_ID)` before building the delegate instruction.

---

### L-3 — `console.log` of wallet pubkeys, amounts, and signatures
**Severity:** Low
**Files:** all components

Production bundles carried `console.log('Amount in lamports: …')`, `console.log('Stake account pubkey: …')`, `console.log('All stake accounts: …')`, etc. These do not leak secrets but do expose operational details to anyone with the browser open and give a misleading impression of debug surface.

**Fix:** Removed all sensitive `console.log`/`console.error` calls from the paths rewritten above. Error paths now surface user-facing toast messages only.

---

### L-4 — `window.location.reload()` after stake success
**Severity:** Low (defensive)
**File:** `App.js` (original line 29)

Full page reload wipes the React tree, drops the wallet-adapter session briefly, and can interact poorly with CSP refresh handling. Not a vulnerability on its own, but it loses state unnecessarily.

**Fix:** Replaced with a React `key` bump (`refreshKey`) that remounts the stake list only.

---

### L-5 — `.gitignore` / `.dockerignore` did not cover all env file variants
**Severity:** Low
**Files:** `.gitignore`, `.dockerignore`

`.env` (unsuffixed) was not ignored by git — if a developer created one with real credentials it would be commitable. `.dockerignore` also allowed `.env.*.local` patterns but did not exclude `.env.production` or arbitrary `.env.*`.

**Fix:** Both files now ignore all `.env*` variants. `.dockerignore` explicitly re-includes `.env.example` and also now excludes `build/`, `coverage/`, `.DS_Store`, `*.log`.

---

### I-1 — Dead `handleTransfer` button
**Severity:** Informational
**File:** `StakeAccountList.js` (original line 229)

A "Transfer" button existed in the UI wired to an empty handler. Kept as UI bait without backing behavior invites user confusion and future unsafe wiring.

**Fix:** Removed the button and the stub handler. Transfer of a stake account (authority change) is a distinct and dangerous operation that deserves its own design pass.

---

### I-2 — Transitive build-only CVEs from `react-scripts@5.0.1`
**Severity:** Informational
**Source:** `yarn.lock`

`react-scripts@5.0.1` pulls in `nth-check@1.0.2` (via `svgo@1.3.2`, ReDoS), `postcss@7.0.39`, and `webpack-dev-server@4.15.2`. These are **build-time** dependencies and do not ship in the final bundle, so they do not expose the running application to remote attackers. `npm audit` will still flag them as high/critical — the canonical mitigation is migrating off `react-scripts` (e.g. to Vite or Next), which is a larger refactor and not performed here. Because H-2's remediation switches production serving to nginx on a built artifact, `webpack-dev-server` in particular is no longer reachable in deployed environments.

**Status:** Not fixed; documented. Recommend planning a build-tool migration.

---

## Files changed / created

| Path | Change |
|------|--------|
| `src/config/solana.js` | **NEW** — single source of truth for RPC endpoint, shared `Connection`, ProStaking vote account `PublicKey` |
| `src/utils/validation.js` | **NEW** — `parseSolAmount`, `toPublicKey`, `isSafeHttpsUrl` |
| `src/App.js` | RPC constant import; removed `window.location.reload()`; cleaned unused `network`/`Connection` imports |
| `src/components/StakeAccountList.js` | Shared `connection`; validator image validated; AbortController timeout; base58 vote-account check; modern blockhash/confirmation; base58 check; removed dead transfer button |
| `src/components/StakeModal.js` | Shared `connection`; input validation; `Authorized`/`Lockup` constructors; `PublicKey.default` custodian; Vote program owner check; modern blockhash/confirmation |
| `src/components/MergeStakeModal.js` | Shared `connection`; removed unsafe `instructions[0].keys[1].pubkey` mutation; validator-address filter; modern blockhash/confirmation; blockhash-expiry aware polling |
| `src/components/SplitStakeModal.js` | Shared `connection`; input validation; fixed `StakeProgram.split` rent arg; modern blockhash/confirmation; blockhash-expiry aware polling |
| `public/index.html` | CSP (dev-compatible), `Referrer-Policy`, frame-buster script |
| `Dockerfile` | Multi-stage build; pinned Node 20.18.0-alpine; production bundle served by nginx |
| `nginx.conf` | **NEW** — strict CSP, HSTS, X-Frame-Options, Permissions-Policy, Referrer-Policy, long-cache static assets |
| `.gitignore` | All `.env*` variants |
| `.dockerignore` | All `.env*` (except `.env.example`); build/coverage excluded |
| `.env.example` | **NEW** — documents `REACT_APP_RPC_ENDPOINT` and the trust model |
| `craco.config.js` | Added `"vm": false` fallback so `asn1.js` compiles under webpack 5 (the production build was otherwise broken and was never shippable) |

## Build verification

`yarn build` (Node 20.18.0) produces a clean production bundle (`main.c0b7a0e2.js`, 186.91 kB gzipped). A grep of the built bundle confirms the previously-embedded `cherise-ldxzh0…helius-rpc.com` identifier is no longer present; only the `api.mainnet-beta.solana.com` fallback appears (overridable at build time via `REACT_APP_RPC_ENDPOINT`).

---

## Residual risk & follow-ups

1. **RPC endpoint is still client-side.** Any `REACT_APP_*` value is embedded in the built JavaScript. If this endpoint must remain secret (paid quota, rate-limited key), front the RPC calls with a backend proxy and drop `REACT_APP_RPC_ENDPOINT` from the client.
2. **`react-scripts@5.0.1` is unmaintained.** Transitive build-time CVEs cannot be patched without migrating off CRA. Planning a move to Vite or Next.js is recommended.
3. **Third-party dependency on `api.stakewiz.com`.** If Stakewiz is compromised, the UI will show attacker-chosen names; image rendering is now scheme-restricted but an attacker could still point to a valid HTTPS resource to exfiltrate view events. Consider an allow-list of known validator metadata sources or caching server-side.
4. **No automated security testing.** Recommend adding `npm audit --production` to CI (or equivalent), plus a Snyk/Dependabot policy, and a script test for the input validators added in this audit.
5. **Rotate the previously-exposed Helius RPC identifier.** It has been in the public git history; assume it is compromised and issue a new one.
