// Global state variables
let isMuted = false;
let currentUtterance = null;
let synthesis = window.speechSynthesis;
let recognition = null;
let currentActiveTopicId = null;
let currentConversationId = ACTIVE_CONVERSATION_ID || null;
let cachedVoices = [];
let speechRate = 1.0; // 1.0 = normal, 1.5 = fast
let isListening = false; // STT listening state
let audioUnlocked = false; // AudioContext warmup flag
let sttSilenceTimeout = null; // Timeout for 5s silence auto-send

/**
 * Unlock browser audio playback on first user interaction.
 * Chrome blocks audio.play() until the user has interacted with the page.
 * Call this on any user gesture (click, keypress, touch).
 */
function unlockAudio() {
    if (audioUnlocked) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        // Create a silent buffer and play it to "warm up" the audio context
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
        // Resume suspended context (required on some browsers)
        if (ctx.state === 'suspended') ctx.resume();
        audioUnlocked = true;
        console.log('Audio context unlocked for autoplay.');
        hidePermissionBanner();
    } catch (e) {
        console.warn('Could not unlock audio context:', e);
    }
}

/**
 * Check microphone permission status and show a banner if blocked or uncertain.
 */
async function checkMicPermission() {
    // Also try: check if SpeechRecognition exists at all
    const hasSpeechApi = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

    if (!hasSpeechApi) {
        // Browser doesn't support SpeechRecognition at all — hide mic and warn
        console.warn('SpeechRecognition API not available in this browser.');
        const micBtn = document.getElementById("micBtn");
        if (micBtn) micBtn.style.opacity = '0.4';
        showPermissionBanner('unsupported', false);
        return;
    }

    let micState = 'unknown';

    try {
        // Permissions API (Chrome/Edge)
        const micStatus = await navigator.permissions.query({ name: 'microphone' });
        micState = micStatus.state; // 'granted', 'denied', or 'prompt'

        // Listen for changes
        micStatus.onchange = () => {
            if (micStatus.state === 'granted') {
                hidePermissionBanner();
            } else {
                showPermissionBanner(micStatus.state, hasSpeechApi);
            }
        };
    } catch (e) {
        // Permissions API not available (Firefox, Safari) — do a quick STT test
        console.log('Permissions API not available, trying quick STT availability check...');
        try {
            const testRecognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
            // Recognition created successfully — mic should work on request
            console.log('SpeechRecognition available — mic permission will be prompted on use.');
        } catch (err) {
            console.warn('SpeechRecognition constructor failed:', err);
            showPermissionBanner('denied', true);
            return;
        }
    }

    if (micState === 'denied') {
        showPermissionBanner('denied', hasSpeechApi);
    } else if (micState === 'unknown') {
        // Permissions API not available but STT exists (e.g., Firefox) — mic will prompt
        console.log('Microphone permission status unknown — browser will prompt on first use.');
    }
}

/**
 * Show the permission warning banner.
 * @param {string} state - 'denied' | 'prompt'
 * @param {boolean} hasSpeechApi - Whether SpeechRecognition exists
 */
function showPermissionBanner(state, hasSpeechApi) {
    const banner = document.getElementById('permissionBanner');
    const icon = document.getElementById('permissionIcon');
    const text = document.getElementById('permissionText');
    if (!banner || !text) return;

    if (state === 'denied') {
        icon.className = 'fa-solid fa-circle-xmark';
        text.textContent = 'Micro bị chặn. Vào cài đặt trình duyệt để mở khóa quyền truy cập Microphone.';
    } else if (state === 'unsupported' || !hasSpeechApi) {
        icon.className = 'fa-solid fa-triangle-exclamation';
        text.textContent = 'Trình duyệt không hỗ trợ nhận dạng giọng nói. Vui lòng dùng Chrome hoặc Edge.';
    }

    banner.style.display = 'flex';
}

/**
 * Hide the permission warning banner.
 */
function hidePermissionBanner() {
    const banner = document.getElementById('permissionBanner');
    if (banner) banner.style.display = 'none';
}

/**
 * Open the permission help guide modal (detects browser and shows relevant link).
 */
function openPermissionGuide() {
    const overlay = document.getElementById('permissionGuideOverlay');
    const settingsUrl = document.getElementById('permSettingsUrl');

    // Detect browser and show the right settings URL
    const ua = navigator.userAgent;
    if (ua.includes('Edg')) {
        settingsUrl.textContent = 'edge://settings/content/microphone';
    } else if (ua.includes('Chrome')) {
        settingsUrl.textContent = 'chrome://settings/content/microphone';
    } else if (ua.includes('Firefox')) {
        settingsUrl.textContent = 'about:preferences#privacy';
    } else {
        settingsUrl.textContent = 'Vào Cài đặt trình duyệt > Quyền riêng tư > Micro';
    }

    if (overlay) overlay.style.display = 'flex';
}

/**
 * Close the permission guide modal. If event is provided, only close when clicking overlay.
 */
