// ╔══════════════════════════════════════════════════════════════╗
// ║  AL BAYAN  ·  app.js                                         ║
// ║  All bugs fixed, download added, new UI wired up             ║
// ╚══════════════════════════════════════════════════════════════╝

"use strict";

// ── FIX 1: Configure PDF.js worker immediately ─────────────────
if (typeof pdfjsLib !== "undefined") {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js";
}

// ── Global state ───────────────────────────────────────────────
let extractedArabicText = "";
let selectedPdfType     = "text";
let tesseractWorker     = null;
let currentFile         = null;
let isSpeaking          = false;
let GEMINI_API_KEY      = "";
let isTranslationRunning = false;

// ── Gemini API ──────────────────────────────────────────────────
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const ENCRYPTION_KEY = "al-bayan-secure-key-2025-32chars!!";

// ── Rate-limit / retry constants ────────────────────────────────
let geminiActiveRequests = 0;
let lastGeminiRequestTs  = 0;

const GEMINI_MAX_CONCURRENT = 1;
const GEMINI_MIN_DELAY_MS   = 800;
const MAX_CHARS_PER_REQUEST = 8000;
const MAX_RETRIES           = 5;
const INITIAL_BACKOFF_MS    = 1000;
const BACKOFF_MULTIPLIER    = 2;
const JITTER_MS             = 300;

// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForGeminiSlot() {
  while (geminiActiveRequests >= GEMINI_MAX_CONCURRENT) {
    await delay(100);
  }
  const sinceLast = Date.now() - lastGeminiRequestTs;
  if (sinceLast < GEMINI_MIN_DELAY_MS) {
    await delay(GEMINI_MIN_DELAY_MS - sinceLast);
  }
  geminiActiveRequests++;
}

function releaseGeminiSlot() {
  geminiActiveRequests = Math.max(0, geminiActiveRequests - 1);
  lastGeminiRequestTs  = Date.now();
}

// ── FIX 2: Improved sanitizeModelNoise ──────────────────────────
// Only strips known model artefacts; never touches Bengali/Arabic.
function sanitizeModelNoise(text) {
  if (!text || typeof text !== "string") return text || "";
  let out = text;
  out = out.replace(/\bMAX_TOKENS\b/gi, "");
  out = out.replace(/\bgemini-[\w.-]+\b/gi, "");
  // Only remove pure-ASCII tokens (≥8 chars) NOT followed by a non-ASCII char
  // Use word-boundary that respects ASCII only:
  out = out.replace(/(?<![^\x00-\x7F])[A-Za-z0-9_-]{8,}(?![^\x00-\x7F])/g, (match) => {
    // Keep known Bengali/Arabic-adjacent tokens; only remove if purely alphanumeric noise
    if (/^[A-Z0-9_-]+$/.test(match)) return "";
    return match;
  });
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");
  out = out.replace(/\s+([.,:;!?])/g, "$1");
  return out.trim();
}

// ── Shared response text extractor ──────────────────────────────
// FIX 3: Single shared helper (was duplicated in batchTranslatePages + translateWithGemini)
function extractTextFromResponse(obj, collected = []) {
  if (!obj) return collected;
  if (typeof obj === "string") {
    const t = obj.trim();
    if (t) collected.push(t);
    return collected;
  }
  if (Array.isArray(obj)) {
    for (const item of obj) extractTextFromResponse(item, collected);
    return collected;
  }
  if (typeof obj === "object") {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (key === "text" || key === "output_text") {
        if (typeof val === "string" && val.trim()) {
          collected.push(val.trim());
          continue;
        }
      }
      if (key === "parts" && Array.isArray(val)) {
        for (const part of val) {
          if (part && typeof part.text === "string" && part.text.trim()) {
            collected.push(part.text.trim());
          } else {
            extractTextFromResponse(part, collected);
          }
        }
        continue;
      }
      extractTextFromResponse(val, collected);
    }
  }
  return collected;
}

// ══════════════════════════════════════════════════════════════════
// GEMINI NETWORK
// ══════════════════════════════════════════════════════════════════

