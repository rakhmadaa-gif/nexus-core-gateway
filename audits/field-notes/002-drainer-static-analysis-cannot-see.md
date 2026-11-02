# Field Notes #2 — The Drainer Static Analysis Cannot See (Deployer-Page Supply-Chain Forensics)

> **Field Notes** — short, dated write-ups of real lessons from building and running the Nexus EVM Sentinel engine. One lesson per note, committed when written, describing work already done. No backdating.

**Incident:** 2026-09-23 · **Published:** 2026-11-02
**Tags:** `supply-chain` `wallet-drainer` `bytecode-forensics` `static-analysis` `false-negative` `mempool-bot-scam` `deployer-page` `MEV-bot-scam` `smart-contract-security`

## The case

On 2026-09-23 we ran a forensic pass over a family of "arbitrage bot" scam repositories — the `UNISWAP-ARBITRAGE-BOT` / `Ai-Bot-Trader` / `MEV` class that lures victims with READMEs promising passive MEV profits. Two attack layers surfaced, and the second one is the reason this note exists.

## Layer 1 — the classic template (source-visible)

The flagship template hides its drainer address by splitting it into **eight `private pure` string-returning functions** — `getMempoolShort()`, `getMempoolMedium()`, `fetchMempoolBytecode()`, `fetchMempoolVolume()`, and friends — then reassembling the hex string at runtime and parsing it into an `address`. Public `start()` / `withdrawal()` then sweep the full contract balance to that address.

The tell is semantic, not syntactic: **Solidity cannot read the mempool.** No contract has ever observed pending transactions from inside the EVM. Any function whose name claims mempool access is fiction by construction — the "mempool" vocabulary is there to make the README sound like trading infrastructure instead of a drain.

## Layer 2 — the deployer-page substitution (source-INvisible)

The nastier sibling does not live in the contract at all. A deployer web page (the `etherlabs-sol.github.io/deployer` class) masquerades as a Solidity IDE: you paste your contract, it compiles, you click Deploy. For contracts that don't match its bundled template list, **the page silently discards your bytecode and deploys a prebuilt `EMBEDDED_BYTECODE` "ArbitrageBot" instead**. The embedded contract:

- accepts ETH from anyone via `receive()`,
- exposes **unguarded** `executeArbitrage()` / `withdraw()` that drain the entire balance to a hardcoded address,
- ships a `withdrawETH()` that *does* check `onlyOwner` — **but still pays the drainer**. The constructor sets `owner = victim`, so the victim sees themselves as the contract owner in explorers. When they "withdraw their profits," the money goes to the attacker anyway.
- pads the ABI with log-only decoy functions (`quickSwap`, `swap`, `setXxx`) so the contract looks busy.

This is **infrastructure supply-chain compromise, not a code bug**. A source audit of the contract the victim *thinks* they deployed would pass. The attack is in the deployment pipeline.

## The honest part — our own engine misses this class

We rebuilt both shapes as minimal repros and ran them through our own dry-run breach simulator ([POST /gateway/dry-run](https://rakhmadaa-gif.github.io/nexus-core-gateway/), free):

- mempool-fragment template (full-balance `.transfer()` to a runtime-assembled address): `overall_risk: low`, `deployable: true` — **no scenario fired**
- embedded-drainer shape (unguarded `.call{value: address(this).balance}` to a hardcoded address, plus the fake `onlyOwner` withdraw): `overall_risk: low`, `deployable: true` — **no scenario fired**

That is a verified false-negative class for source-level static scanning, and the reason is structural: a full-balance sweep to a third-party address is also what legitimate sweep and fee-forwarding functions look like. From the source alone, the drain is indistinguishable from a sweep pattern — the malice lives in the **narrative** (README promising profits), the **distribution** (deployer page, burner host accounts, scam repos sharing one deployer host), and the **obfuscation** (runtime string-to-address assembly, which legitimate code never does).

## The signatures that DO catch it

- **Repo-name level** (implemented in our screening pipeline): the arbitrage/MEV/sniper/flashloan-bot name regex. Blunt, but this class self-announces.
- **Source level** (candidate detector, not yet shipped): 8+ `private pure` string-returning `getMempool*`/`fetchMempool*` functions + runtime concatenation + a hand-rolled hex parser + public full-balance transfer. The single highest-precision marker is the **runtime string-to-address assembly** — we have never seen it in legitimate code.
- **Bytecode level** (from the forensic session): `SELFBALANCE (0x47)` feeding a `CALL` to a constant `PUSH20`; a `view` function returning a hardcoded address; log-only decoy bodies. Reading dispatchers by brute-forcing keccak selectors and mapping `63<sel>1461<off>57` offsets to bodies; the drain starts with `5f 47 90 50` (PUSH0, SELFBALANCE, SWAP1, POP), while a real `onlyOwner` gate reads `5f 80 54 ... 63 33 ... 61 14` (owner SLOAD, selector compare, jump). Verify guards by reading the body's first opcodes, not the function name.
- **Deployer-page level**: `EMBEDDED_BYTECODE` constant + `isTemplate` branching + `TEMPLATE_CONTRACTS` allowlist in the page source. If a deploy tool substitutes bytecode, no contract-level analysis can save you.

## Permanent rules we took from it

1. **A clean static scan of the source is not a clean bill of deployment health.** The deployment pipeline is part of the attack surface.
2. **`onlyOwner` proves nothing about where the money goes.** Read the destination of the transfer, not the gate on the caller. The cruelest drain we saw was fully `onlyOwner`-guarded — and the owner was the victim.
3. **"Mempool" in a Solidity function name is fiction.** Treat it as a scam marker on sight.
4. **Runtime string-to-address assembly is an obfuscation marker.** Legitimate code writes address literals or takes constructor parameters; it does not parse hex strings at runtime to build a destination.
5. **Report the infrastructure, not the code.** This class is a GitHub Abuse takedown, not a GHSA advisory — there is no vulnerability in a contract that was never the victim's contract.

---

*Engine in this note: Nexus EVM Sentinel dry-run, live at the time of writing. The false-negative class above is tracked as a candidate detection rule (runtime string-to-address assembly) in our engine backlog. Field Notes are factual engineering write-ups — `legal_weight: 0`, no legal opinions.*