function closePermissionGuide(event) {
    if (event && event.target !== document.getElementById('permissionGuideOverlay')) return;
    const overlay = document.getElementById('permissionGuideOverlay');
    if (overlay) overlay.style.display = 'none';
}

/**
 * Copy the browser settings URL to clipboard.
 */
function copyPermissionLink() {
    const codeEl = document.getElementById('permSettingsUrl');
    if (!codeEl) return;
    const url = codeEl.textContent;
    navigator.clipboard.writeText(url).then(() => {
        showToast('Đã copy link. Dán vào thanh địa chỉ trình duyệt để mở cài đặt.', 'success');
    }).catch(() => {
        showToast('Không thể copy. Hãy mở thủ công: ' + url, 'info');
    });
}

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} text - Raw text to escape
 * @returns {string} HTML-escaped text safe for innerHTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Convert plain text with basic markdown to HTML
 * Supports: **bold**, *italic*, `code`, [link](url), line breaks
 * @param {string} text - Raw message text
 * @returns {string} HTML-formatted message
 */
function formatMessage(text) {
    if (!text) return '';

    // First, escape all HTML
    let html = escapeHtml(text);

    // Convert line breaks to <br>
    html = html.replace(/\n/g, '<br>');

    // Convert **bold** to <strong>
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Convert *italic* to <em> (but not inside already bold)
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

    // Convert `inline code` to <code>
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');

    // Convert [text](url) to <a href="url">text</a>
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    return html;
}

/**
 * Create a chat message element with proper rendering
 * @param {string} message - The message text
 * @param {string} senderName - Name of sender (for meta)
 * @param {string} senderType - 'user' or 'character'
 * @param {boolean} useTypewriter - Whether to use typewriter effect
 * @returns {HTMLElement} The chat message element
 */
function createChatMessage(message, senderName, senderType, useTypewriter = false) {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-message ${senderType === 'user' ? 'user' : ''}`;

    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.className = 'chat-bubble-wrapper';

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${senderType === 'user' ? 'user' : 'character'}`;
    // We'll use innerHTML for formatted content, but only for character messages
    if (senderType === 'character') {
        bubble.innerHTML = formatMessage(message);
    } else {
        // User messages: plain text with preserved line breaks
        bubble.textContent = message;
    }

    const meta = document.createElement('div');
    meta.className = 'chat-bubble-meta';
    meta.textContent = senderName;

    bubbleWrapper.appendChild(bubble);
    bubbleWrapper.appendChild(meta);

    if (senderType === 'user') {
        wrapper.appendChild(bubbleWrapper);
    } else {
        wrapper.appendChild(bubbleWrapper);
    }

    return wrapper;
}

// Pool of suggested questions based on topics
const topicSuggestions = {
    // Einstein: Hiệu ứng quang điện
    1: [
        "Hạt photon thực chất là gì vậy giáo sư?",
        "Hiệu ứng quang điện có ứng dụng gì trong cuộc sống?",
        "Vì sao công trình này lại đoạt giải Nobel vật lý?"
    ],
    // Einstein: Thuyết tương đối hẹp
    2: [
        "Công thức E=mc² có ý nghĩa thực tiễn gì?",
        "Vì sao thời gian lại trôi chậm đi khi di chuyển nhanh?",
        "Hành khách trên tàu có cảm giác gì không?"
    ],
    // Trần Hưng Đạo: Hịch tướng sĩ
    3: [
        "Hoàn cảnh lịch sử khi Người viết Hịch tướng sĩ?",
        "Lời kêu gọi của Người có tác động thế nào đến quân sĩ?",
        "Ý nghĩa sâu sắc của câu 'nửa đêm vỗ gối, ruột đau như cắt'?"
    ],
    // Trần Hưng Đạo: Chiến thuật Vườn không nhà trống
    4: [
        "Kế sách này được áp dụng bao nhiêu lần?",
        "Làm sao đảm bảo nhân dân đồng lòng di tản lương thực?",
        "Trận đánh Bạch Đằng Giang diễn ra như thế nào?"
    ]
};

// General fallback suggested questions for characters
const generalSuggestions = {
    "Albert Einstein": [
        "Giáo sư nghĩ sao về tương lai của nhân loại?",
        "Trí tưởng tượng quan trọng hơn kiến thức như thế nào?",
        "Lời khuyên của giáo sư dành cho các nhà khoa học trẻ?"
    ],
    "Trần Hưng Đạo": [
        "Bí quyết đoàn kết muôn dân của triều đại nhà Trần?",
        "Vương phi và hào khí Đông A có ý nghĩa gì?",
        "Lời khuyên của Người dành cho thế hệ trẻ dựng nước ngày nay?"
    ]
};

