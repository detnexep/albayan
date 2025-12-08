// Global variables
let extractedText = "";
let selectedPdfType = "text";
let tesseractWorker = null;
let currentFile = null;
let isSpeaking = false;
let speechSynthesis = window.speechSynthesis;
let GEMINI_API_KEY = "";
let isTranslationRunning = false;

// Gemini API Configuration
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent";
// Encryption Key
const ENCRYPTION_KEY = 'al-bayan-secure-key-2025-32chars!!';

console.log("Al Bayan App Initializing...");

// Initialize the application
document.addEventListener("DOMContentLoaded", function () {
    console.log("DOM Content Loaded");
    initializeTheme();
    loadApiKey();
    setupEventListeners();
    loadHistory();
    initializeEnhancedFeatures();
    showNotification("Al Bayan অ্যাপ্লিকেশন সফলভাবে লোড হয়েছে!", 'success');
});

// ==================== BASIC FUNCTIONS ====================

// Theme functionality
function initializeTheme() {
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem("theme") || "dark";

    if (savedTheme === "dark") {
        document.documentElement.setAttribute("data-theme", "dark");
        if (themeToggle) themeToggle.checked = true;
    }

    if (themeToggle) {
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
}

// Event listeners
function setupEventListeners() {
    const pdfFileInput = document.getElementById('pdfFile');
    if (pdfFileInput) {
        pdfFileInput.addEventListener('change', function (e) {
            const file = e.target.files[0];
            if (!file) return;
            currentFile = file;
            displayFileInfo(file);
        });
    }
}

// Display file information
function displayFileInfo(file) {
    const fileInfo = document.getElementById("fileInfo");
    const fileName = document.getElementById("fileName");
    const fileSize = document.getElementById("fileSize");

    if (!fileInfo || !fileName || !fileSize) return;

    const fileSizeMB = (file.size / (1024 * 1024)).toFixed(2);

    fileName.textContent = file.name;
    fileSize.textContent = `আকার: ${fileSizeMB} MB`;
    fileInfo.style.display = "block";

    if (file.size > 10 * 1024 * 1024) {
        showNotification(`বড় ফাইল (${fileSizeMB} MB): প্রসেসিং বেশি সময় নিতে পারে।`, 'warning');
    }
}

// PDF type selection
function selectPdfType(type) {
    selectedPdfType = type;
    document.querySelectorAll(".pdf-type-option").forEach((opt) => {
        opt.classList.remove("active");
        opt.style.border = "2px solid transparent";
    });
    
    const activeOption = event.currentTarget;
    activeOption.classList.add("active");
    activeOption.style.border = "2px solid #3E8999";
}

// Update API Status
function updateApiStatus(type, message) {
    const statusDiv = document.getElementById("apiStatus");
    if (statusDiv) {
        statusDiv.className = `api-status ${type}`;
        statusDiv.innerHTML = message;
    }
}

// ==================== ENHANCED FEATURES ====================

// Enhanced Notification System
function showNotification(message, type = 'info') {
    console.log("Notification:", message, type);
    
    // Remove existing notifications
    const existingNotifications = document.querySelectorAll('.custom-notification');
    existingNotifications.forEach(notif => notif.remove());

    const notification = document.createElement('div');
    notification.className = `custom-notification ${type}`;
    
    const bgColor = type === 'error' ? '#dc3545' : 
                    type === 'success' ? '#28a745' : 
                    type === 'warning' ? '#ffc107' : '#17a2b8';
    
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 8px;
        color: ${type === 'warning' ? 'black' : 'white'};
        font-weight: 600;
        z-index: 10000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        background: ${bgColor};
        display: flex;
        align-items: center;
        gap: 10px;
        max-width: 400px;
    `;
    
    const icon = type === 'error' ? 'exclamation-triangle' : 
                 type === 'success' ? 'check-circle' : 
                 type === 'warning' ? 'exclamation-circle' : 'info-circle';
    
    notification.innerHTML = `
        <i class="fas fa-${icon}"></i>
        <span>${message}</span>
        <button onclick="this.parentElement.remove()" style="
            background: none;
            border: none;
            color: inherit;
            margin-left: 15px;
            cursor: pointer;
            font-size: 18px;
        ">&times;</button>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentElement) {
            notification.remove();
        }
    }, 5000);
}

// Encryption Functions
function encryptWithCryptoJS(apiKey) {
    try {
        return CryptoJS.AES.encrypt(apiKey, ENCRYPTION_KEY).toString();
    } catch (error) {
        console.error('Encryption error:', error);
        return null;
    }
}

