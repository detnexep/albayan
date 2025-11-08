// Global variables
let extractedText = "";
let selectedPdfType = "text";
let tesseractWorker = null;
let currentFile = null;
let isSpeaking = false;
let speechSynthesis = window.speechSynthesis;
let GEMINI_API_KEY = "";
let isTranslationRunning = false;
let currentTranslationProcess = null;

// Gemini API Configuration
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
  initializeTheme();
  loadApiKey();
  setupEventListeners();
  loadHistory();
});

// Load API Key from localStorage
function loadApiKey() {
  const savedKey = localStorage.getItem("gemini_api_key");
  if (savedKey) {
    GEMINI_API_KEY = savedKey;
    document.getElementById("apiKeyInput").value = "••••••••••••••••";
    updateApiStatus(
      "success",
      "✅ API টি লোড হয়েছে! আপনি এখন অনুবাদ করতে পারেন।",
    );
  }
}

// Save API Key
function saveApiKey() {
  const apiKey = document.getElementById("apiKeyInput").value.trim();
  if (!apiKey) {
    alert("দয়া করে একটি বৈধ API দিন।");
    return;
  }

  // If input is masked, don't save the mask
  if (apiKey === "••••••••••••••••") {
    return;
  }

  GEMINI_API_KEY = apiKey;
  localStorage.setItem("gemini_api_key", apiKey);
  document.getElementById("apiKeyInput").value = "••••••••••••••••";
  updateApiStatus(
    "success",
    "✅ API টি সংরক্ষণ করা হয়েছে! আপনি এখন অনুবাদ করতে পারেন।",
  );
}

// Test API Key
async function testApiKey() {
  const apiKey = document.getElementById("apiKeyInput").value.trim();

  if (!apiKey || apiKey === "••••••••••••••••") {
    if (!GEMINI_API_KEY) {
      alert("দয়া করে প্রথমে একটি API টি দিন।");
      return;
    }
    // Use existing key
  } else {
    GEMINI_API_KEY = apiKey;
    localStorage.setItem("gemini_api_key", apiKey);
  }

  showLoading("API টি টেস্ট করা হচ্ছে...");

  try {
    const testResult = await translateWithGemini("سلام", true);
    if (testResult.includes("API_ERROR")) {
      throw new Error("API টি বৈধ নয়");
    }
    updateApiStatus("success", "✅ API টি সঠিক! আপনি এখন অনুবাদ করতে পারেন।");
  } catch (error) {
    updateApiStatus("error", "❌ API টি ত্রুটি: " + error.message);
  } finally {
    hideLoading();
  }
}

// Update API Status
function updateApiStatus(type, message) {
  const statusDiv = document.getElementById("apiStatus");
  statusDiv.className = `api-status ${type}`;
  statusDiv.innerHTML = message;
}

// Theme functionality
function initializeTheme() {
  const themeToggle = document.getElementById("themeToggle");
  const savedTheme = localStorage.getItem("theme") || "light"; 

  if (savedTheme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    themeToggle.checked = true;
  }

  themeToggle.addEventListener("change", function () {
    if (this.checked) {
      document.documentElement.setAttribute("data-theme", "dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
      localStorage.setItem("theme", "light");
    }
  });
}

// Event listeners
function setupEventListeners() {
  // File upload handling
  document.getElementById("pdfFile").addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (!file) return;

    currentFile = file;
    displayFileInfo(file);
  });
}

// Display file information
function displayFileInfo(file) {
  const fileInfo = document.getElementById("fileInfo");
  const fileName = document.getElementById("fileName");
  const fileSize = document.getElementById("fileSize");

  const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);

  fileName.textContent = file.name;
  fileSize.textContent = `আকার: ${fileSizeMB} MB`;
  fileInfo.style.display = "block";

  // Show warning for large files
  if (file.size > 10 * 1024 * 1024) {
    showWarning(`বড় ফাইল (${fileSizeMB} MB): প্রসেসিং বেশি সময় নিতে পারে।`);
  }
}

// PDF type selection
function selectPdfType(type) {
  selectedPdfType = type;
  document.querySelectorAll(".pdf-type-option").forEach((opt) => {
    opt.classList.remove("active");
  });
  event.currentTarget.classList.add("active");
}

// Stop translation function
function stopTranslation() {
  if (isTranslationRunning) {
    isTranslationRunning = false;
    document.getElementById("stopBtn").style.display = "none";
    document.getElementById("extractTranslateBtn").disabled = false;
    hideLoading();
    document.getElementById("progressContainer").style.display = "none";
    showWarning("অনুবাদ বন্ধ করা হয়েছে!");

    // Clean up Tesseract worker if it exists
    if (tesseractWorker) {
      tesseractWorker.terminate();
      tesseractWorker = null;
    }
  }
}