// Initialize Speech Recognition (STT)
function initRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true; // Keep listening until explicitly stopped
        recognition.interimResults = true;   // Show partial results while speaking
        recognition.maxAlternatives = 1;

        // Try vi-VN first; if it fails, try without specifying lang
        try {
            recognition.lang = 'vi-VN';
        } catch (e) {
            console.warn('vi-VN not supported, using browser default language.');
            recognition.lang = '';
        }

        recognition.onstart = () => {
            console.log("Voice recognition started...");
            isListening = true;
            const micBtn = document.getElementById("micBtn");
            const micIcon = document.getElementById("micIcon");
            const input = document.getElementById("chatInput");
            if (micBtn) micBtn.classList.add("active-rec");
            if (micIcon) micIcon.className = "fa-solid fa-microphone-lines";

            // Show listening indicator
            const indicator = document.getElementById("sttListeningIndicator");
            if (indicator) indicator.classList.add("active");

            // Change input visual
            if (input) {
                input.classList.add("listening");
                input.placeholder = "🎤 Đang lắng nghe...";
            }
        };

        recognition.onresult = (event) => {
            let fullTranscript = '';
            for (let i = 0; i < event.results.length; ++i) {
                fullTranscript += event.results[i][0].transcript;
            }

            console.log("STT Result:", fullTranscript);

            const input = document.getElementById("chatInput");
            if (input) input.value = fullTranscript;

            // Reset the 5-second silence timer whenever voice is detected
            if (sttSilenceTimeout) {
                clearTimeout(sttSilenceTimeout);
            }

            sttSilenceTimeout = setTimeout(() => {
                console.log("5s of silence detected. Stopping STT and sending...");
                recognition.stop();
                if (input && input.value.trim() !== "") {
                    sendMessage();
                }
            }, 5000);
        };

        recognition.onerror = (event) => {
            console.error("STT Error:", event.error, event.message || '');

            const errorMsg = {
                'not-allowed': 'Micro bị từ chối. Vào Cài đặt trình duyệt > Quyền riêng tư > Micro để cấp quyền.',
                'no-speech': 'Không phát hiện giọng nói. Hãy thử lại và nói to hơn.',
                'audio-capture': 'Không tìm thấy microphone. Vui lòng kiểm tra thiết bị.',
                'network': 'Lỗi kết nối mạng khi nhận dạng giọng nói.',
                'aborted': 'Đã dừng ghi âm.',
                'language-not-supported': 'Ngôn ngữ tiếng Việt không được trình duyệt hỗ trợ nhận dạng giọng nói. Vui lòng nhập văn bản.'
            }[event.error] || `Lỗi nhận dạng giọng nói: ${event.error}`;

            showToast(errorMsg, "danger");
            resetMicButton();

            if (event.error === 'not-allowed') {
                // Show the permission banner and guide
                showPermissionBanner('denied', true);
            } else if (event.error === 'language-not-supported') {
                // Fallback: try without specifying language
                console.log('Retrying STT without language restriction...');
                try {
                    recognition.lang = '';
                } catch (e) {}
            }
        };

        recognition.onend = () => {
            console.log("Voice recognition ended.");
            isListening = false;
            resetMicButton();
            if (sttSilenceTimeout) {
                clearTimeout(sttSilenceTimeout);
                sttSilenceTimeout = null;
            }
        };
    } else {
        console.warn("Web Speech Recognition API not supported in this browser.");
        const micBtn = document.getElementById("micBtn");
        if (micBtn) micBtn.style.display = "none";
        showToast("Trình duyệt của bạn không hỗ trợ nhận dạng giọng nói. Vui lòng sử dụng Chrome, Edge hoặc nhập văn bản.", "danger");
    }
}

function resetMicButton() {
    const micBtn = document.getElementById("micBtn");
    const micIcon = document.getElementById("micIcon");
    const input = document.getElementById("chatInput");
    const indicator = document.getElementById("sttListeningIndicator");

    if (micBtn && micIcon) {
        micBtn.classList.remove("active-rec");
        micIcon.className = "fa-solid fa-microphone";
    }
    if (indicator) indicator.classList.remove("active");
    if (input) {
        input.classList.remove("listening");
        input.placeholder = "Nhập câu hỏi hoặc nhấn Micro để nói...";
    }
    isListening = false;
}

