# Nexus H2M Email Ingestion — Gmail → Supabase Edge Function

Automatisasi penuh: setiap email `[SECURITY-INQUIRY]` yang masuk ke inbox
diteruskan otomatis ke pipeline Nexus (classifier + quote + poa_ledger)
tanpa sentuhan manual sama sekali.

## Arsitektur
```
Gmail inbox (rakhmadaa@gmail.com)
   ↓ Apps Script trigger (tiap 1 menit)
Code.gs → POST /ingest/security-inquiry (Supabase Edge Function v4.6.0)
   ↓
Tag gate → Classifier (emergency/standard/retainer) → Quote H2M
   → Draft auto-reply (Gmail Drafts) → poa_ledger (append-only)
```

## Setup (5 menit, dari browser HP)
1. Buka https://script.google.com (login Gmail rakhmadaa@gmail.com)
2. New project → paste isi `Code.gs`
3. Sidebar kiri → Triggers (ikon jam) → Add Trigger:
   - Function: `processSecurityInquiries`
   - Event source: **Time-driven**
   - Type: **Minutes timer → Every minute**
   - Failure notification: Immediately
4. Jalankan `testRunNow` sekali dari editor → Google minta izin Gmail → Allow

## Perilaku
- Hanya email ber-subject `[SECURITY-INQUIRY]` yang diproses (gate 422 di gateway)
- Email valid → label `Nexus/Processed` + ditandai read (anti dobel-proses)
- Email gagal → tetap unread, dicoba ulang run berikutnya
- Auto-reply dibuat sebagai **DRAFT** (bukan auto-send — anti blokir spam Google)
- Log lengkap di Google Sheet "Nexus Ingestion Log" (dibuat otomatis)

## Upgrade full-auto-send
Lihat komentar di `createDraftReply()` — ganti `GmailApp.createDraft` dengan
`GmailApp.sendEmail`. Aktifkan hanya jika volume klien sudah tinggi dan aman.