// Main translation function
async function extractAndTranslate() {
  if (!currentFile) {
    alert("দয়া করে প্রথমে একটি PDF ফাইল সিলেক্ট করুন।");
    return;
  }

  if (!GEMINI_API_KEY) {
    alert("দয়া করে প্রথমে একটি বৈধ জিমিনি API কী সেট করুন।");
    document.getElementById("apiKeyInput").focus();
    return;
  }

  // File size validation
  if (currentFile.size > 20 * 1024 * 1024) {
    alert("ফাইল খুব বড়! দয়া করে ২০ এমবি-এর ছোট ফাইল আপলোড করুন।");
    return;
  }

  const extractTranslateBtn = document.getElementById("extractTranslateBtn");
  extractTranslateBtn.disabled = true;
  document.getElementById("stopBtn").style.display = "inline-flex";
  isTranslationRunning = true;

  try {
    showLoading("PDF প্রসেস করা হচ্ছে...");

    if (selectedPdfType === "ocr") {
      await extractWithOCRAndTranslate(currentFile);
    } else {
      await extractNormalAndTranslate(currentFile);
    }

    if (isTranslationRunning) {
      // Save to history only if not stopped
      saveToHistory();
    }
  } catch (error) {
    if (isTranslationRunning) {
      console.error("Translation error:", error);
      alert("ত্রুটি: " + (error.message || "অনুবাদ করতে সমস্যা হয়েছে"));
    }
  } finally {
    if (isTranslationRunning) {
      extractTranslateBtn.disabled = false;
      document.getElementById("stopBtn").style.display = "none";
      hideLoading();
      isTranslationRunning = false;
    }
  }
}

// Normal PDF extraction with translation
async function extractNormalAndTranslate(file) {
  try {
    const pdf = await pdfjsLib.getDocument(await file.arrayBuffer()).promise;
    const totalPages = Math.min(pdf.numPages, 400); // 20 pages maximum
    let arabicText = "";
    let banglaTranslation = "";

    document.getElementById("progressContainer").style.display = "block";

    for (let i = 1; i <= totalPages; i++) {
      // Check if translation was stopped
      if (!isTranslationRunning) {
        console.log("Translation stopped by user");
        return;
      }

      showLoading(`পৃষ্ঠা ${i}/${totalPages} প্রসেস করা হচ্ছে...`);

      // Extract text from page
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(" ");

      if (pageText.trim().length > 0) {
        arabicText += `পৃষ্ঠা ${i}:\n${pageText}\n\n`;
        document.getElementById("arabicText").value = arabicText;

        // Use actual Gemini API for translation
        const translatedText = await translateWithGemini(pageText);
        banglaTranslation += `পৃষ্ঠা ${i}:\n${translatedText}\n\n`;
        document.getElementById("banglaText").value = banglaTranslation;
      }

      // Update progress
      const progress = Math.round((i / totalPages) * 100);
      updateProgress(progress);

      // Add delay to prevent rate limiting
      await delay(2000);
    }

    if (isTranslationRunning) {
      extractedText = arabicText;
      document.getElementById("progressContainer").style.display = "none";
      showSuccess(`${totalPages} পৃষ্ঠা সফলভাবে অনুবাদ করা হয়েছে!`);
    }
  } catch (error) {
    if (isTranslationRunning) {
      throw new Error("PDF পড়তে সমস্যা: " + error.message);
    }
  }
}