// Helper to show custom toast
function showToast(message, type = 'success') {
    const container = document.body;
    const toast = document.createElement("div");
    toast.className = `toast show custom-toast align-items-center text-white bg-dark border-0 position-fixed top-0 end-0 m-3`;
    toast.style.zIndex = "1099";
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                <i class="fa-solid ${type === 'success' ? 'fa-circle-check text-success' : 'fa-circle-exclamation text-danger'} me-2"></i>
                ${message}
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" onclick="this.parentElement.parentElement.remove()"></button>
        </div>
    `;
    container.appendChild(toast);
    setTimeout(() => {
        toast.remove();
    }, 4000);
}

// Cached best Vietnamese voice for Web Speech API
let cachedViVoice = null;

// Pre-load voices (fix async cold-load bug)
function loadVoices() {
    return new Promise((resolve) => {
        const voices = synthesis.getVoices();
        if (voices.length > 0) {
            cachedVoices = voices;
            cachedViVoice = findBestViVoice(cachedVoices);
            resolve(voices);
        } else {
            synthesis.onvoiceschanged = () => {
                cachedVoices = synthesis.getVoices();
                cachedViVoice = findBestViVoice(cachedVoices);
                resolve(cachedVoices);
            };
        }
    });
}

/**
 * Find the best Vietnamese voice from the available voices.
 * Prefers Microsoft/Google neural voices over generic ones.
 */
function findBestViVoice(voices) {
    if (!voices || voices.length === 0) return null;

    // Priority 1: vi-VN neural/local voices with "NamMinh" or "HoaiMy" (Microsoft neural)
    const neuralVoice = voices.find(v =>
        v.lang === 'vi-VN' &&
        (v.name.includes('Microsoft') || v.name.includes('Natural') || v.name.includes('Neural'))
    );
    if (neuralVoice) return neuralVoice;

    // Priority 2: vi-VN Google voices
    const googleVoice = voices.find(v =>
        v.lang === 'vi-VN' && v.name.toLowerCase().includes('google')
    );
    if (googleVoice) return googleVoice;

    // Priority 3: any vi-VN voice
    const viVNVoice = voices.find(v => v.lang === 'vi-VN' || v.lang.startsWith('vi-VN'));
    if (viVNVoice) return viVNVoice;

    // Priority 4: any vi voice
    const viVoice = voices.find(v => v.lang.startsWith('vi'));
    if (viVoice) return viVoice;

    return null;
}

// Speak text using TTS — server-side edge-tts MP3 first, then gTTS, fallback to Web Speech API
async function speakText(text) {
    if (isMuted) return;

    // Clean markdown formatting before speaking
    const cleanText = cleanTextForTTS(text);
    if (!cleanText) return;

    // Stop any ongoing speech (both server audio and browser synthesis)
    if (synthesis) synthesis.cancel();
    const existingAudio = document.getElementById('ttsAudio');
    if (existingAudio) {
        existingAudio.pause();
        existingAudio.currentTime = 0;
    }

    // Try server-side TTS (edge-tts → gTTS) first
    const { audioUrl, originalText } = await fetchServerTTS(cleanText);

    if (audioUrl) {
        // Server audio ready — play via <audio> element, with Web Speech fallback on error
        playServerAudio(audioUrl, cleanText);
    } else {
        // Fallback to browser Web Speech API
        speakWithWebSpeech(cleanText);
    }
}

/**
 * Clean text for TTS — selectively remove markdown formatting,
 * preserving legitimate punctuation like () [] % etc.
 */
function cleanTextForTTS(text) {
    if (!text) return '';

    let cleaned = text;

    // Remove bold **text** or __text__
    cleaned = cleaned.replace(/\*{2}([^*\n]+)\*{2}/g, '$1');
    cleaned = cleaned.replace(/__([^_\n]+)__/g, '$1');

    // Remove italic *text* or _text_
    cleaned = cleaned.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1');
    cleaned = cleaned.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '$1');

    // Remove markdown links [text](url) → keep text
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // Remove headers ###, ##, #
    cleaned = cleaned.replace(/^#{1,6}\s*/gm, '');

    // Remove horizontal rules ---, ***, ___
    cleaned = cleaned.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '');

    // Remove inline code `text`
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

    // Remove math notation $...$ and $$...$$ (keep content)
    cleaned = cleaned.replace(/\$\$([^$]+)\$\$/g, '$1');
    cleaned = cleaned.replace(/\$([^$]+)\$/g, '$1');

    // Remove action descriptions *text* (standalone asterisk actions)
    cleaned = cleaned.replace(/^\*[^*\n]+\*$/gm, '');

    // Collapse excessive whitespace
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned.trim();

    return cleaned;
}

/**
 * Fetch server-side TTS audio via /tts endpoint.
 * Uses edge-tts (neural Vietnamese) with gTTS fallback on server.
 * Returns { audioUrl, originalText } or { audioUrl: null, originalText }.
 */
async function fetchServerTTS(text) {
    try {
        const response = await fetch('/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: text })
        });

        if (response.ok) {
            const blob = await response.blob();
            return { audioUrl: URL.createObjectURL(blob), originalText: text };
        }
    } catch (e) {
        console.log('Server TTS unavailable, falling back to Web Speech API.');
    }
    return { audioUrl: null, originalText: text };
}

/**
 * Play server-side TTS audio through the <audio> element.
 * Falls back to Web Speech API on playback error.
 * @param {string} audioUrl - Blob URL of the TTS audio
 * @param {string} cleanText - Original cleaned text for Web Speech API fallback
 */
function playServerAudio(audioUrl, cleanText) {
    const audio = document.getElementById('ttsAudio');
    if (!audio) return;

    // Stop any currently playing audio
    audio.pause();
    audio.currentTime = 0;

    audio.src = audioUrl;
    audio.onplay = () => startVisuals();
    audio.onended = () => {
        stopVisuals();
        URL.revokeObjectURL(audioUrl);
    };
    audio.onerror = () => {
        console.warn('Server audio playback failed, falling back to Web Speech API.');
        stopVisuals();
        URL.revokeObjectURL(audioUrl);
        // Fallback to browser Web Speech API with the original text
        if (cleanText) {
            speakWithWebSpeech(cleanText);
        }
    };
    audio.play().catch(err => {
        console.warn('Audio play() rejected:', err);
        stopVisuals();
        // Fallback to browser TTS on play() rejection too
        if (cleanText) {
            speakWithWebSpeech(cleanText);
        }
    });
}

/**
 * Web Speech API fallback for TTS.
 */
function speakWithWebSpeech(cleanText) {
    if (!synthesis) {
        console.warn('Web Speech API not available.');
        return;
    }

    // Split text into sentences for better speech synthesis
    const sentences = cleanText.match(/[^.!?]+[.!?]+/g) || [cleanText];
    let currentIndex = 0;

    function speakNext() {
        if (currentIndex >= sentences.length || isMuted) {
            stopVisuals();
            return;
        }

        const sentence = sentences[currentIndex].trim();
        if (!sentence) {
            currentIndex++;
            speakNext();
            return;
        }

        currentUtterance = new SpeechSynthesisUtterance(sentence);
        currentUtterance.lang = 'vi-VN';
        currentUtterance.rate = speechRate;

        // Select best Vietnamese voice if available (pre-cached)
        if (cachedViVoice) {
            currentUtterance.voice = cachedViVoice;
        }

        currentUtterance.onstart = () => startVisuals();
        currentUtterance.onend = () => {
            currentIndex++;
            speakNext();
        };
        currentUtterance.onerror = (e) => {
            console.error('TTS Utterance error:', e);
            // Continue with next sentence on error instead of stopping completely
            currentIndex++;
            speakNext();
        };

        synthesis.speak(currentUtterance);
    }

    speakNext();
}

function startVisuals() {
    const avatar = document.getElementById("characterAvatar");
    const overlay = document.getElementById("speakingOverlay");
    
    if (avatar) {
        avatar.classList.add("pulse-speaking");
        // Apply inline styles for glowing animation when speaking
        avatar.style.filter = "brightness(1.15) contrast(1.05)";
        avatar.style.boxShadow = "0 0 25px rgba(34, 211, 238, 0.4)";
    }
    if (overlay) {
        overlay.classList.add("active");
    }
}

function stopVisuals() {
    const avatar = document.getElementById("characterAvatar");
    const overlay = document.getElementById("speakingOverlay");
    
    if (avatar) {
        avatar.classList.remove("pulse-speaking");
        avatar.style.filter = "";
        avatar.style.boxShadow = "";
    }
    if (overlay) {
        overlay.classList.remove("active");
    }
}

// Typewriter effect for character messages with formatting support
function createFormattedMessage(text, senderName, container) {
    const messageWrapper = document.createElement('div');
    messageWrapper.className = 'chat-message';

    const avatar = document.createElement('img');
    avatar.className = 'chat-avatar';
    avatar.src = '/static/images/default_avatar.png';
    avatar.alt = senderName;

    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.className = 'chat-bubble-wrapper';

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble character';

    const meta = document.createElement('div');
    meta.className = 'chat-bubble-meta';
    meta.textContent = senderName;

    bubbleWrapper.appendChild(bubble);
    bubbleWrapper.appendChild(meta);
    messageWrapper.appendChild(avatar);
    messageWrapper.appendChild(bubbleWrapper);
    container.appendChild(messageWrapper);
    container.scrollTop = container.scrollHeight;

    // Format the text first (with HTML)
    const formattedHtml = formatMessage(text);

    // Typewriter effect for HTML content - type character by character
    // But we need to handle HTML tags properly
    let i = 0;
    let displayText = '';
    let isInTag = false;
    let tagBuffer = '';

    function typeChar() {
        if (i < formattedHtml.length) {
            const char = formattedHtml[i];

            if (char === '<') {
                isInTag = true;
                tagBuffer = '<';
            } else if (char === '>' && isInTag) {
                isInTag = false;
                tagBuffer += '>';
                displayText += tagBuffer;
                bubble.innerHTML = displayText;
                tagBuffer = '';
            } else if (isInTag) {
                tagBuffer += char;
            } else {
                displayText += char;
                bubble.innerHTML = displayText;
            }

            container.scrollTop = container.scrollHeight;
            i++;

            // Faster typing for more natural feel
            const delay = isInTag ? 0 : (15 + Math.random() * 30);
            setTimeout(typeChar, delay);
        } else {
            // Typing complete
            showSuggestions(currentActiveTopicId);
        }
    }

    typeChar();
}

// Function to handle sending message
async function sendMessage() {
    if (sttSilenceTimeout) {
        clearTimeout(sttSilenceTimeout);
        sttSilenceTimeout = null;
    }

    const input = document.getElementById("chatInput");
    const message = input.value.trim();
    if (!message) return;

    input.value = "";

    const messagesContainer = document.getElementById("chatMessages");

    // Play user message in chat body with new structure
    const userMessage = createUserMessage(message);
    messagesContainer.appendChild(userMessage);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Show typing indicator
    const typingIndicator = document.getElementById("typingIndicator");
    messagesContainer.appendChild(typingIndicator);
    typingIndicator.style.display = "flex";
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Hide suggested chips
    document.getElementById("suggestedChips").style.display = "none";

    try {
        const response = await fetch("/chat", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                character_id: CHARACTER_ID,
                message: message,
                topic_id: currentActiveTopicId,
                conversation_id: currentConversationId
            })
        });

        const data = await response.json();
        typingIndicator.style.display = "none";

        if (data.error) {
            showToast(data.error, "danger");
            return;
        }

        // Update conversation ID if a new one was created
        if (data.conversation_id && !currentConversationId) {
            currentConversationId = data.conversation_id;
            // Refresh sidebar to show the new conversation with its title
            loadConversations();
        } else if (data.title) {
            // Update the title in sidebar if it changed
            const activeItem = document.querySelector('.conversation-item.active');
            if (activeItem) {
                const titleEl = activeItem.querySelector('.conversation-item-title');
                if (titleEl) titleEl.textContent = data.title;
            }
        }

        // Play TTS speech
        speakText(data.reply);

        // Run Typewriter effect with formatting
        createFormattedMessage(data.reply, CHARACTER_NAME, messagesContainer);

        // Show general or context suggestions
        showSuggestions(currentActiveTopicId);

    } catch (e) {
        typingIndicator.style.display = "none";
        console.error("Chat fetch error:", e);
        showToast("Đã xảy ra lỗi khi gửi yêu cầu lên máy chủ.", "danger");
    }
}

// Helper to create user message element
function createUserMessage(message) {
    return createChatMessage(message, 'Bạn', 'user', false);
}

// Activate topic / lecture timeline node
async function activateTopic(element, topicId) {
    // Update active UI
    document.querySelectorAll(".timeline-item").forEach(item => {
        item.classList.remove("active");
    });
    element.classList.add("active");
    currentActiveTopicId = topicId;

    const messagesContainer = document.getElementById("chatMessages");

    // Show typing indicator
    const typingIndicator = document.getElementById("typingIndicator");
    messagesContainer.appendChild(typingIndicator);
    typingIndicator.style.display = "flex";
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    try {
        const response = await fetch(`/topic/${topicId}`);
        const topicData = await response.json();
        typingIndicator.style.display = "none";

        if (topicData.error) {
            showToast(topicData.error, "danger");
            return;
        }

        // Speak and show lecture text
        speakText(topicData.lecture_content);
        createFormattedMessage(topicData.lecture_content, CHARACTER_NAME, messagesContainer);

        // Populate Suggested Chips
        showSuggestions(topicId);

    } catch (e) {
        typingIndicator.style.display = "none";
        console.error("Error fetching topic:", e);
        showToast("Không thể kết nối bài giảng.", "danger");
    }
}

// Show suggested question chips
function showSuggestions(topicId = null) {
    const container = document.getElementById("suggestedChips");
    container.innerHTML = "";
    
    let chipsList = [];
    
    // If a topic is currently active, load its specific questions
    if (topicId && topicSuggestions[topicId]) {
        chipsList = topicSuggestions[topicId];
    } else {
        // Fallback to character's general suggestions or a static set
        const normName = CHARACTER_NAME.normalize("NFC");
        const key = Object.keys(generalSuggestions).find(k => normName.includes(k));
        if (key) {
            chipsList = generalSuggestions[key];
        } else {
            chipsList = [
                `Hãy kể cho tôi nghe thêm về bản thân bạn?`,
                `Công lao lớn nhất của bạn đóng góp cho lịch sử?`,
                `Bạn có lời khuyên nào dành cho thế hệ chúng tôi?`
            ];
        }
    }

    if (chipsList && chipsList.length > 0) {
        chipsList.forEach(q => {
            const chip = document.createElement("div");
            chip.className = "suggested-chip";
            chip.innerHTML = `<i class="fa-regular fa-lightbulb text-warning"></i> ${q}`;
            chip.onclick = () => {
                document.getElementById("chatInput").value = q;
                sendMessage();
            };
            container.appendChild(chip);
        });
        container.style.display = "flex";
    } else {
        container.style.display = "none";
    }
}

// ── Conversation Management ──

/**
 * Load and render the conversation list in the sidebar.
 */
async function loadConversations() {
    try {
        const response = await fetch(`/conversations/${CHARACTER_ID}`);
        const conversations = await response.json();
        renderConversationList(conversations);
    } catch (e) {
        console.error("Error loading conversations:", e);
    }
}

/**
 * Render the conversation list in the sidebar.
 */
function renderConversationList(conversations) {
    const container = document.getElementById("conversationList");

    if (!conversations || conversations.length === 0) {
        container.innerHTML = `
            <div class="empty-conversation-state">
                <i class="fa-solid fa-message"></i>
                <span>Chưa có hội thoại nào</span>
            </div>`;
        return;
    }

    container.innerHTML = conversations.map(conv => `
        <div class="conversation-item ${conv.id === currentConversationId ? 'active' : ''}" data-conv-id="${conv.id}" onclick="switchConversation(${conv.id})">
            <div class="conversation-item-content">
                <span class="conversation-item-title">${escapeHtml(conv.title)}</span>
                <span class="conversation-item-meta">${formatRelativeTime(conv.updated_at)}</span>
            </div>
            <button class="conversation-item-delete" onclick="event.stopPropagation(); deleteConversation(${conv.id})" title="Xóa hội thoại">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </div>
    `).join('');
}

/**
 * Format a timestamp as relative time in Vietnamese.
 */
function formatRelativeTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr + 'Z'); // Treat DB timestamps as UTC
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return 'Vừa xong';
    if (diffMin < 60) return `${diffMin} phút trước`;
    if (diffHrs < 24) return `${diffHrs} giờ trước`;
    if (diffDays < 7) return `${diffDays} ngày trước`;
    return date.toLocaleDateString('vi-VN');
}

/**
 * Create a new conversation.
 */
async function createNewConversation() {
    try {
        const response = await fetch(`/conversation/new/${CHARACTER_ID}`, {
            method: "POST"
        });
        const conv = await response.json();

        // Set as current and clear chat
        currentConversationId = conv.id;

        const chatContainer = document.getElementById("chatMessages");
        chatContainer.innerHTML = `
            <div class="chat-message">
                <div class="chat-bubble-wrapper">
                    <div class="chat-bubble character">
                        Chào bạn! Hãy chọn một <strong>Dòng kiến thức</strong> ở cột bên trái để tôi giảng giải cho bạn, hoặc trực tiếp hỏi tôi bất cứ điều gì liên quan đến cuộc đời và các công trình của tôi nhé!
                    </div>
                    <div class="chat-bubble-meta">${CHARACTER_NAME}</div>
                </div>
            </div>
            <div class="typing-indicator" id="typingIndicator" style="display: none;">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>`;

        // Clear active topic
        currentActiveTopicId = null;
        document.querySelectorAll(".timeline-item").forEach(item => {
            item.classList.remove("active");
        });

        // Refresh sidebar
        await loadConversations();
        showSuggestions(null);

    } catch (e) {
        console.error("Error creating conversation:", e);
        showToast("Lỗi khi tạo hội thoại mới.", "danger");
    }
}

/**
 * Switch to a different conversation and load its messages.
 */
async function switchConversation(convId) {
    if (convId === currentConversationId) return;

    currentConversationId = convId;
    currentActiveTopicId = null;

    // Update active state in sidebar
    document.querySelectorAll(".conversation-item").forEach(item => {
        item.classList.toggle("active", parseInt(item.dataset.convId) === convId);
    });

    // Update timeline active state
    document.querySelectorAll(".timeline-item").forEach(item => {
        item.classList.remove("active");
    });

    // Show typing indicator while loading
    const chatContainer = document.getElementById("chatMessages");
    chatContainer.innerHTML = `
        <div class="typing-indicator" id="typingIndicator" style="display: flex;">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        </div>`;

    try {
        const response = await fetch(`/conversation/${convId}/messages`);
        const messages = await response.json();

        if (messages.error) {
            showToast(messages.error, "danger");
            return;
        }

        chatContainer.innerHTML = '';

        if (messages.length === 0) {
            chatContainer.innerHTML = `
                <div class="chat-message">
                    <div class="chat-bubble-wrapper">
                        <div class="chat-bubble character">
                            Chào bạn! Hãy chọn một <strong>Dòng kiến thức</strong> ở cột bên trái để tôi giảng giải cho bạn, hoặc trực tiếp hỏi tôi bất cứ điều gì liên quan đến cuộc đời và các công trình của tôi nhé!
                        </div>
                        <div class="chat-bubble-meta">${CHARACTER_NAME}</div>
                    </div>
                </div>`;
        } else {
            messages.forEach(msg => {
                const msgElement = createChatMessage(msg.message, msg.sender === 'user' ? 'Bạn' : CHARACTER_NAME, msg.sender);
                chatContainer.appendChild(msgElement);
            });
        }

        // Re-add typing indicator
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'typing-indicator';
        typingIndicator.id = 'typingIndicator';
        typingIndicator.style.display = 'none';
        typingIndicator.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>`;
        chatContainer.appendChild(typingIndicator);

        chatContainer.scrollTop = chatContainer.scrollHeight;
        showSuggestions(null);

    } catch (e) {
        console.error("Error switching conversation:", e);
        showToast("Lỗi khi tải hội thoại.", "danger");
    }
}