function decryptWithCryptoJS(encryptedKey) {
    try {
        const bytes = CryptoJS.AES.decrypt(encryptedKey, ENCRYPTION_KEY);
        const decrypted = bytes.toString(CryptoJS.enc.Utf8);
        return decrypted || null;
    } catch (error) {
        console.error('Decryption error:', error);
        return null;
    }
}

// API Key Manager
class ApiKeyManager {
    constructor() {
        this.storageKey = 'encrypted_gemini_key_v2';
    }
    
    saveApiKey(apiKey) {
        if (!apiKey || apiKey.trim() === '') {
            throw new Error('API key cannot be empty');
        }
        
        apiKey = apiKey.trim().replace(/\s/g, '');
        const encryptedKey = encryptWithCryptoJS(apiKey);
        
        if (!encryptedKey) {
            throw new Error('Encryption failed');
        }
        
        localStorage.setItem(this.storageKey, encryptedKey);
        GEMINI_API_KEY = apiKey;
        
        const keyHash = this.generateHash(apiKey);
        localStorage.setItem('api_key_hash', keyHash);
        
        return true;
    }
    
    loadApiKey() {
        try {
            const encryptedKey = localStorage.getItem(this.storageKey);
            if (!encryptedKey) return false;
            
            const decryptedKey = decryptWithCryptoJS(encryptedKey);
            if (!decryptedKey) {
                this.clearApiKey();
                return false;
            }
            
            const storedHash = localStorage.getItem('api_key_hash');
            const currentHash = this.generateHash(decryptedKey);
            
            if (storedHash !== currentHash) {
                console.warn('API key verification failed');
                this.clearApiKey();
                return false;
            }
            
            GEMINI_API_KEY = decryptedKey;
            return true;
            
        } catch (error) {
            console.error('Error loading API key:', error);
            return false;
        }
    }
    
    clearApiKey() {
        localStorage.removeItem(this.storageKey);
        localStorage.removeItem('api_key_hash');
        GEMINI_API_KEY = '';
    }
    
    generateHash(text) {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            const char = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }
}

const apiKeyManager = new ApiKeyManager();

// API Key Functions
function saveApiKey() {
    const apiKeyInput = document.getElementById('apiKeyInput');
    let apiKey = apiKeyInput.value.trim();
    
    if (apiKey === '••••••••••••••••') {
        showNotification('API কী ইতিমধ্যে সংরক্ষিত আছে', 'info');
        return;
    }
    
    if (!apiKey) {
        showNotification('দয়া করে API কী ইনপুট দিন', 'error');
        return;
    }
    
    try {
        apiKeyManager.saveApiKey(apiKey);
        apiKeyInput.value = '••••••••••••••••';
        showNotification('✅ API কী সুরক্ষিতভাবে সংরক্ষণ করা হয়েছে!', 'success');
        updateApiStatus('success', '✅ API টি সংরক্ষণ করা হয়েছে! আপনি এখন অনুবাদ করতে পারেন।');
    } catch (error) {
        showNotification('সংরক্ষণ ব্যর্থ: ' + error.message, 'error');
    }
}

function loadApiKey() {
    const success = apiKeyManager.loadApiKey();
    if (success) {
        document.getElementById('apiKeyInput').value = '••••••••••••••••';
        updateApiStatus('success', '✅ API টি লোড হয়েছে! আপনি এখন অনুবাদ করতে পারেন।');
    }
    return success;
}

function clearApiKey() {
    if (confirm('আপনি কি নিশ্চিত যে API কী ডিলিট করতে চান?')) {
        apiKeyManager.clearApiKey();
        document.getElementById('apiKeyInput').value = '';
        updateApiStatus('warning', '🔑 API কী প্রয়োজন। নিচে আপনার API কী দিন।');
        showNotification('API কী ডিলিট করা হয়েছে', 'info');
    }
}

function showApiKey() {
    const apiKeyInput = document.getElementById('apiKeyInput');
    
    if (apiKeyInput.type === 'password' && GEMINI_API_KEY) {
        apiKeyInput.type = 'text';
        apiKeyInput.value = GEMINI_API_KEY;
        
        setTimeout(() => {
            apiKeyInput.type = 'password';
            apiKeyInput.value = '••••••••••••••••';
        }, 5000);
    }
}