// OCR extraction with translation
async function extractWithOCRAndTranslate(file) {
  showLoading("OCR প্রস্তুত করা হচ্ছে...");

  try {
    if (!tesseractWorker) {
      tesseractWorker = await Tesseract.createWorker("ara");
    }

    const pdf = await pdfjsLib.getDocument(await file.arrayBuffer()).promise;
    const totalPages = Math.min(pdf.numPages, 10); // 10 pages maximum for OCR
    let arabicText = "";
    let banglaTranslation = "";

    document.getElementById("progressContainer").style.display = "block";

    for (let i = 1; i <= totalPages; i++) {
      // Check if translation was stopped
      if (!isTranslationRunning) {
        console.log("Translation stopped by user");
        if (tesseractWorker) {
          tesseractWorker.terminate();
          tesseractWorker = null;
        }
        return;
      }

      showLoading(`পৃষ্ঠা ${i}/${totalPages} OCR করা হচ্ছে...`);

      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      canvas.height = viewport.height;
      canvas.width = viewport.width;

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;

      const {
        data: { text },
      } = await tesseractWorker.recognize(canvas);

      if (text.trim().length > 0) {
        arabicText += `পৃষ্ঠা ${i}:\n${text}\n\n`;
        document.getElementById("arabicText").value = arabicText;

        // Use actual Gemini API for translation
        const translatedText = await translateWithGemini(text);
        banglaTranslation += `পৃষ্ঠা ${i}:\n${translatedText}\n\n`;
        document.getElementById("banglaText").value = banglaTranslation;
      }

      // Update progress
      const progress = Math.round((i / totalPages) * 100);
      updateProgress(progress);

      await delay(2500);
    }

    if (isTranslationRunning) {
      extractedText = arabicText;
      document.getElementById("progressContainer").style.display = "none";
      showSuccess(`${totalPages} পৃষ্ঠা OCR এবং অনুবাদ সম্পূর্ণ!`);
    }
  } catch (error) {
    if (isTranslationRunning) {
      throw new Error("OCR ত্রুটি: " + error.message);
    }
  }
}

// Real Gemini API translation
async function translateWithGemini(text, isTest = false) {
  if (!GEMINI_API_KEY) {
    throw new Error("API টি পাওয়া যায়নি। দয়া করে API টিসেট করুন।");
  }

  // Check if translation was stopped
  if (!isTranslationRunning) {
    return "অনুবাদ বন্ধ করা হয়েছে";
  }

  try {
    const apiUrl = `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: `Translate this Arabic Islamic text to natural Bangla accurately. Preserve religious meaning and Islamic terminology. Keep the translation concise and natural. Only return the translated text, no additional comments.
                            
                            Arabic Text: ${text.substring(0, 3000)}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        topK: 40,
        topP: 0.8,
        maxOutputTokens: 2000,
      },
    };

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        errorData.error?.message || `API Error: ${response.status}`,
      );
    }

    const data = await response.json();
    const translatedText = data.candidates[0].content.parts[0].text;

    if (isTest) {
      return "API_TEST_SUCCESS";
    }

    return translatedText;
  } catch (error) {
    console.error("Gemini API error:", error);
    if (isTest) {
      return "API_ERROR: " + error.message;
    }
    throw new Error(`অনুবাদ ব্যর্থ: ${error.message}`);
  }
}

// Utility functions
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function showLoading(message) {
  document.getElementById("loading").style.display = "block";
  document.getElementById("loadingText").textContent = message;
}

function hideLoading() {
  document.getElementById("loading").style.display = "none";
}

function updateProgress(percent) {
  document.getElementById("progressBar").style.width = percent + "%";
  document.getElementById("progressBar").textContent = percent + "%";
}

function showWarning(message) {
  alert("⚠️ " + message);
}

function showSuccess(message) {
  alert("✅ " + message);
}

// Tab navigation
function showTab(tabName) {
  document.querySelectorAll(".main-card").forEach((tab) => {
    tab.classList.add("hidden");
  });

  document.querySelectorAll(".nav-tab").forEach((tab) => {
    tab.classList.remove("active");
  });

  document.getElementById(tabName + "-tab").classList.remove("hidden");
  event.currentTarget.classList.add("active");
}

// Reader functionality
function openReader(type) {
  const modal = document.getElementById("readerModal");
  const title = document.getElementById("readerTitle");
  const body = document.getElementById("readerBody");

  let content = "";
  if (type === "arabic") {
    title.textContent = "আরবি টেক্সট";
    content = document.getElementById("arabicText").value || "কোনো টেক্সট নেই";
    body.innerHTML = `<div class="arabic-text" style="font-size: 24px; line-height: 3;">${content}</div>`;
  } else {
    title.textContent = "বাংলা অনুবাদ";
    content = document.getElementById("banglaText").value || "কোনো অনুবাদ নেই";
    body.innerHTML = `<div class="bangla-text" style="font-size: 20px; line-height: 2;">${content}</div>`;
  }

  modal.style.display = "block";

  // Stop any ongoing speech when opening reader
  stopSpeech();
}

function closeReader() {
  // Stop speech when closing reader
  stopSpeech();
  document.getElementById("readerModal").style.display = "none";
}

function changeFontSize(delta) {
  const body = document.getElementById("readerBody");
  const currentSize = parseInt(
    window.getComputedStyle(body.querySelector("div")).fontSize,
  );
  const newSize = Math.max(12, Math.min(40, currentSize + delta));
  body.querySelector("div").style.fontSize = newSize + "px";
}

