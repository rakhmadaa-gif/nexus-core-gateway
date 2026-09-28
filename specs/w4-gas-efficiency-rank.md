# W4 — Gas Efficiency Rank (Technical Specification v1.0)

> **Ringkasan (ID):** W4 adalah "senjata" pertama tier **Fitness Lite** (`POST /x402/fitness/lite`, 125 CRED / $1.25).
> Menjawab satu pertanyaan faktual: *"seberapa hemat gas fungsi-fungsi publik kontrak di repo ini, dibanding tabel referensi publik yang tetap?"*
> Semua angka = **estimasi statis dari source code** (bukan pengukuran on-chain), dengan formula publik yang tetap,
> `legal_weight: 0`, dan bisa direproduksi siapa pun. Spec ini adalah sumber kebenaran parameter; konstanta mesin
> tercermin di `GAS_RANK_MODEL` pada engine Supabase (`supabase/functions/hello-world/index.ts`).

- **Status:** SPEC v1.0 — parameter LOCKED, handler belum live (rute tetap 501 sampai M3)
- **Tier:** `fitness_lite` (125 CRED = $1.25 USDC, Polygon PoS)
- **Tanggal:** 2026-09-28 · **Penulis:** Nexus.Legal.ContractDrafter (agent-6d96a929)
- **Spec commit:** lihat git history repo ini

---

## 1. Scope & Non-Goals

**In scope (v1):**
- Input: `{repo: "owner/name"}` GitHub publik (sama seperti `/x402/fitness`), opsional `contract_path` untuk memilih file `.sol` tertentu.
- Estimasi gas **statis per fungsi publik/eksternal** via model heuristik opcode (tanpa kompilasi — Deno edge runtime tidak punya solc).
- **Peringkat efisiensi** terhadap **tabel kohort referensi tetap & publik** (COHORT v1, §5).
- Output JSON deterministik + skor komposit 0-100 + band A-E.

**Non-goals (v1):**
- BUKAN pengukuran gas on-chain aktual (v2: sampling live via ERC-8004 + profiling transaksi).
- BUKAN klaim "lebih hemat dari 100 agen ERC-8004 hidup" — blurb harga lama ("vs 100 ERC-8004 agents")
  **di-re-scope secara eksplisit**: v1 memakai kohort referensi **tetap** (deterministik, reproducible);
  target 100 entri tercapai bertahap (seed 50 → 100 di M4). Kohort live on-chain = v2.
- BUKAN nasihat optimasi/audit keamanan; tidak ada rekomendasi perbaikan kode.

**Prinsip warisan (dari Fitness Attestation v5.1.0):** fakta saja, formula publik, `legal_weight: 0`,
disclaimer wajib, cache 10 menit, validasi input SEBELUM billing.

## 2. Pipeline

```
repo (GitHub) ──▶ fetch file .sol ──▶ filter vendored ──▶ Digital Twin parse ──▶
estimasi gas/fungsi (GAS_SCHEDULE v1) ──▶ klasifikasi op-class ──▶
persentil vs COHORT v1 ──▶ skor komposit + band ──▶ JSON (cache 10 mnt)
```

1. **Fetch:** reuse fetcher repo v5.1.0 (GitHub API, token `GITHUB_TOKEN` bila ada). Batas: ≤ 25 file `.sol`, total ≤ 150 KB (selaras limit payload v4.7.0). File di path `node_modules/`, `lib/`, `vendor/`, atau mengandung substring `@openzeppelin`/`solmate`/`solady` pada baris import → **dikecualikan** (pelajaran case-hunter: kode vendored bukan karya subjek).
2. **Parse:** reuse Digital Twin v4.x parser (signature, visibility, modifier, state vars, hitung `require`). Tambahan W4: deteksi operasi dalam body fungsi (§3).
3. **Estimasi:** jumlahkan biaya operasi per fungsi memakai `GAS_SCHEDULE` (§3) + `TX_BASE` 21.000 + biaya calldata (4/zero byte, 16/non-zero).
4. **Klasifikasi:** petakan fungsi ke op-class via pola nama+operasi (§4). Fungsi tanpa kelas meyakinkan → `unranked` (TIDAK dipaksa masuk kelas).
5. **Peringkat:** persentil fungsi = posisi estimasi dalam distribusi kelasnya di COHORT v1. Komposit = rata-rata berbobot (§6).

## 3. GAS_SCHEDULE v1 (model statis, disederhanakan, dipublikasi)

Nilai mengikuti fee schedule pasca-Berlin (Polygon PoS), disederhanakan untuk model statis.
Semua konstanta hidup di `GAS_RANK_MODEL.gas_schedule` (engine) — **satu sumber kebenaran**.