async function testApiKey() {
    const apiKeyInput = document.getElementById('apiKeyInput');
    let apiKey = apiKeyInput.value.trim();
    
    if (apiKey === '••••••••••••••••') {
        if (!GEMINI_API_KEY) {
            showNotification('দয়া করে প্রথমে একটি API কী সেভ করুন', 'error');
            return;
        }
        apiKey = GEMINI_API_KEY;
    } else {
        try {
            apiKeyManager.saveApiKey(apiKey);
            apiKeyInput.value = '••••••••••••••••';
        } catch (error) {
            showNotification('API কী সেভ করতে সমস্যা: ' + error.message, 'error');
            return;
        }
    }
    
    showLoading('API কী টেস্ট করা হচ্ছে...');
    
    try {
        // Simple test request
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{
                    parts: [{ text: "Hello" }]
                }]
            })
        });
        
        if (response.ok) {
            showNotification('✅ API কী সঠিক! আপনি এখন অনুবাদ করতে পারেন।', 'success');
            updateApiStatus('success', '✅ API টি সঠিক! আপনি এখন অনুবাদ করতে পারেন।');
        } else {
            throw new Error('API টি বৈধ নয়');
        }
    } catch (error) {
        showNotification('❌ API কী ত্রুটি: ' + error.message, 'error');
        updateApiStatus('error', '❌ API টি ত্রুটি: ' + error.message);
    } finally {
        hideLoading();
    }
}

// ==================== TRANSLATION FUNCTIONS ====================

// Main translation function
async function extractAndTranslate() {
    if (!currentFile) {
        showNotification("দয়া করে প্রথমে একটি PDF ফাইল সিলেক্ট করুন।", 'error');
        return;
    }

    if (!GEMINI_API_KEY) {
        showNotification("দয়া করে প্রথমে একটি বৈধ জিমিনি API কী সেট করুন।", 'error');
        document.getElementById("apiKeyInput").focus();
        return;
    }

    if (currentFile.size > 20 * 1024 * 1024) {
        showNotification("ফাইল খুব বড়! দয়া করে ২০ এমবি-এর ছোট ফাইল আপলোড করুন।", 'error');
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
            saveToHistory();
        }
    } catch (error) {
        if (isTranslationRunning) {
            console.error("Translation error:", error);
            showNotification("ত্রুটি: " + (error.message || "অনুবাদ করতে সমস্যা হয়েছে"), 'error');
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
        const totalPages = Math.min(pdf.numPages, 3); // Start with 3 pages for testing
        let arabicText = "";
        let banglaTranslation = "";

        document.getElementById("progressContainer").style.display = "block";

        for (let i = 1; i <= totalPages; i++) {
            if (!isTranslationRunning) {
                console.log("Translation stopped by user");
                return;
            }

            showLoading(`পৃষ্ঠা ${i}/${totalPages} প্রসেস করা হচ্ছে...`);

            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map((item) => item.str).join(" ");

            if (pageText.trim().length > 0) {
                arabicText += `পৃষ্ঠা ${i}:\n${pageText}\n\n`;
                document.getElementById("arabicText").value = arabicText;

                const translatedText = await translateWithGemini(pageText);
                banglaTranslation += `পৃষ্ঠা ${i}:\n${translatedText}\n\n`;
                document.getElementById("banglaText").value = banglaTranslation;
            }

            const progress = Math.round((i / totalPages) * 100);
            updateProgress(progress);

            await delay(1000);
        }

        if (isTranslationRunning) {
            extractedText = arabicText;
            document.getElementById("progressContainer").style.display = "none";
            showNotification(`${totalPages} পৃষ্ঠা সফলভাবে অনুবাদ করা হয়েছে!`, 'success');
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
        const totalPages = Math.min(pdf.numPages, 2); // Start with 2 pages for testing
        let arabicText = "";
        let banglaTranslation = "";

        document.getElementById("progressContainer").style.display = "block";

        for (let i = 1; i <= totalPages; i++) {
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

            const { data: { text } } = await tesseractWorker.recognize(canvas);

            if (text.trim().length > 0) {
                arabicText += `পৃষ্ঠা ${i}:\n${text}\n\n`;
                document.getElementById("arabicText").value = arabicText;

                const translatedText = await translateWithGemini(text);
                banglaTranslation += `পৃষ্ঠা ${i}:\n${translatedText}\n\n`;
                document.getElementById("banglaText").value = banglaTranslation;
            }

            const progress = Math.round((i / totalPages) * 100);
            updateProgress(progress);

            await delay(2000);
        }

        if (isTranslationRunning) {
            extractedText = arabicText;
            document.getElementById("progressContainer").style.display = "none";
            showNotification(`${totalPages} পৃষ্ঠা OCR এবং অনুবাদ সম্পূর্ণ!`, 'success');
        }
    } catch (error) {
        if (isTranslationRunning) {
            throw new Error("OCR ত্রুটি: " + error.message);
        }
    }
}

// Real Gemini API translation
const requestBody = {
  contents: [
    {
      role: "user",
      parts: [
        {
          text: `Translate this Arabic Islamic text to Bangla. Preserve Islamic meaning accurately. Only return the Bangla translation.\n\n${text.substring(0, 1000)}`
        }
      ]
    }
  ],
  generationConfig: {
    temperature: 0.2,
    maxOutputTokens: 1000
  }
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
            
            if (response.status === 429) {
                throw new Error('API_QUOTA_EXCEEDED');
            } else if (response.status === 401) {
                throw new Error('INVALID_API_KEY');
            } else {
                throw new Error(errorData.error?.message || `API Error: ${response.status}`);
            }
        }

        const data = await response.json();
        const translatedText = data.candidates[0].content.parts[0].text;

        if (isTest) {
            return "API_TEST_SUCCESS";
        }

        return translatedText;
    } catch (error) {
        console.error("Gemini API error:", error);
        
        const errorMessages = {
            'API_KEY_MISSING': 'API কী পাওয়া যায়নি। দয়া করে API কী সেট করুন।',
            'API_QUOTA_EXCEEDED': 'API লিমিট শেষ হয়েছে। পরে চেষ্টা করুন।',
            'INVALID_API_KEY': 'API কী ভুল। দয়া করে সঠিক API কী দিন।',
            'NETWORK_ERROR': 'নেটওয়ার্ক সমস্যা। ইন্টারনেট সংযোগ চেক করুন।'
        };
        
        const userMessage = errorMessages[error.message] || `অনুবাদ ব্যর্থ: ${error.message}`;
        
        showNotification(userMessage, 'error');
        throw error;
    }
}