/**
 * Delete a conversation.
 */
async function deleteConversation(convId) {
    if (!confirm('Bạn có chắc muốn xóa hội thoại này? Tất cả tin nhắn trong hội thoại sẽ bị xóa vĩnh viễn.')) return;

    try {
        const response = await fetch(`/conversation/${convId}`, { method: "DELETE" });
        const data = await response.json();

        if (data.error) {
            showToast(data.error, "danger");
            return;
        }

        showToast("Đã xóa hội thoại.", "success");

        // If we deleted the active conversation, switch to another or create new
        if (currentConversationId === convId) {
            // Find next available conversation
            const remainingItems = document.querySelectorAll('.conversation-item:not([data-conv-id="' + convId + '"])');
            if (remainingItems.length > 0) {
                const nextId = parseInt(remainingItems[0].dataset.convId);
                await switchConversation(nextId);
            } else {
                // No conversations left — create new one
                currentConversationId = null;
                const chatContainer = document.getElementById("chatMessages");
                chatContainer.innerHTML = `
                    <div class="chat-message">
                        <div class="chat-bubble-wrapper">
                            <div class="chat-bubble character">
                                Chào bạn! Hãy chọn một <strong>Dòng kiến thức</strong> ở cột bên trái để tôi giảng giải cho bạn, hoặc trực tiếp hỏi tôi bất cứ điều gì liên quan đến cuộc đời và các công trình của tôi nhé!
                            </div>
                            <div class="chat-bubble-meta">${CHARACTER_NAME}</div>
                        </div>
                    </div>
                    <div class="typing-indicator" id="typingIndicator" style="display: none;">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>`;
                currentActiveTopicId = null;
                showSuggestions(null);
            }
        }

        // Refresh sidebar
        await loadConversations();

    } catch (e) {
        console.error("Error deleting conversation:", e);
        showToast("Lỗi khi xóa hội thoại.", "danger");
    }
}