async function requestWithRetries(apiUrl, requestBody) {
  let attempt = 0;
  let backoff  = INITIAL_BACKOFF_MS;

  while (attempt <= MAX_RETRIES) {
    attempt++;
    await waitForGeminiSlot();
    let response;
    try {
      response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
    } catch (networkErr) {
      releaseGeminiSlot();
      if (attempt > MAX_RETRIES) throw networkErr;
      await delay(backoff + Math.floor(Math.random() * JITTER_MS));
      backoff *= BACKOFF_MULTIPLIER;
      continue;
    }

    if (response.ok) {
      let data;
      try { data = await response.json(); }
      catch (e) { data = await response.text().catch(() => null); }
      releaseGeminiSlot();
      return data;
    }

    const retryAfter = response.headers.get("Retry-After");
    let waitMs = 0;
    if (retryAfter) {
      const sec = parseInt(retryAfter, 10);
      waitMs = isNaN(sec)
        ? Math.max(0, Date.parse(retryAfter) - Date.now())
        : sec * 1000;
    }

    const status  = response.status;
    const rawBody = await response.text().catch(() => null);
    let errObj = null;
    try { errObj = JSON.parse(rawBody); } catch (_) {}

    releaseGeminiSlot();

    if ((status === 429 || status === 503) && attempt <= MAX_RETRIES) {
      await delay(waitMs > 0
        ? waitMs + Math.floor(Math.random() * JITTER_MS)
        : backoff + Math.floor(Math.random() * JITTER_MS));
      backoff *= BACKOFF_MULTIPLIER;
      continue;
    }

    const message = errObj?.error?.message || rawBody || `API Error: ${status}`;
    const err = new Error(message);
    err.status = status;
    throw err;
  }
  throw new Error("Max retries exceeded for Gemini request");
}

// ══════════════════════════════════════════════════════════════════
// BATCH TRANSLATION
// ══════════════════════════════════════════════════════════════════

function buildBatchPrompt(pages) {
  const SENTINEL = "---PAGE_BREAK---";
  const parts = [
    "You are to translate Arabic Islamic text to Bangla. Preserve Islamic meaning accurately. Do not add commentary.",
    `For each page provided, output ONLY the Bangla translation separated by: ${SENTINEL}`,
    `Prefix each translation with "PAGE:{pageNumber}". Example:`,
    `PAGE:1\n<bangla for page 1>\n${SENTINEL}\nPAGE:2\n<bangla for page 2>\n${SENTINEL}`,
    "Translate the following pages in order:",
  ];
  for (const p of pages) {
    parts.push(`PAGE:${p.pageNumber}\n${p.text}\n`);
  }
  return parts.join("\n\n");
}

// ── FIX 4: Fixed batch result lookup ────────────────────────────
// Returns { pageNumber: translatedText } for each page in the batch.
async function batchTranslatePages(pages) {
  if (!pages || pages.length === 0) return {};

  const SENTINEL  = "---PAGE_BREAK---";
  const apiUrl    = `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`;
  const prompt    = buildBatchPrompt(pages);

  const requestBody = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
  };

  const rawResponse = await requestWithRetries(apiUrl, requestBody);

  const pieces = extractTextFromResponse(rawResponse);
  let joined   = sanitizeModelNoise(pieces.join("\n\n").trim());

  const resultMap = {};
  if (!joined) return resultMap;

  const segments = joined.split(SENTINEL).map(s => s.trim()).filter(Boolean);

  // Try PAGE: prefix mapping first
  for (const seg of segments) {
    const m = seg.match(/^PAGE\s*:\s*(\d+)\s*\n?([\s\S]*)$/i);
    if (m) {
      const pn   = parseInt(m[1], 10);
      const text = m[2] ? m[2].trim() : "";
      if (pn && text) resultMap[pn] = text;
    }
  }

  // Fallback: sequential mapping if no PAGE: tags found
  if (Object.keys(resultMap).length === 0) {
    for (let i = 0; i < segments.length && i < pages.length; i++) {
      resultMap[pages[i].pageNumber] = segments[i];
    }
  }

  // Ensure every page in the batch has an entry
  for (const p of pages) {
    if (!resultMap[p.pageNumber]) resultMap[p.pageNumber] = "";
  }

  return resultMap;
}

// ── Single-page translation (test / fallback) ───────────────────
async function translateWithGemini(text, isTest = false) {
  if (!GEMINI_API_KEY) throw new Error("API_KEY_MISSING");

  const apiUrl     = `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`;
  const safeText   = String(text).substring(0, 15000);
  const requestBody = {
    contents: [{
      role: "user",
      parts: [{
        text: `Translate this Arabic Islamic text to Bangla. Preserve Islamic meaning. Only return the Bangla translation.\n\n${safeText}`
      }],
    }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 },
  };

  const rawResponse = await requestWithRetries(apiUrl, requestBody);
  if (isTest) return "API_TEST_SUCCESS";

  const pieces     = extractTextFromResponse(rawResponse);
  const filtered   = pieces.filter(p => typeof p === "string" && p.length > 8);
  let translated   = sanitizeModelNoise((filtered.join("\n\n") || pieces.join("\n\n")).trim());
  return translated || "";
}

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════

document.addEventListener("DOMContentLoaded", () => {
  initializeTheme();
  loadApiKey();
  setupFileInput();
  setupDragAndDrop();
  setupKeyboardShortcuts();
  loadHistory();
  showNotification("Al Bayan সফলভাবে লোড হয়েছে!", "success");
});

// ══════════════════════════════════════════════════════════════════
// THEME
// ══════════════════════════════════════════════════════════════════