| Konstanta | Nilai | Dipakai untuk |
|---|---|---|
| `TX_BASE` | 21000 | biaya dasar transaksi |
| `SSTORE_NEW` | 22100 | tulis slot 0→≠0 (20.000 + 2.100 cold) |
| `SSTORE_UPDATE` | 7100 | tulis slot ≠0→≠0 (5.000 + 2.100 cold) |
| `SLOAD_COLD` | 2100 | baca storage pertama kali |
| `SLOAD_WARM` | 100 | baca ulang slot sama |
| `CALL_COLD` | 2600 | external call target baru |
| `CALL_WARM` | 100 | external call berulang |
| `CALL_VALUE` | 9000 | call membawa ETH/token value |
| `LOG_BASE` + `LOG_TOPIC` + `LOG_DATA_BYTE` | 375 + 375/topic + 8/byte | event |
| `MEMORY_WORD` | 3 | alokasi memori per 32-byte word |
| `CALLDATA_ZERO` / `CALLDATA_NONZERO` | 4 / 16 | per byte input |
| `KECCAK_BASE` + `KECCAK_WORD` | 30 + 6/word | hashing |

**Aturan heuristik:**
- `x = ...` pada state var baru → `SSTORE_NEW`; selainnya `SSTORE_UPDATE`. `mapping[k] = v` → 1× SSTORE (+ `KECCAK` 30+6×2 untuk key hashing).
- Baca state var: pertama `SLOAD_COLD`, berikutnya `SLOAD_WARM` (per fungsi, per variabel).
- `transfer`/`transferFrom`/`safeTransferFrom` (token eksternal) → `CALL_COLD + CALL_VALUE`.
- `emit X(...)` → `LOG_BASE + 375×topics + 8×bytes` (bytes diestimasi 32×jumlah arg numerik).
- **Loop:** `for`/`while` dengan batas konstan/terbaca → biaya_body × batas. Tak terbatas (mis. `while (true)` atau batas state var) → laporkan **rentang** pada N ∈ {1, 5, 10}; pakai N=5 untuk skor, rentang tetap ditampilkan.
- **Band error publik:** estimasi statis dapat menyimpang **±40%** dari aktual ter-deploy (optimizer, urutan akses warm/cold nyata). Selalu dinyatakan di output (`limits.error_band`).

## 4. Op-Class Detection v1

| op_class | Pola (nama ATAU operasi dominan) |
|---|---|
| `transfer_like` | nama `transfer*`/`*send*`; atau ≥2 SSTORE saldo + 1 event |
| `approval_like` | nama `approve*`/`permit`; atau tulis `allowance` |
| `mint_like` | nama `mint`/`_mint`; atau `totalSupply` naik + SSTORE saldo |
| `burn_like` | nama `burn`; atau `totalSupply` turun |
| `swap_like` | nama `swap`; atau ≥2 CALL eksternal + update reserve/pair |
| `stake_like` | nama `stake`/`deposit`; atau transferFrom masuk + SSTORE posisi |
| `claim_like` | nama `claim`/`withdraw`/`harvest`; atau CALL_VALUE keluar + nuliskan saldo |
| `admin_like` | hanya `onlyOwner`/guardian + 1 SSTORE konfigurasi |
| `custom` | tidak cocok pola apa pun → **unranked** |

## 5. COHORT v1 — tabel referensi tetap (seed 50, target 100 @M4)

Distribusi referensi per op-class (gas, diukur dari deployment mainnet kontrak populer; sumber dicatat
per entri di `GAS_RANK_MODEL.cohort` saat implementasi M2). Nilai seed v1 (indikatif, kalibrasi M4):

| op_class | p25 | median | p75 | n_seed | Referensi (contoh) |
|---|---|---|---|---|---|
| transfer_like | 34000 | 51000 | 66000 | 8 | OZ ERC20, USDC, WETH, UNI, LINK, DAI, AAVE, stETH |
| approval_like | 24000 | 46000 | 56000 | 6 | OZ ERC20, USDC (permit path terpisah), WETH |
| mint_like | 51000 | 70000 | 95000 | 6 | OZ ERC20Mintable, ERC721 mint, stables |
| burn_like | 30000 | 45000 | 62000 | 4 | OZ Burnable, ERC721 burn |
| swap_like | 95000 | 128000 | 175000 | 8 | Uniswap V2/V3, Sushiswap, Curve (simple paths) |
| stake_like | 80000 | 120000 | 160000 | 6 | MasterChef, Aave stake, SNX staking |
| claim_like | 45000 | 80000 | 120000 | 6 | MasterChef withdraw, rewards claim |
| admin_like | 28000 | 44000 | 70000 | 6 | setter konfig OZ AccessControl/Ownable |

Persentil fungsi = `100 × (# entri kohort kelas ≥ estimasi) / n_kelas` (lebih tinggi = lebih hemat).

## 6. Skor Komposit & Band