// Event Listeners setup
document.addEventListener("DOMContentLoaded", () => {
    // Audio warmup: unlock autoplay on first user interaction
    const warmupEvents = ['click', 'keydown', 'touchstart'];
    function onFirstInteraction() {
        unlockAudio();
        // Remove listeners after first successful interaction
        warmupEvents.forEach(ev => document.removeEventListener(ev, onFirstInteraction));
    }
    warmupEvents.forEach(ev => document.addEventListener(ev, onFirstInteraction, { once: false }));

    // Check microphone permission status
    checkMicPermission();

    // Pre-load voices
    loadVoices();

    // Setup inputs
    const chatInput = document.getElementById("chatInput");
    const sendBtn = document.getElementById("sendBtn");
    const micBtn = document.getElementById("micBtn");
    const toggleMuteBtn = document.getElementById("toggleMuteBtn");
    const stopSpeechBtn = document.getElementById("stopSpeechBtn");
    const muteIcon = document.getElementById("muteIcon");
    const newConversationBtn = document.getElementById("newConversationBtn");
    const rateToggleBtn = document.getElementById("rateToggleBtn");
    const rateLabel = document.getElementById("rateLabel");

    // Click Send
    sendBtn.addEventListener("click", sendMessage);

    // Enter key sends message
    chatInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            sendMessage();
        }
    });

    // New conversation button
    if (newConversationBtn) {
        newConversationBtn.addEventListener("click", createNewConversation);
    }

    // STT Recording setup
    initRecognition();
    micBtn.addEventListener("click", () => {
        if (!recognition) {
            showToast("Tính năng ghi âm giọng nói không khả dụng trên trình duyệt của bạn.", "danger");
            return;
        }

        if (isListening) {
            recognition.stop();
        } else {
            // Cancel TTS if speaking before recording
            if (synthesis && synthesis.speaking) {
                synthesis.cancel();
                stopVisuals();
            }
            // Also stop server audio
            const audio = document.getElementById('ttsAudio');
            if (audio) {
                audio.pause();
                audio.currentTime = 0;
            }
            recognition.start();
        }
    });

    // Mute/Unmute audio
    toggleMuteBtn.addEventListener("click", () => {
        isMuted = !isMuted;
        if (isMuted) {
            if (synthesis) synthesis.cancel();
            const audio = document.getElementById('ttsAudio');
            if (audio) { audio.pause(); audio.currentTime = 0; }
            stopVisuals();
            muteIcon.className = "fa-solid fa-volume-xmark";
            toggleMuteBtn.classList.add("active-audio");
            showToast("Đã tắt âm thanh giọng đọc.", "info");
        } else {
            muteIcon.className = "fa-solid fa-volume-high";
            toggleMuteBtn.classList.remove("active-audio");
            showToast("Đã bật âm thanh giọng đọc.", "success");
        }
    });

    // Stop speaking altogether
    stopSpeechBtn.addEventListener("click", () => {
        if (synthesis) synthesis.cancel();
        const audio = document.getElementById('ttsAudio');
        if (audio) { audio.pause(); audio.currentTime = 0; }
        stopVisuals();
    });

    // Rate toggle: 1x → 1.5x → 1x
    if (rateToggleBtn && rateLabel) {
        rateToggleBtn.addEventListener("click", () => {
            if (speechRate === 1.0) {
                speechRate = 1.5;
                rateLabel.textContent = "1.5x";
                rateToggleBtn.classList.add("active-audio");
                showToast("Tốc độ đọc: Nhanh (1.5x)", "info");
            } else {
                speechRate = 1.0;
                rateLabel.textContent = "1x";
                rateToggleBtn.classList.remove("active-audio");
                showToast("Tốc độ đọc: Bình thường (1x)", "info");
            }
        });
    }

    // Initially trigger general suggested questions
    showSuggestions(null);
});
