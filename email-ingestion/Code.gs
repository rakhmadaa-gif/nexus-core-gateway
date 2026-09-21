/**
 * NEXUS H2M EMAIL INGESTION — Gmail → Supabase Edge Function
 * ============================================================
 * Prinsip: ZERO sentuhan manual ke inbox. Script ini hidup di dalam akun
 * Gmail bro, berjalan otomatis tiap 1 menit, meneruskan setiap email
 * ber-subject [SECURITY-INQUIRY] ke pipeline Nexus, lalu:
 *   - Menandai email SEBAGAI SUDAH DIPROSES (label + markAsRead)
 *   - Menyimpan draft auto-reply (quote dari gateway) di folder Drafts
 *   - Mencatat log hasil di Google Sheet (audit trail)
 *
 * SETUP (sekali saja, ~5 menit, semua dari browser HP):
 *   1. Buka https://script.google.com  (login akun Gmail rakhmadaa@gmail.com)
 *   2. Klik "New project" → hapus isi Code.gs → paste seluruh file ini
 *   3. Klik ikon jam "Triggers" di sidebar kiri → "Add Trigger":
 *        - Function to run: processSecurityInquiries
 *        - Event source:    From spreadsheet  → GANTI: Time-driven
 *        - Type:            Minutes timer → Every minute
 *        - Failure notification: Immediately
 *   4. Saat pertama kali dijalankan, Google akan minta izin akses Gmail —
 *      klik Allow (normal, karena script-nya milik bro sendiri).
 *
 * CATATAN PENTING (anti-spam Google):
 *   Script TIDAK mengirim email otomatis — hanya membuat DRAFT reply.
 *   Bro tinggal buka Draft, cek, tekan Send. Ini menyelamatkan akun Gmail
 *      dari blokir spam, karena pengiriman email otomatis dari Apps Script
 *      berisiko tinggi di-suspend oleh Google.
 *   Kalau nanti mau full-100% otomatis kirim reply, ubah satu baris di
 *   fungsi createDraftReply() (ada petunjuk di dalamnya).
 */

// ===================== KONFIGURASI =====================
// Endpoint ingestion Nexus (jangan diubah):
var NEXUS_INGEST_URL = "https://xibzsthfrbomefnvbicb.supabase.co/functions/v1/hello-world/ingest/security-inquiry";

// Hanya email dengan subject mengandung tag ini yang diproses:
var REQUIRED_TAG = "[SECURITY-INQUIRY]";

// Label Gmail untuk menandai email yang sudah diproses:
var PROCESSED_LABEL = "Nexus/Processed";

// Maksimum email per eksekusi (aman untuk limit Apps Script):
var MAX_EMAILS_PER_RUN = 10;

// ===================== FUNGSI UTAMA =====================
// Dijalankan otomatis oleh trigger tiap 1 menit.
function processSecurityInquiries() {
  var label = getOrCreateLabel(PROCESSED_LABEL);
  var processedIds = getProcessedMessageIds(label);

  // Cari email belum dibaca, di inbox, dengan tag [SECURITY-INQUIRY]
  var threads = GmailApp.search(
    "in:inbox is:unread subject:\"" + REQUIRED_TAG + "\"", 0, MAX_EMAILS_PER_RUN
  );

  var results = [];
  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    for (var j = 0; j < msgs.length; j++) {
      var msg = msgs[j];
      if (processedIds.indexOf(msg.getId()) >= 0) continue; // sudah diproses
      var result = forwardToNexus(msg);
      results.push(result);
      markProcessed(msg, label, result.ok);
      if (result.ok && result.autoReply) {
        createDraftReply(msg, result.autoReply);
      }
    }
  }

  if (results.length > 0) logToSheet(results);
}

