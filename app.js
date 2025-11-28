// ==================== ENHANCED FEATURES FOR GITHUB PAGES ====================

// Enhanced Notification System
function showNotification(message, type = 'info') {
  // Remove existing notifications
  const existingNotifications = document.querySelectorAll('.custom-notification');
  existingNotifications.forEach(notif => notif.remove());

  const notification = document.createElement('div');
  notification.className = `custom-notification ${type}`;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    border-radius: 8px;
    color: white;
    font-weight: 600;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    background: ${type === 'error' ? '#dc3545' : 
                 type === 'success' ? '#28a745' : 
                 type === 'warning' ? '#ffc107' : '#17a2b8'};
    ${type === 'warning' ? 'color: black;' : ''}
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 400px;
  `;
  
  notification.innerHTML = `
    <i class="fas fa-${type === 'error' ? 'exclamation-triangle' : 
                       type === 'success' ? 'check-circle' : 
                       type === 'warning' ? 'exclamation-circle' : 'info-circle'}"></i>
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
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    if (notification.parentElement) {
      notification.remove();
    }
  }, 5000);
}

// Enhanced API Key Encryption (Frontend-only)
function encryptApiKey(apiKey) {
  // Simple obfuscation for frontend (not fully secure but better than plain text)
  return btoa(apiKey + '|' + Date.now());
}

function decryptApiKey(encryptedKey) {
  try {
    const decoded = atob(encryptedKey);
    return decoded.split('|')[0]; // Return only the API key part
  } catch (error) {
    console.error('Decryption error:', error);
    return null;
  }
}

// Enhanced API Key Saving
function saveApiKeyEnhanced() {
  const apiKeyInput = document.getElementById('apiKeyInput');
  const apiKey = apiKeyInput.value.trim();
  
  if (!apiKey) {
    showNotification('দয়া করে API কী দিন', 'error');
    return;
  }

  // If input is already masked, don't save again
  if (apiKey === '••••••••••••••••') {
    return;
  }

  try {
    const encryptedKey = encryptApiKey(apiKey);
    localStorage.setItem('encrypted_gemini_key', encryptedKey);
    GEMINI_API_KEY = apiKey;
    
    apiKeyInput.value = '••••••••••••••••';
    showNotification('API কী সুরক্ষিতভাবে সংরক্ষণ করা হয়েছে!', 'success');
    updateApiStatus('success', '✅ API টি সংরক্ষণ করা হয়েছে!');
  } catch (error) {
    showNotification('সংরক্ষণ ব্যর্থ: ' + error.message, 'error');
  }
}

// Enhanced API Key Loading
function loadApiKeyEnhanced() {
  try {
    const encryptedKey = localStorage.getItem('encrypted_gemini_key');
    if (encryptedKey) {
      const decryptedKey = decryptApiKey(encryptedKey);
      if (decryptedKey) {
        GEMINI_API_KEY = decryptedKey;
        document.getElementById('apiKeyInput').value = '••••••••••••••••';
        updateApiStatus('success', '✅ API টি লোড হয়েছে! আপনি এখন অনুবাদ করতে পারেন।');
        return true;
      }
    }
  } catch (error) {
    console.error('Error loading API key:', error);
  }
  return false;
}

// Drag and Drop Functionality
function setupDragAndDrop() {
  const dropArea = document.getElementById('fileUploadArea');
  
  if (!dropArea) return;
  
  // Prevent default drag behaviors
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, preventDefaults, false);
    document.body.addEventListener(eventName, preventDefaults, false);
  });
  
  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  // Highlight drop area when item is dragged over it
  ['dragenter', 'dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, highlight, false);
  });
  
  ['dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, unhighlight, false);
  });
  
  function highlight() {
    dropArea.style.borderColor = '#3E8999';
    dropArea.style.backgroundColor = 'rgba(62, 137, 153, 0.1)';
    dropArea.style.transform = 'scale(1.02)';
  }
  
  function unhighlight() {
    dropArea.style.borderColor = '';
    dropArea.style.backgroundColor = '';
    dropArea.style.transform = '';
  }
  
  // Handle dropped files
  dropArea.addEventListener('drop', handleDrop, false);
  
  function handleDrop(e) {
    const dt = e.dataTransfer;
    const files = dt.files;
    
    if (files.length > 0) {
      const file = files[0];
      
      // Check if file is PDF
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
    // Ctrl + Enter or Cmd + Enter to start translation
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!document.getElementById('extractTranslateBtn').disabled) {
        extractAndTranslate();
      }
    }
    
    // Escape to stop translation
    if (e.key === 'Escape') {
      stopTranslation();
    }
    
    // Ctrl + S or Cmd + S to save current translation
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveCurrentTranslation();
    }
  });
}

// Save Current Translation to History
function saveCurrentTranslation() {
  const arabicText = document.getElementById('arabicText').value;
  const banglaText = document.getElementById('banglaText').value;
  
  if (!arabicText && !banglaText) {
    showNotification('সংরক্ষণের জন্য কোনো টেক্সট নেই', 'warning');
    return;
  }
  
  saveToHistory();
  showNotification('অনুবাদ ইতিহাসে সংরক্ষণ করা হয়েছে!', 'success');
}