// ==================== UTILITY FUNCTIONS ====================

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function showLoading(message) {
    const loading = document.getElementById("loading");
    const loadingText = document.getElementById("loadingText");
    if (loading) loading.style.display = "block";
    if (loadingText) loadingText.textContent = message;
}

function hideLoading() {
    const loading = document.getElementById("loading");
    if (loading) loading.style.display = "none";
}

function updateProgress(percent) {
    const progressBar = document.getElementById("progressBar");
    if (progressBar) {
        progressBar.style.width = percent + "%";
        progressBar.textContent = percent + "%";
    }
}

function stopTranslation() {
    if (isTranslationRunning) {
        isTranslationRunning = false;
        document.getElementById("stopBtn").style.display = "none";
        document.getElementById("extractTranslateBtn").disabled = false;
        hideLoading();
        document.getElementById("progressContainer").style.display = "none";
        showNotification("অনুবাদ বন্ধ করা হয়েছে!", 'info');

        if (tesseractWorker) {
            tesseractWorker.terminate();
            tesseractWorker = null;
        }
    }
}

// ==================== ENHANCED FEATURES INITIALIZATION ====================

// Drag and Drop Functionality
function setupDragAndDrop() {
    const dropArea = document.getElementById('fileUploadArea');
    
    if (!dropArea) return;
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, preventDefaults, false);
        document.body.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    ['dragenter', 'dragover'].forEach(eventName => {
        dropArea.addEventListener(eventName, highlight, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        dropArea.addEventListener(eventName, unhighlight, false);
    });
    
    function highlight() {
        dropArea.classList.add('drag-over');
    }
    
    function unhighlight() {
        dropArea.classList.remove('drag-over');
    }
    
    dropArea.addEventListener('drop', handleDrop, false);
    
    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        if (files.length > 0) {
            const file = files[0];
            
            if (file.type === 'application/pdf') {
                currentFile = file;
                displayFileInfo(file);
                showNotification('PDF ফাইল সফলভাবে আপলোড হয়েছে!', 'success');
            } else {
                showNotification('শুধুমাত্র PDF ফাইল আপলোড করুন।', 'error');
            }
        }
    }
}

// Keyboard Shortcuts
function setupKeyboardShortcuts() {
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            if (!document.getElementById('extractTranslateBtn').disabled) {
                extractAndTranslate();
            }
        }
        
        if (e.key === 'Escape') {
            stopTranslation();
        }
        
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveCurrentTranslation();
        }
    });
}

// Initialize all enhanced features
function initializeEnhancedFeatures() {
    console.log("Initializing enhanced features...");
    setupDragAndDrop();
    setupKeyboardShortcuts();
}

// ==================== TAB NAVIGATION ====================

function showTab(tabName) {
    document.querySelectorAll(".main-card").forEach((tab) => {
        tab.classList.add("hidden");
    });

    document.querySelectorAll(".nav-tab").forEach((tab) => {
        tab.classList.remove("active");
    });

    const targetTab = document.getElementById(tabName + "-tab");
    if (targetTab) {
        targetTab.classList.remove("hidden");
    }
    
    event.currentTarget.classList.add("active");
}