// ============ 1. TERUSKAN KE NEXUS ============
function forwardToNexus(msg) {
  var payload = {
    from: msg.getFrom(),
    subject: msg.getSubject(),
    body: extractBody(msg),
    received_at: msg.getDate().toISOString()
  };

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var resp = UrlFetchApp.fetch(NEXUS_INGEST_URL, options);
    var code = resp.getResponseCode();
    var body = resp.getContentText();

    if (code === 200) {
      var data = JSON.parse(body);
      return {
        ok: true,
        messageId: msg.getId(),
        subject: msg.getSubject(),
        from: msg.getFrom(),
        inquiryId: data.inquiry_id,
        classification: data.classification ? data.classification.urgency : "?",
        quote: data.quote ? data.quote.price_usd : "?",
        autoReply: data.auto_reply || null,
        httpCode: code
      };
    } else {
      // 422 = bukan security inquiry (double-check tag) / 4xx lain = log saja
      return { ok: false, messageId: msg.getId(), subject: msg.getSubject(),
               from: msg.getFrom(), error: "HTTP " + code + ": " + body.substring(0, 200), httpCode: code };
    }
  } catch (e) {
    return { ok: false, messageId: msg.getId(), subject: msg.getSubject(),
             from: msg.getFrom(), error: String(e), httpCode: 0 };
  }
}

// ============ 2. AMBIL ISI EMAIL ============
function extractBody(msg) {
  // Gmail App Script: getBody() = HTML, getPlainBody() = teks polos.
  // Gateway parser butuh teks polos — lebih bersih untuk classifier.
  var plain = msg.getPlainBody();
  if (plain && plain.length > 0) return plain.substring(0, 15000); // cap 15K chars
  // Fallback: strip tag HTML kasar
  return msg.getBody().replace(/<[^>]+>/g, " ").substring(0, 15000);
}

// ============ 3. TANDA SUDAH DIPROSES ============
function markProcessed(msg, label, ok) {
  try {
    msg.addLabel(label);
    if (ok) {
      msg.markRead(); // email valid → tandai sudah dibaca biar tidak dobel-proses
    }
    // Jika gagal (ok=false), email TETAP unread supaya dicoba lagi run berikutnya
  } catch (e) { /* jangan crash kalau label bermasalah */ }
}

// ============ 4. DRAFT AUTO-REPLY ============
function createDraftReply(msg, autoReplyText) {
  try {
    // autoReplyText sudah berformat "Subject: ...\n\n...isi..."
    var lines = autoReplyText.split("\n");
    var subjectLine = lines[0].replace(/^Subject:\s*/i, "");
    var bodyText = lines.slice(1).join("\n").trim();

    GmailApp.createDraft(msg.getFrom(), subjectLine, bodyText);

    // >>> UPGRADE FULL-OTOMATIS (aktifkan kalau volume klien sudah tinggi):
    // Ganti baris GmailApp.createDraft(...) di atas dengan:
    //   GmailApp.sendEmail(msg.getFrom(), subjectLine, bodyText);
    // PERINGATAN: pengiriman otomatis = risiko akun Gmail diblokir Google
    // untuk pengirim massal. Aktifkan HANYA kalau sudah yakin volume aman.
  } catch (e) { /* draft gagal ≠ pipeline gagal */ }
}

// ============ 5. LOG KE GOOGLE SHEET (AUDIT TRAIL) ============
var SHEET_NAME = "Nexus Ingestion Log";
function logToSheet(results) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    // Trigger standalone: buat spreadsheet khusus log
    ss = getOrCreateLogSpreadsheet();
  }
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(["Timestamp", "Message ID", "From", "Subject", "HTTP", "Status",
                     "Inquiry ID", "Classification", "Quote", "Error"]);
  }
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    sheet.appendRow([new Date(), r.messageId, r.from, r.subject, r.httpCode,
                     r.ok ? "PROCESSED" : "FAILED", r.inquiryId || "",
                     r.classification || "", r.quote || "", r.error || ""]);
  }
}

function getOrCreateLogSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("LOG_SHEET_ID");
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (e) {}
  }
  var ss = SpreadsheetApp.create("Nexus Ingestion Log");
  props.setProperty("LOG_SHEET_ID", ss.getId());
  return ss;
}

// ============ UTILITAS ============
function getOrCreateLabel(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) label = GmailApp.createLabel(name);
  return label;
}

function getProcessedMessageIds(label) {
  // Ambil ID email yang sudah dilabeli, untuk cegah dobel-proses
  var threads = label.getThreads(0, 50);
  var ids = [];
  for (var i = 0; i < threads.length; i++) {
    var msgs = threads[i].getMessages();
    for (var j = 0; j < msgs.length; j++) ids.push(msgs[j].getId());
  }
  return ids;
}

// ============ TES MANUAL (jalankan sekali dari editor untuk cek) ============
function testRunNow() {
  processSecurityInquiries();
}