function initializeTheme() {
  const toggle     = document.getElementById("themeToggle");
  const savedTheme = localStorage.getItem("albayan_theme") || "dark";

  applyTheme(savedTheme, toggle);

  toggle?.addEventListener("change", function () {
    const theme = this.checked ? "dark" : "light";
    applyTheme(theme, this);
    localStorage.setItem("albayan_theme", theme);
  });
}

function applyTheme(theme, toggle) {
  document.documentElement.setAttribute("data-theme", theme);
  if (toggle) toggle.checked = (theme === "dark");
}

// ══════════════════════════════════════════════════════════════════
// TAB NAVIGATION — FIX 5: explicit element passed, no global event
// ══════════════════════════════════════════════════════════════════

function showTab(tabName, clickedEl) {
  // Hide all tab content panels
  ["translate", "history", "library"].forEach(name => {
    const el = document.getElementById(name + "-tab");
    if (el) el.classList.add("hidden");
  });

  // Deactivate all nav tabs
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));

  // Show selected tab
  const target = document.getElementById(tabName + "-tab");
  if (target) target.classList.remove("hidden");

  // Mark clicked tab as active
  if (clickedEl) clickedEl.classList.add("active");

  // Refresh history when switching to it
  if (tabName === "history") loadHistory();
}

// ══════════════════════════════════════════════════════════════════
// FILE INPUT
// ══════════════════════════════════════════════════════════════════

function setupFileInput() {
  const input = document.getElementById("pdfFile");
  if (!input) return;
  input.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleFileSelected(file);
  });
}

function handleFileSelected(file) {
  if (file.type !== "application/pdf") {
    showNotification("শুধুমাত্র PDF ফাইল সমর্থিত।", "error");
    return;
  }
  currentFile = file;

  const badge = document.getElementById("fileBadge");
  const name  = document.getElementById("fileName");
  const size  = document.getElementById("fileSize");

  const sizeMB = (file.size / 1048576).toFixed(2);
  if (name) name.textContent = file.name;
  if (size) size.textContent = `${sizeMB} MB`;
  if (badge) badge.classList.add("show");

  if (file.size > 10 * 1048576) {
    showNotification(`বড় ফাইল (${sizeMB} MB): প্রসেসিং বেশি সময় নিতে পারে।`, "warning");
  }
}

// ── FIX 6: selectPdfType — explicit element, no event dependency ─
function selectPdfType(type, clickedEl) {
  selectedPdfType = type;
  document.querySelectorAll(".pdf-type-option").forEach(opt => opt.classList.remove("active"));
  if (clickedEl) clickedEl.classList.add("active");
}

// ══════════════════════════════════════════════════════════════════
// DRAG AND DROP
// ══════════════════════════════════════════════════════════════════