```
composite = round( Σ(percentile_i × w_i) / Σ(w_i) )     w_i = 1.0 (pola kuat) | 0.5 (pola lemah)
band: A ≥ 80 | B 60-79 | C 40-59 | D 20-39 | E < 20
```

- Fungsi `unranked` TIDAK masuk komposit; dilaporkan mentah dengan estimasi + rentang loop.
- Jika 0 fungsi ranked → komposit `null`, band `"INSUFFICIENT_DATA"`, tetap bayar? **Tidak** — pra-validasi:
  bila repo tidak punya ≥1 fungsi terklasifikasi, handler membalas 422 `NO_RANKABLE_FUNCTIONS` **sebelum billing**
  (konsisten dengan aturan "validasi sebelum 402").

## 7. Output Schema (JSON)

```json
{
  "gas_rank_version": "1.0.0",
  "attested_at": "<ISO8601>",
  "subject": {"repo": "owner/name", "contracts_analyzed": 3, "contracts_skipped_vendored": 2},
  "functions": [
    {"name": "transfer", "file": "src/Token.sol", "op_class": "transfer_like",
     "estimate_gas": 52300, "loop_range": null,
     "cohort": {"class": "transfer_like", "n": 8, "median": 51000}, "percentile": 62}
  ],
  "composite": {"score": 58, "band": "C", "ranked_functions": 9, "unranked_functions": 4},
  "cohort_version": "1.0.0-seed50",
  "formula": "static opcode heuristics (GAS_SCHEDULE v1) + class percentile vs fixed public cohort",
  "limits": {"static_estimate_only": true, "error_band": "±40%", "max_files": 25, "max_bytes": 153600},
  "legal_weight": 0,
  "disclaimer": "Static heuristic estimate from source code; not on-chain measurement, not optimization advice. Reproducible: GAS_SCHEDULE v1 + COHORT v1 are fixed and public.",
  "erc8004": {"registry": "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432", "sibling_agent_id": 636,
              "note": "Live cohort sampling via ERC-8004 registry is v2; v1 uses a fixed public cohort."}
}
```

## 8. Integrasi Engine (Supabase `hello-world`)

| Titik | Status | Catatan |
|---|---|---|
| `PRICING_MODEL.services.fitness_lite` = 125 CRED | ✅ reserved (v5.1.0) | deskripsi diperbarui menunjuk spec ini |
| `GAS_RANK_MODEL` const (jadwal gas, pola kelas, band, kohort ref, limits) | ✅ **spec ini** | satu sumber kebenaran parameter, pola sama seperti PRICING_MODEL |
| Rute `POST /x402/fitness/lite` | 501 skeleton (v5.1.0) | M3: ganti 501 → handler + billing wrapper (mirror `handleFitnessWithBilling`) |
| Gatekeeper `calculateServiceCost("fitness_lite")` | ✅ otomatis (lookup PRICING_MODEL generik) | tidak perlu ubah |
| Cache 10 menit | M3 | kunci: repo + contract_path + gas_rank_version |
| SLA target | `tier_x402_sub2s: "< 2s"` (statis, tanpa kompilasi) | daftarkan di metrics block M3 |
| Manifest/discovery | M3 | tambah ke `endpoints` + openapi.yaml + worker docs |

## 9. Validasi & Kontrol Negatif (M4)

1. **Kalibrasi:** estimasi `transfer` pada 3 kontrak token terkenal harus masuk rentang p25-p75 kelasnya.
2. **Kontrol negatif:** repo tanpa `.sol` → 422; repo hanya vendored OZ → 422 (bukan skor palsu 0).
3. **Determinisme:** input sama → output byte-identik (cache dibypass) — wajib untuk klaim "reproducible".
4. **Regresi:** `/x402/fitness`, `/evm-sentinel/*`, `/pricing.manifest.json` tetap hijau.

## 10. Milestone

- **M1 (2026-09-28, SELESAI):** spec v1.0 + `GAS_RANK_MODEL` parameter const ter-commit & ter-deploy (rute tetap 501).
- **M2 (H+2):** ekstensi parser (op-counter per fungsi) + COHORT v1 seed-50 sebagai data const + unit test offline (fixture 5 kontrak).
- **M3 (H+5):** handler + billing wrapper + aktivasi rute + manifest/openapi/worker docs + SLA metric.
- **M4 (H+7):** kalibrasi vs pengukuran mainnet publik, kohort seed-50 → 100, kontrol negatif, PoA, serah-terima copywriting ke Fitness.Attestor (agent-50b55a47).
- **v2 (nanti):** kohort live — sampling agen ERC-8004 terdaftar (registry `0x8004A169...`, Polygon) + profiling gas tx nyata; butuh `agentId → endpoints → kontrak` resolution.

---
*W4 spec v1.0 — bagian dari Nexus Fitness Lite. Deterministik, factual, reproducible, legal_weight 0.*
