// Global state variables
let isMuted = false;
let currentUtterance = null;
let synthesis = window.speechSynthesis;
let recognition = null;
let currentActiveTopicId = null;
let currentConversationId = ACTIVE_CONVERSATION_ID || null;
let cachedVoices = [];

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

/**
 * Run typewriter effect for character messages with formatting support
 * @param {string} text - The message text
 * @param {string} senderName - Sender name
 * @param {HTMLElement} container - Messages container
 */
function runTypewriter(text, senderName, container) {
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
        recognition.continuous = false;
        recognition.lang = 'vi-VN';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            console.log("Voice recognition started...");
            const micBtn = document.getElementById("micBtn");
            const micIcon = document.getElementById("micIcon");
            micBtn.classList.add("active-rec");
            micIcon.className = "fa-solid fa-microphone-lines";
        };

        recognition.onresult = (event) => {
            const resultText = event.results[0][0].transcript;
            console.log("STT Result:", resultText);
            document.getElementById("chatInput").value = resultText;
            // Send message automatically
            sendMessage();
        };

        recognition.onerror = (event) => {
            console.error("STT Error:", event.error);
            showToast("Không nhận dạng được giọng nói hoặc micro bị từ chối.", "danger");
            resetMicButton();
        };

        recognition.onend = () => {
            console.log("Voice recognition ended.");
            resetMicButton();
        };
    } else {
        console.warn("Web Speech Recognition API not supported in this browser.");
        document.getElementById("micBtn").style.display = "none";
    }
}

function resetMicButton() {
    const micBtn = document.getElementById("micBtn");
    const micIcon = document.getElementById("micIcon");
    if (micBtn && micIcon) {
        micBtn.classList.remove("active-rec");
        micIcon.className = "fa-solid fa-microphone";
    }
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

// Pre-load voices (fix async cold-load bug)
function loadVoices() {
    return new Promise((resolve) => {
        const voices = synthesis.getVoices();
        if (voices.length > 0) {
            cachedVoices = voices;
            resolve(voices);
        } else {
            synthesis.onvoiceschanged = () => {
                cachedVoices = synthesis.getVoices();
                resolve(cachedVoices);
            };
        }
    });
}

// Speak text using TTS
function speakText(text) {
    if (isMuted || !synthesis) return;

    // Stop any ongoing speech
    synthesis.cancel();

    // Clean markdown formatting before speaking
    const cleanText = text.replace(/[*#`_\[\]()]/g, '');

    // Web Speech Synthesis limits the size of text. Let's split by sentences.
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

        // Select a Vietnamese voice if available (from cache)
        const viVoice = cachedVoices.find(voice => voice.lang.includes('vi-VN'));
        if (viVoice) {
            currentUtterance.voice = viVoice;
        } else if (cachedVoices.length > 0) {
            // No Vietnamese voice found — try to use any voice with lang=vi-VN, browser may choose best fallback
            console.warn('Không tìm thấy giọng tiếng Việt (vi-VN) trong danh sách voices. Văn bản có thể không được đọc đúng.');
        }

        currentUtterance.onstart = () => {
            startVisuals();
        };

        currentUtterance.onend = () => {
            currentIndex++;
            speakNext();
        };

        currentUtterance.onerror = (e) => {
            console.error("TTS Utterance error:", e);
            stopVisuals();
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
        
        if (micBtn.classList.contains("active-rec")) {
            recognition.stop();
        } else {
            // Cancel TTS if speaking before recording
            if (synthesis && synthesis.speaking) {
                synthesis.cancel();
                stopVisuals();
            }
            recognition.start();
        }
    });

    // Mute/Unmute audio synthesis
    toggleMuteBtn.addEventListener("click", () => {
        isMuted = !isMuted;
        if (isMuted) {
            if (synthesis) {
                synthesis.cancel();
            }
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
        if (synthesis) {
            synthesis.cancel();
        }
        stopVisuals();
    });

    // Initially trigger general suggested questions
    showSuggestions(null);
});