function toggleDarkReader() {
  const body = document.getElementById("readerBody");
  const isDark = body.style.backgroundColor === "rgb(26, 32, 44)";

  if (isDark) {
    body.style.backgroundColor = "";
    body.style.color = "";
  } else {
    body.style.backgroundColor = "#1A202C";
    body.style.color = "#CBD5E0";
  }
}

// Text-to-speech with toggle functionality
function toggleSpeakText() {
  if (isSpeaking) {
    stopSpeech();
  } else {
    speakText();
  }
}

function speakText() {
  const text = document.getElementById("readerBody").textContent;
  if (!text || text === "কোনো অনুবাদ নেই" || text === "কোনো টেক্সট নেই") {
    alert("পড়ার জন্য কোনো টেক্সট নেই।");
    return;
  }

  if ("speechSynthesis" in window) {
    stopSpeech(); // Stop any ongoing speech first

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "bn-BD";
    utterance.rate = 0.8;
    utterance.pitch = 1;

    // Update button state
    isSpeaking = true;
    const ttsButton = document.getElementById("ttsButton");
    ttsButton.innerHTML = '<i class="fas fa-stop"></i> থামুন';
    ttsButton.classList.add("tts-active");

    // Handle speech end
    utterance.onend = function () {
      stopSpeech();
    };

    // Handle speech error
    utterance.onerror = function () {
      stopSpeech();
      alert("Text-to-speech ত্রুটি হয়েছে।");
    };

    speechSynthesis.speak(utterance);
  } else {
    alert("Text-to-speech is not supported in your browser.");
  }
}

function stopSpeech() {
  if ("speechSynthesis" in window) {
    speechSynthesis.cancel();
  }
  isSpeaking = false;
  const ttsButton = document.getElementById("ttsButton");
  ttsButton.innerHTML = '<i class="fas fa-volume-up"></i> পড়ুন';
  ttsButton.classList.remove("tts-active");
}

// History functionality
function saveToHistory() {
  const history = JSON.parse(
    localStorage.getItem("translationHistory") || "[]",
  );
  const newItem = {
    id: Date.now(),
    title: currentFile?.name || "অনুবাদ",
    arabicText:
      document.getElementById("arabicText").value.substring(0, 200) + "...",
    banglaText:
      document.getElementById("banglaText").value.substring(0, 200) + "...",
    date: new Date().toLocaleDateString("bn-BD"),
  };

  history.unshift(newItem);
  localStorage.setItem("translationHistory", JSON.stringify(history));
  loadHistory();
}

function loadHistory() {
  const history = JSON.parse(
    localStorage.getItem("translationHistory") || "[]",
  );
  const historyGrid = document.getElementById("historyGrid");

  if (history.length === 0) {
    historyGrid.innerHTML = `
                    <div style="text-align: center; color: var(--text-light); padding: 40px;">
                        <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 20px;"></i>
                        <p>কোনো অনুবাদ ইতিহাস নেই</p>
                    </div>
                `;
    return;
  }

  historyGrid.innerHTML = history
    .map(
      (item) => `
                <div class="history-card" onclick="loadHistoryItem(${item.id})">
                    <div class="history-card-header">
                        <div class="history-title">${item.title}</div>
                        <div class="history-date">${item.date}</div>
                    </div>
                    <div class="history-preview">${item.banglaText}</div>
                </div>
            `,
    )
    .join("");
}

function loadHistoryItem(id) {
  const history = JSON.parse(
    localStorage.getItem("translationHistory") || "[]",
  );
  const item = history.find((h) => h.id === id);

  if (item) {
    // For demo, we only have preview text in history
    // In real implementation, you'd store full text
    document.getElementById("arabicText").value = item.arabicText;
    document.getElementById("banglaText").value = item.banglaText;
    showTab("translate");
    showSuccess("ইতিহাস থেকে লোড করা হয়েছে!");
  }
}

// Clear all function
function clearAll() {
  // Stop any ongoing translation first
  stopTranslation();

  document.getElementById("pdfFile").value = "";
  document.getElementById("arabicText").value = "";
  document.getElementById("banglaText").value = "";
  document.getElementById("fileInfo").style.display = "none";
  document.getElementById("progressContainer").style.display = "none";
  currentFile = null;
  extractedText = "";

  // Stop any ongoing speech
  stopSpeech();

  alert("সব কিছু রিসেট করা হয়েছে।");
}

// Close modal when clicking outside
window.onclick = function (event) {
  const modal = document.getElementById("readerModal");
  if (event.target === modal) {
    closeReader();
  }
};

// Stop speech when page is hidden
document.addEventListener("visibilitychange", function () {
  if (document.hidden) {
    stopSpeech();
  }
});