// Enhanced Error Handling for Translation
async function translateWithGeminiEnhanced(text, isTest = false) {
  if (!GEMINI_API_KEY) {
    throw new Error('API_KEY_MISSING');
  }

  // Check if translation was stopped
  if (!isTranslationRunning) {
    return "অনুবাদ বন্ধ করা হয়েছে";
  }

  try {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

    const requestBody = {
      contents: [
        {
          parts: [
            {
              text: `Translate this Arabic Islamic text to natural Bangla accurately. Preserve religious meaning and Islamic terminology. Keep the translation concise and natural. Only return the translation without any additional text.

Arabic Text: ${text.substring(0, 3000)}`
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        topK: 40,
        topP: 0.8,
        maxOutputTokens: 2000,
      },
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      
      // User-friendly error messages
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
    console.error('Gemini API error:', error);
    
    // User-friendly error messages
    const errorMessages = {
      'API_KEY_MISSING': 'API কী পাওয়া যায়নি। দয়া করে API কী সেট করুন।',
      'API_QUOTA_EXCEEDED': 'API লিমিট শেষ হয়েছে। পরে চেষ্টা করুন।',
      'INVALID_API_KEY': 'API কী ভুল। দয়া করে সঠিক API কী দিন।',
      'NETWORK_ERROR': 'নেটওয়ার্ক সমস্যা। ইন্টারনেট সংযোগ চেক করুন।'
    };
    
    const userMessage = errorMessages[error.message] || 
                       `অনুবাদ ব্যর্থ: ${error.message}`;
    
    showNotification(userMessage, 'error');
    throw error;
  }
}

// Auto-save functionality
function setupAutoSave() {
  // Auto-save progress every 2 minutes
  setInterval(() => {
    const arabicText = document.getElementById('arabicText').value;
    const banglaText = document.getElementById('banglaText').value;
    
    if (arabicText || banglaText) {
      localStorage.setItem('autoSave_arabic', arabicText);
      localStorage.setItem('autoSave_bangla', banglaText);
      console.log('Auto-saved at:', new Date().toLocaleTimeString());
    }
  }, 120000); // 2 minutes
}

// Load auto-saved data
function loadAutoSave() {
  try {
    const arabic = localStorage.getItem('autoSave_arabic');
    const bangla = localStorage.getItem('autoSave_bangla');
    
    if ((arabic && arabic.length > 10) || (bangla && bangla.length > 10)) {
      // Show a subtle indicator that auto-save data is available
      const autoSaveIndicator = document.createElement('div');
      autoSaveIndicator.innerHTML = `
        <div style="
          background: #fff3cd;
          border: 1px solid #ffeaa7;
          border-radius: 5px;
          padding: 10px;
          margin: 10px 0;
          text-align: center;
          color: #856404;
        ">
          <i class="fas fa-save"></i>
          স্বয়ংক্রিয় সংরক্ষিত ডেটা পাওয়া গেছে। 
          <button onclick="loadAutoSaveData()" style="
            background: #28a745;
            color: white;
            border: none;
            padding: 5px 10px;
            border-radius: 3px;
            margin-left: 10px;
            cursor: pointer;
          ">লোড করুন</button>
          <button onclick="dismissAutoSave()" style="
            background: none;
            border: none;
            color: #856404;
            margin-left: 5px;
            cursor: pointer;
          ">বাদ দিন</button>
        </div>
      `;
      
      const mainCard = document.querySelector('.main-card');
      if (mainCard) {
        mainCard.insertBefore(autoSaveIndicator, mainCard.firstChild);
      }
    }
  } catch (error) {
    console.error('Auto-save load error:', error);
  }
}

function loadAutoSaveData() {
  const arabic = localStorage.getItem('autoSave_arabic');
  const bangla = localStorage.getItem('autoSave_bangla');
  
  if (arabic) document.getElementById('arabicText').value = arabic;
  if (bangla) document.getElementById('banglaText').value = bangla;
  
  showNotification('স্বয়ংক্রিয় সংরক্ষিত ডেটা লোড করা হয়েছে!', 'success');
  dismissAutoSave();
}

function dismissAutoSave() {
  const indicator = document.querySelector('[style*="স্বয়ংক্রিয় সংরক্ষিত ডেটা"]');
  if (indicator) indicator.remove();
}

// Initialize all enhanced features
function initializeEnhancedFeatures() {
  setupDragAndDrop();
  setupKeyboardShortcuts();
  setupAutoSave();
  
  // Load auto-save data after a short delay
  setTimeout(loadAutoSave, 1000);
  
  console.log('Enhanced features initialized');
}

// Replace your existing DOMContentLoaded event listener with this:
document.addEventListener('DOMContentLoaded', function () {
  initializeTheme();
  loadApiKeyEnhanced(); // Use enhanced version
  setupEventListeners();
  loadHistory();
  initializeEnhancedFeatures(); // Initialize new features
});

// Replace your existing saveApiKey function with the enhanced version
// Remove the old saveApiKey function and use saveApiKeyEnhanced instead 