// ==================== READER FUNCTIONS ====================

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
    stopSpeech();
}

function closeReader() {
    stopSpeech();
    document.getElementById("readerModal").style.display = "none";
}

function changeFontSize(delta) {
    const body = document.getElementById("readerBody");
    const currentSize = parseInt(window.getComputedStyle(body.querySelector("div")).fontSize);
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

// Text-to-speech functions
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
        showNotification("পড়ার জন্য কোনো টেক্সট নেই।", 'warning');
        return;
    }

    if ("speechSynthesis" in window) {
        stopSpeech();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "bn-BD";
        utterance.rate = 0.8;
        utterance.pitch = 1;

        isSpeaking = true;
        const ttsButton = document.getElementById("ttsButton");
        ttsButton.innerHTML = '<i class="fas fa-stop"></i> থামুন';
        ttsButton.classList.add("tts-active");

        utterance.onend = function () {
            stopSpeech();
        };

        utterance.onerror = function () {
            stopSpeech();
            showNotification("Text-to-speech ত্রুটি হয়েছে।", 'error');
        };

        speechSynthesis.speak(utterance);
    } else {
        showNotification("Text-to-speech is not supported in your browser.", 'error');
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

// ==================== HISTORY FUNCTIONS ====================

function saveToHistory() {
    const history = JSON.parse(localStorage.getItem("translationHistory") || "[]");
    const newItem = {
        id: Date.now(),
        title: currentFile?.name || "অনুবাদ",
        arabicText: document.getElementById("arabicText").value.substring(0, 200) + "...",
        banglaText: document.getElementById("banglaText").value.substring(0, 200) + "...",
        date: new Date().toLocaleDateString("bn-BD"),
    };

    history.unshift(newItem);
    localStorage.setItem("translationHistory", JSON.stringify(history));
    loadHistory();
}

function loadHistory() {
    const history = JSON.parse(localStorage.getItem("translationHistory") || "[]");
    const historyGrid = document.getElementById("historyGrid");

    if (!historyGrid) return;

    if (history.length === 0) {
        historyGrid.innerHTML = `
            <div style="text-align: center; color: #666; padding: 40px;">
                <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 20px; opacity: 0.5;"></i>
                <p>কোনো অনুবাদ ইতিহাস নেই</p>
                <p style="margin-top: 10px; font-size: 0.9rem;">আপনার প্রথম অনুবাদ শুরু করুন!</p>
            </div>
        `;
        return;
    }

    historyGrid.innerHTML = history.map((item) => `
        <div class="history-card" onclick="loadHistoryItem(${item.id})">
            <div class="history-card-header">
                <div class="history-title">${item.title}</div>
                <div class="history-date">${item.date}</div>
            </div>
            <div class="history-preview">${item.banglaText}</div>
        </div>
    `).join("");
}

function loadHistoryItem(id) {
    const history = JSON.parse(localStorage.getItem("translationHistory") || "[]");
    const item = history.find((h) => h.id === id);

    if (item) {
        document.getElementById("arabicText").value = item.arabicText;
        document.getElementById("banglaText").value = item.banglaText;
        showTab("translate");
        showNotification("ইতিহাস থেকে লোড করা হয়েছে!", 'success');
    }
}

function saveCurrentTranslation() {
    const arabicText = document.getElementById("arabicText").value;
    const banglaText = document.getElementById("banglaText").value;
    
    if (!arabicText && !banglaText) {
        showNotification('সংরক্ষণের জন্য কোনো টেক্সট নেই', 'warning');
        return;
    }
    
    saveToHistory();
    showNotification('অনুবাদ ইতিহাসে সংরক্ষণ করা হয়েছে!', 'success');
}

function clearAllHistory() {
    if (confirm("আপনি কি সব ইতিহাস মুছতে চান?")) {
        localStorage.removeItem("translationHistory");
        loadHistory();
        showNotification("সব ইতিহাস মুছে ফেলা হয়েছে!", 'success');
    }
}

// ==================== CLEAR ALL FUNCTION ====================

function clearAll() {
    stopTranslation();
    document.getElementById("pdfFile").value = "";
    document.getElementById("arabicText").value = "";
    document.getElementById("banglaText").value = "";
    document.getElementById("fileInfo").style.display = "none";
    document.getElementById("progressContainer").style.display = "none";
    currentFile = null;
    extractedText = "";
    stopSpeech();
    showNotification("সব কিছু রিসেট করা হয়েছে।", 'info');
}

// ==================== EVENT LISTENERS ====================

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

console.log("Al Bayan App Initialized Successfully!");