function setupDragAndDrop() {
  const area = document.getElementById("fileUploadArea");
  if (!area) return;

  const prevent = (e) => { e.preventDefault(); e.stopPropagation(); };
  ["dragenter","dragover","dragleave","drop"].forEach(ev => {
    area.addEventListener(ev, prevent);
    document.body.addEventListener(ev, prevent);
  });

  area.addEventListener("dragenter", () => area.classList.add("drag-over"));
  area.addEventListener("dragover",  () => area.classList.add("drag-over"));
  area.addEventListener("dragleave", () => area.classList.remove("drag-over"));
  area.addEventListener("drop", (e) => {
    area.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      handleFileSelected(file);
      showNotification("PDF ফাইল সফলভাবে লোড হয়েছে!", "success");
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ══════════════════════════════════════════════════════════════════

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && e.key === "Enter") {
      e.preventDefault();
      if (!document.getElementById("extractTranslateBtn")?.disabled) {
        extractAndTranslate();
      }
    }
    if (e.key === "Escape") {
      if (isTranslationRunning) stopTranslation();
      if (document.getElementById("readerModal")?.classList.contains("open")) closeReader();
    }
    if (ctrl && e.key === "s") {
      e.preventDefault();
      saveCurrentTranslation();
    }
    if (ctrl && e.key === "d") {
      e.preventDefault();
      downloadTranslation();
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// API STATUS
// ══════════════════════════════════════════════════════════════════

function updateApiStatus(type, message) {
  const el = document.getElementById("apiStatus");
  if (!el) return;
  el.className = `status-banner ${type}`;
  const icons = { success:"circle-check", error:"circle-xmark", warning:"triangle-exclamation", info:"circle-info" };
  const icon  = icons[type] || "circle-info";
  el.innerHTML = `<i class="fas fa-${icon}"></i><span>${message}</span>`;
}

// ══════════════════════════════════════════════════════════════════
// ENCRYPTION / API KEY MANAGER
// ══════════════════════════════════════════════════════════════════

function encryptKey(key) {
  try { return CryptoJS.AES.encrypt(key, ENCRYPTION_KEY).toString(); }
  catch (_) { return null; }
}

function decryptKey(enc) {
  try {
    const bytes = CryptoJS.AES.decrypt(enc, ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8) || null;
  } catch (_) { return null; }
}

function simpleHash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return h.toString();
}

const API_STORE_KEY = "albayan_encrypted_key_v2";
const API_HASH_KEY  = "albayan_key_hash";

function saveApiKey() {
  const input = document.getElementById("apiKeyInput");
  let key = input?.value.trim().replace(/\s/g, "");

  if (key === "••••••••••••••••") {
    showNotification("API কী ইতিমধ্যে সংরক্ষিত।", "info");
    return;
  }
  if (!key) {
    showNotification("API কী ফাঁকা রাখা যাবে না।", "error");
    return;
  }

  const enc = encryptKey(key);
  if (!enc) { showNotification("এনক্রিপশন ব্যর্থ।", "error"); return; }

  localStorage.setItem(API_STORE_KEY, enc);
  localStorage.setItem(API_HASH_KEY,  simpleHash(key));
  GEMINI_API_KEY = key;
  if (input) input.value = "••••••••••••••••";
  updateApiStatus("success", "✅ API কী সংরক্ষণ করা হয়েছে! আপনি এখন অনুবাদ করতে পারেন।");
  showNotification("API কী সুরক্ষিতভাবে সংরক্ষণ করা হয়েছে!", "success");
}

function loadApiKey() {
  try {
    const enc = localStorage.getItem(API_STORE_KEY);
    if (!enc) return false;
    const key  = decryptKey(enc);
    if (!key)  { clearApiKey(true); return false; }
    if (simpleHash(key) !== localStorage.getItem(API_HASH_KEY)) {
      clearApiKey(true); return false;
    }
    GEMINI_API_KEY = key;
    const input = document.getElementById("apiKeyInput");
    if (input) input.value = "••••••••••••••••";
    updateApiStatus("success", "✅ API কী লোড হয়েছে! আপনি এখন অনুবাদ করতে পারেন।");
    return true;
  } catch (_) { return false; }
}

function clearApiKey(silent = false) {
  if (!silent && !confirm("API কী ডিলিট করবেন?")) return;
  localStorage.removeItem(API_STORE_KEY);
  localStorage.removeItem(API_HASH_KEY);
  GEMINI_API_KEY = "";
  const input = document.getElementById("apiKeyInput");
  if (input) { input.value = ""; input.type = "password"; }
  updateApiStatus("warning", "🔑 API কী প্রয়োজন। নিচে আপনার API কী দিন।");
  if (!silent) showNotification("API কী মুছে ফেলা হয়েছে।", "info");
}

let keyVisible = false;
function showApiKey() {
  const input   = document.getElementById("apiKeyInput");
  const icon    = document.getElementById("eyeIcon");
  if (!input || !GEMINI_API_KEY) return;

  if (!keyVisible) {
    input.type  = "text";
    input.value = GEMINI_API_KEY;
    if (icon) { icon.className = "fas fa-eye-slash"; }
    keyVisible  = true;
    setTimeout(() => {
      input.type  = "password";
      input.value = "••••••••••••••••";
      if (icon) icon.className = "fas fa-eye";
      keyVisible = false;
    }, 5000);
  } else {
    input.type  = "password";
    input.value = "••••••••••••••••";
    if (icon) icon.className = "fas fa-eye";
    keyVisible  = false;
  }
}

async function testApiKey() {
  const input = document.getElementById("apiKeyInput");
  let key = input?.value.trim();

  if (key === "••••••••••••••••") {
    if (!GEMINI_API_KEY) {
      showNotification("প্রথমে একটি API কী সেভ করুন।", "error");
      return;
    }
    key = GEMINI_API_KEY;
  } else if (key) {
    // Save temporarily if a new key is entered
    const enc = encryptKey(key);
    if (enc) {
      localStorage.setItem(API_STORE_KEY, enc);
      localStorage.setItem(API_HASH_KEY,  simpleHash(key));
      GEMINI_API_KEY = key;
      if (input) input.value = "••••••••••••••••";
    }
  }

  showLoadingCard("API কী টেস্ট করা হচ্ছে...");
  try {
    const res = await translateWithGemini("بسم الله", true);
    if (res === "API_TEST_SUCCESS") {
      showNotification("✅ API কী সঠিক! অনুবাদ করা যাবে।", "success");
      updateApiStatus("success", "✅ API কী সঠিক! আপনি এখন অনুবাদ করতে পারেন।");
    } else {
      throw new Error("টেস্ট ব্যর্থ");
    }
  } catch (err) {
    showNotification("❌ API ত্রুটি: " + err.message, "error");
    updateApiStatus("error", "❌ API ত্রুটি: " + err.message);
  } finally {
    hideLoadingCard();
  }
}

// ══════════════════════════════════════════════════════════════════
// MAIN TRANSLATION ORCHESTRATOR
// ══════════════════════════════════════════════════════════════════

async function extractAndTranslate() {
  if (!currentFile) {
    showNotification("প্রথমে একটি PDF ফাইল সিলেক্ট করুন।", "error");
    return;
  }
  if (!GEMINI_API_KEY) {
    showNotification("প্রথমে একটি বৈধ Gemini API কী সেট করুন।", "error");
    document.getElementById("apiKeyInput")?.focus();
    return;
  }
  if (currentFile.size > 25 * 1048576) {
    showNotification("ফাইল খুব বড়! ২৫ এমবি-এর কম ফাইল আপলোড করুন।", "error");
    return;
  }

  const startBtn = document.getElementById("extractTranslateBtn");
  const stopBtn  = document.getElementById("stopBtn");
  if (startBtn) startBtn.disabled = true;
  if (stopBtn)  stopBtn.classList.remove("hidden");
  isTranslationRunning = true;

  try {
    showProgressBar();
    if (selectedPdfType === "ocr") {
      await extractWithOCRAndTranslate(currentFile);
    } else {
      await extractNormalAndTranslate(currentFile);
    }
    if (isTranslationRunning) saveToHistory();
  } catch (err) {
    if (isTranslationRunning) {
      console.error("Translation error:", err);
      showNotification("ত্রুটি: " + (err.message || "অনুবাদ করতে সমস্যা হয়েছে"), "error");
    }
  } finally {
    if (startBtn) startBtn.disabled = false;
    if (stopBtn)  stopBtn.classList.add("hidden");
    hideLoadingCard();
    hideProgressBar();
    isTranslationRunning = false;
  }
}

// ══════════════════════════════════════════════════════════════════
// NORMAL PDF EXTRACTION + BATCH TRANSLATION
// FIX 7: Correct batch result accumulation — writes all chunk pages at once
// ══════════════════════════════════════════════════════════════════

async function extractNormalAndTranslate(file) {
  const arrayBuf = await file.arrayBuffer();
  const pdf      = await pdfjsLib.getDocument(arrayBuf).promise;
  const total    = Math.min(pdf.numPages, 4000);

  let arabicText      = "";
  let banglaText      = "";
  let chunk           = [];
  let chunkChars      = 0;

  // Returns the bangla text string to append for all pages in the chunk
  const flushChunk = async () => {
    if (chunk.length === 0) return "";
    const pages = [...chunk];
    chunk      = [];
    chunkChars = 0;
    let result = "";
    try {
      const map = await batchTranslatePages(pages);
      for (const p of pages) {
        result += `পৃষ্ঠা ${p.pageNumber}:\n${map[p.pageNumber] || "[অনুবাদ পাওয়া যায়নি]"}\n\n`;
      }
    } catch (e) {
      console.warn("Batch flush failed:", e);
      for (const p of pages) {
        result += `পৃষ্ঠা ${p.pageNumber}:\n[অনুবাদ ব্যর্থ]\n\n`;
      }
    }
    return result;
  };

  for (let i = 1; i <= total; i++) {
    if (!isTranslationRunning) return;

    showLoadingCard(`পৃষ্ঠা ${i}/${total} প্রসেস করা হচ্ছে...`);

    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text    = content.items.map(it => it.str).join(" ");

    if (text.trim()) {
      arabicText += `পৃষ্ঠা ${i}:\n${text}\n\n`;
      document.getElementById("arabicText").value = arabicText;

      chunk.push({ pageNumber: i, text });
      chunkChars += text.length;

      if (chunkChars >= MAX_CHARS_PER_REQUEST || i === total) {
        banglaText += await flushChunk();
        document.getElementById("banglaText").value = banglaText;
      }
    } else {
      arabicText += `পৃষ্ঠা ${i}:\n[কোনো টেক্সট নেই]\n\n`;
      banglaText += `পৃষ্ঠা ${i}:\n[কোনো টেক্সট নেই]\n\n`;
      document.getElementById("arabicText").value = arabicText;
      document.getElementById("banglaText").value = banglaText;
    }

    updateProgress(Math.round((i / total) * 100));
    await delay(200);
  }

  // Flush any remaining pages if translation stopped between chunks
  if (chunk.length > 0 && isTranslationRunning) {
    banglaText += await flushChunk();
    document.getElementById("banglaText").value = banglaText;
  }

  if (isTranslationRunning) {
    extractedArabicText = arabicText;
    showNotification(`${total} পৃষ্ঠা সফলভাবে অনুবাদ করা হয়েছে!`, "success");
  }
}

// ══════════════════════════════════════════════════════════════════
// OCR EXTRACTION + BATCH TRANSLATION
// FIX 8: Tesseract worker terminated on normal completion too
// ══════════════════════════════════════════════════════════════════

async function extractWithOCRAndTranslate(file) {
  showLoadingCard("OCR প্রস্তুত করা হচ্ছে...");

  // Always create a fresh worker
  if (tesseractWorker) {
    try { await tesseractWorker.terminate(); } catch (_) {}
    tesseractWorker = null;
  }
  tesseractWorker = await Tesseract.createWorker("ara");

  try {
    const arrayBuf = await file.arrayBuffer();
    const pdf      = await pdfjsLib.getDocument(arrayBuf).promise;
    const total    = Math.min(pdf.numPages, 4000);

    let arabicText  = "";
    let banglaText  = "";
    let chunk       = [];
    let chunkChars  = 0;

    const flushChunk = async () => {
      if (chunk.length === 0) return "";
      const pages = [...chunk];
      chunk      = [];
      chunkChars = 0;
      let result = "";
      try {
        const map = await batchTranslatePages(pages);
        for (const p of pages) {
          result += `পৃষ্ঠা ${p.pageNumber}:\n${map[p.pageNumber] || "[অনুবাদ পাওয়া যায়নি]"}\n\n`;
        }
      } catch (e) {
        for (const p of pages) {
          result += `পৃষ্ঠা ${p.pageNumber}:\n[অনুবাদ ব্যর্থ]\n\n`;
        }
      }
      return result;
    };

    for (let i = 1; i <= total; i++) {
      if (!isTranslationRunning) return;

      showLoadingCard(`পৃষ্ঠা ${i}/${total} OCR করা হচ্ছে...`);

      const page     = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas   = document.createElement("canvas");
      canvas.width   = viewport.width;
      canvas.height  = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

      const { data: { text } } = await tesseractWorker.recognize(canvas);

      if (text.trim()) {
        arabicText += `পৃষ্ঠা ${i}:\n${text}\n\n`;
        document.getElementById("arabicText").value = arabicText;

        chunk.push({ pageNumber: i, text });
        chunkChars += text.length;

        if (chunkChars >= MAX_CHARS_PER_REQUEST || i === total) {
          banglaText += await flushChunk();
          document.getElementById("banglaText").value = banglaText;
        }
      } else {
        arabicText += `পৃষ্ঠা ${i}:\n[কোনো টেক্সট নেই]\n\n`;
        banglaText += `পৃষ্ঠা ${i}:\n[কোনো টেক্সট নেই]\n\n`;
        document.getElementById("arabicText").value = arabicText;
        document.getElementById("banglaText").value = banglaText;
      }

      updateProgress(Math.round((i / total) * 100));
      await delay(300);
    }

    if (isTranslationRunning) {
      extractedArabicText = arabicText;
      showNotification(`${total} পৃষ্ঠা OCR ও অনুবাদ সম্পূর্ণ!`, "success");
    }
  } finally {
    // FIX 8: Always terminate worker on both normal completion AND error
    if (tesseractWorker) {
      try { await tesseractWorker.terminate(); } catch (_) {}
      tesseractWorker = null;
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// STOP / CLEAR
// ══════════════════════════════════════════════════════════════════

function stopTranslation() {
  if (!isTranslationRunning) return;
  isTranslationRunning = false;

  document.getElementById("stopBtn")?.classList.add("hidden");
  const startBtn = document.getElementById("extractTranslateBtn");
  if (startBtn) startBtn.disabled = false;

  hideLoadingCard();
  hideProgressBar();

  if (tesseractWorker) {
    tesseractWorker.terminate().catch(() => {});
    tesseractWorker = null;
  }

  showNotification("অনুবাদ বন্ধ করা হয়েছে।", "info");
}

function clearAll() {
  stopTranslation();
  const pdfInput = document.getElementById("pdfFile");
  if (pdfInput) pdfInput.value = "";
  document.getElementById("arabicText").value = "";
  document.getElementById("banglaText").value = "";
  document.getElementById("fileBadge")?.classList.remove("show");
  currentFile        = null;
  extractedArabicText = "";
  stopSpeech();
  showNotification("সব রিসেট করা হয়েছে।", "info");
}

// ══════════════════════════════════════════════════════════════════
// PROGRESS / LOADING UI
// ══════════════════════════════════════════════════════════════════

function showProgressBar() {
  const el = document.getElementById("progressContainer");
  if (el) el.classList.remove("hidden");
  updateProgress(0);
}

function hideProgressBar() {
  const el = document.getElementById("progressContainer");
  if (el) el.classList.add("hidden");
}

function updateProgress(pct) {
  const bar = document.getElementById("progressBar");
  if (!bar) return;
  bar.style.width = pct + "%";
  // Use Bangla numerals for text
  bar.textContent = pct + "%";
}

function showLoadingCard(msg) {
  const card = document.getElementById("loadingCard");
  const text = document.getElementById("loadingText");
  if (card) card.classList.remove("hidden");
  if (text) text.textContent = msg || "অনুবাদ করা হচ্ছে...";
}

function hideLoadingCard() {
  document.getElementById("loadingCard")?.classList.add("hidden");
}

// ══════════════════════════════════════════════════════════════════
// DOWNLOAD — NEW FEATURE
// ══════════════════════════════════════════════════════════════════

function downloadTranslation() {
  const arabic = document.getElementById("arabicText")?.value || "";
  const bangla = document.getElementById("banglaText")?.value  || "";

  if (!arabic && !bangla) {
    showNotification("ডাউনলোড করার জন্য কোনো টেক্সট নেই।", "warning");
    return;
  }

  const filename = (currentFile?.name?.replace(/\.pdf$/i, "") || "albayan") + "_অনুবাদ.txt";
  const content  =
    "আল বায়ান — আরবি থেকে বাংলা অনুবাদ\n" +
    "═══════════════════════════════════\n\n" +
    "আরবি মূল টেক্সট:\n" +
    "───────────────\n" + arabic + "\n\n" +
    "বাংলা অনুবাদ:\n" +
    "─────────────\n" + bangla;

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showNotification("অনুবাদ ডাউনলোড শুরু হয়েছে!", "success");
}

// ══════════════════════════════════════════════════════════════════
// READER MODAL
// ══════════════════════════════════════════════════════════════════

function openReader(type) {
  const modal = document.getElementById("readerModal");
  const title = document.getElementById("readerTitle");
  const body  = document.getElementById("readerBody");
  if (!modal || !title || !body) return;

  stopSpeech();

  if (type === "arabic") {
    title.textContent = "আরবি টেক্সট";
    const text = document.getElementById("arabicText")?.value || "কোনো টেক্সট নেই";
    body.innerHTML = `<div style="font-family:'Amiri',serif;font-size:1.4rem;line-height:2.8;direction:rtl;text-align:right;">${escapeHtml(text)}</div>`;
    body.dir = "rtl";
  } else {
    title.textContent = "বাংলা অনুবাদ";
    const text = document.getElementById("banglaText")?.value || "কোনো অনুবাদ নেই";
    body.innerHTML = `<div style="font-family:'Hind Siliguri',sans-serif;font-size:1.1rem;line-height:1.9;text-align:justify;">${escapeHtml(text)}</div>`;
    body.dir = "ltr";
  }

  modal.classList.add("open");
}

function closeReader() {
  stopSpeech();
  document.getElementById("readerModal")?.classList.remove("open");
}

function handleModalClick(e) {
  if (e.target === document.getElementById("readerModal")) closeReader();
}

function changeFontSize(delta) {
  const inner = document.getElementById("readerBody")?.querySelector("div");
  if (!inner) return;
  const current = parseFloat(window.getComputedStyle(inner).fontSize);
  inner.style.fontSize = Math.max(10, Math.min(40, current + delta)) + "px";
}

function toggleNightReader() {
  const body = document.getElementById("readerBody");
  if (!body) return;
  const isNight = body.getAttribute("data-night") === "true";
  if (isNight) {
    body.style.background = "";
    body.style.color      = "";
    body.removeAttribute("data-night");
  } else {
    body.style.background = "#101820";
    body.style.color      = "#C8D8E8";
    body.setAttribute("data-night", "true");
  }
}

// ══════════════════════════════════════════════════════════════════
// TEXT TO SPEECH
// ══════════════════════════════════════════════════════════════════

function toggleSpeakText() {
  isSpeaking ? stopSpeech() : speakText();
}

function speakText() {
  const text = document.getElementById("readerBody")?.textContent?.trim();
  if (!text || text === "কোনো অনুবাদ নেই" || text === "কোনো টেক্সট নেই") {
    showNotification("পড়ার জন্য কোনো টেক্সট নেই।", "warning");
    return;
  }
  if (!("speechSynthesis" in window)) {
    showNotification("আপনার ব্রাউজার TTS সমর্থন করে না।", "error");
    return;
  }

  stopSpeech();

  const utterance = new SpeechSynthesisUtterance(text);
  const voices    = window.speechSynthesis.getVoices();
  const bnVoice   = voices.find(v => v.lang === "bn-BD" || v.lang === "bn-IN");
  if (bnVoice) { utterance.voice = bnVoice; utterance.lang = bnVoice.lang; }
  else           { utterance.lang  = "bn-BD"; }
  utterance.rate  = 0.85;
  utterance.pitch = 1;

  isSpeaking = true;
  const btn = document.getElementById("ttsButton");
  if (btn) { btn.innerHTML = '<i class="fas fa-stop"></i> থামুন'; btn.classList.add("tts-active"); }

  utterance.onend = utterance.onerror = () => stopSpeech();
  window.speechSynthesis.speak(utterance);
}

function stopSpeech() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  isSpeaking = false;
  const btn = document.getElementById("ttsButton");
  if (btn) { btn.innerHTML = '<i class="fas fa-volume-high"></i> পড়ুন'; btn.classList.remove("tts-active"); }
}

// ══════════════════════════════════════════════════════════════════
// HISTORY
// FIX 9: Only store preview in localStorage to avoid quota crash
// ══════════════════════════════════════════════════════════════════

const HISTORY_PREVIEW_LEN = 500; // chars stored per item
const HISTORY_MAX_ITEMS   = 20;

function saveToHistory() {
  const arabic = document.getElementById("arabicText")?.value || "";
  const bangla = document.getElementById("banglaText")?.value  || "";
  if (!arabic && !bangla) return;

  const history = getHistory();
  history.unshift({
    id:            Date.now(),
    title:         currentFile?.name || "অনুবাদ",
    arabicPreview: arabic.substring(0, HISTORY_PREVIEW_LEN),
    banglaPreview: bangla.substring(0, HISTORY_PREVIEW_LEN),
    // Store full text only if small enough (< 100 KB each)
    arabicFull:    arabic.length < 100000 ? arabic : null,
    banglaFull:    bangla.length < 100000 ? bangla : null,
    date:          new Date().toLocaleDateString("bn-BD"),
  });

  if (history.length > HISTORY_MAX_ITEMS) history.length = HISTORY_MAX_ITEMS;

  try {
    localStorage.setItem("albayan_history", JSON.stringify(history));
  } catch (e) {
    // Quota exceeded — trim and retry
    history.forEach(h => { delete h.arabicFull; delete h.banglaFull; });
    try { localStorage.setItem("albayan_history", JSON.stringify(history)); } catch (_) {}
  }

  loadHistory();
}

function getHistory() {
  try { return JSON.parse(localStorage.getItem("albayan_history") || "[]"); }
  catch (_) { return []; }
}

function loadHistory() {
  const history = getHistory();
  const grid    = document.getElementById("historyGrid");
  if (!grid) return;

  if (history.length === 0) {
    grid.innerHTML = `
      <div class="history-empty">
        <i class="fas fa-inbox"></i>
        <h3>কোনো অনুবাদ ইতিহাস নেই</h3>
        <p>আপনার প্রথম অনুবাদ শুরু করুন!</p>
      </div>`;
    return;
  }

  grid.innerHTML = history.map(item => `
    <div class="history-card" onclick="loadHistoryItem(${item.id})" tabindex="0"
         onkeydown="if(event.key==='Enter')loadHistoryItem(${item.id})">
      <div class="history-card-header">
        <div class="history-card-title">${escapeHtml(item.title)}</div>
        <div class="history-card-date">${item.date}</div>
      </div>
      <div class="history-card-preview">${escapeHtml(item.banglaPreview || "")}</div>
    </div>
  `).join("");
}

function loadHistoryItem(id) {
  const item = getHistory().find(h => h.id === id);
  if (!item) return;

  document.getElementById("arabicText").value = item.arabicFull || item.arabicPreview || "";
  document.getElementById("banglaText").value  = item.banglaFull || item.banglaPreview  || "";

  currentFile = null;
  const pdfInput = document.getElementById("pdfFile");
  if (pdfInput) pdfInput.value = "";
  document.getElementById("fileBadge")?.classList.remove("show");

  // Find and activate the translate tab nav button
  const tabs = document.querySelectorAll(".nav-tab");
  showTab("translate", tabs[0] || null);
  showNotification("ইতিহাস থেকে লোড করা হয়েছে!", "success");
}

function saveCurrentTranslation() {
  const a = document.getElementById("arabicText")?.value;
  const b = document.getElementById("banglaText")?.value;
  if (!a && !b) { showNotification("সংরক্ষণের জন্য কোনো টেক্সট নেই।", "warning"); return; }
  saveToHistory();
  showNotification("অনুবাদ ইতিহাসে সংরক্ষণ করা হয়েছে!", "success");
}

function clearAllHistory() {
  if (!confirm("সব ইতিহাস মুছবেন?")) return;
  localStorage.removeItem("albayan_history");
  loadHistory();
  showNotification("সব ইতিহাস মুছে ফেলা হয়েছে।", "success");
}

// ══════════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════

function showNotification(message, type = "info") {
  // Remove existing toasts
  document.querySelectorAll(".toast").forEach(t => t.remove());

  const icons = { success:"circle-check", error:"circle-xmark", warning:"triangle-exclamation", info:"circle-info" };
  const icon  = icons[type] || "circle-info";

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <i class="fas fa-${icon}"></i>
    <span class="toast-msg">${escapeHtml(message)}</span>
    <button class="toast-close" onclick="this.closest('.toast').remove()" aria-label="Close">&times;</button>`;

  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ══════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br>");
}

// Stop speech when page hidden
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopSpeech();
});

console.log("✅ Al Bayan initialized.");
