import os
import re
import asyncio
import hashlib
import sqlite3
import tempfile
import time
from io import BytesIO
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, flash, send_file
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from openai import OpenAI
from gtts import gTTS
import edge_tts
from database import get_db_connection, init_db

# Helper function to clean AI response - remove markdown, action descriptions, excessive formatting
def clean_ai_reply(raw_text: str) -> str:
    """
    Clean AI response to remove:
    - Action descriptions: *action*, **action**, *mim cuoi*, etc.
    - Markdown formatting: **bold**, *italic*, `code`, ### headers, --- hr
    - Math notation: $...$, $$...$$
    - Bullet points starting with *
    - Excessive newlines
    """
    if not raw_text:
        return ""

    text = raw_text

    # Remove action descriptions in asterisks at line start (e.g., *Mỉm cười...*, **Kẻ hiếu học!**)
    text = re.sub(r'\n\s*\*{1,2}[^\n\*]{1,80}\*{1,2}\s*\n', '\n', text)
    text = re.sub(r'^\s*\*{1,2}[^\n\*]{1,80}\*{1,2}\s*\n', '', text, flags=re.MULTILINE)

    # Remove standalone bullet points (lines starting with * that look like actions)
    text = re.sub(r'^\s*\*\s+[^\n]{1,80}$', '', text, flags=re.MULTILINE)

    # Remove bullet points starting with * or -
    text = re.sub(r'^[\s]*[\*\-][\s]+', '', text, flags=re.MULTILINE)

    # Remove markdown bold/italic
    text = re.sub(r'\*{2}([^\*\n]+)\*{2}', r'\1', text)
    text = re.sub(r'\*{1}([^\*\n]+)\*{1}', r'\1', text)

    # Remove markdown headers ###, ##, ---
    text = re.sub(r'^#{1,6}\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'\n\s*---\s*\n', '\n', text)

    # Remove math notation $...$ and $$...$$ (keep content)
    text = re.sub(r'\$\$([^\$]+)\$\$', r'\1', text)
    text = re.sub(r'\$([^\$]+)\$', r'\1', text)

    # Remove backticks
    text = re.sub(r'`([^`]+)`', r'\1', text)

    # Clean excessive newlines (max 2)
    text = re.sub(r'\n{3,}', '\n\n', text)

    # Strip
    text = text.strip()

    return text

# Load environment variables
load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "history_voyage_secret_key_13579")
app.config['UPLOAD_FOLDER'] = os.path.join(app.root_path, 'static', 'uploads')
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max upload size

# Initialize database on startup to ensure tables exist
init_db()

# Configure NVIDIA NIM (OpenAI-compatible API)
nim_base_url = os.getenv("NVIDIA_NIM_BASE_URL", "https://integrate.api.nvidia.com/v1")
nim_api_key = os.getenv("NVIDIA_API_KEY")
nim_model = os.getenv("NVIDIA_NIM_MODEL", "nvidia/nemotron-3-ultra")

if nim_api_key and nim_api_key != "YOUR_NVIDIA_API_KEY_HERE":
    nim_client = OpenAI(base_url=nim_base_url, api_key=nim_api_key)
    print(f"NVIDIA NIM configured successfully (model: {nim_model}).")
else:
    nim_client = None
    print("WARNING: NVIDIA_API_KEY is not set. Chat features will run in mock mode.")

# Ensure upload directory exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

# Helper function to check if user is logged in
def is_logged_in():
    return 'user_id' in session

# Helper function to check if user is admin
def is_admin():
    return session.get('role') == 'admin'

# Middleware to check auth
@app.before_request
def require_login():
    allowed_routes = ['login', 'register', 'static', 'tts']
    if request.endpoint and request.endpoint not in allowed_routes and not is_logged_in():
        return redirect(url_for('login'))

@app.route('/')
def index():
    conn = get_db_connection()
    characters = conn.execute('SELECT * FROM characters').fetchall()
    conn.close()
    return render_template('index.html', characters=characters, username=session.get('username'), role=session.get('role'))

# Authentication Routes
@app.route('/register', methods=['GET', 'POST'])
def register():
    if is_logged_in():
        return redirect(url_for('index'))
        
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        email = request.form.get('email', '').strip()
        password = request.form.get('password', '')
        
        if not username or not email or not password:
            flash('Vui lòng điền đầy đủ thông tin!', 'danger')
            return render_template('register.html')
            
        conn = get_db_connection()
        user_check = conn.execute('SELECT id FROM users WHERE username = ? OR email = ?', (username, email)).fetchone()
        
        if user_check:
            flash('Tên đăng nhập hoặc Email đã tồn tại!', 'danger')
            conn.close()
            return render_template('register.html')
            
        pass_hash = generate_password_hash(password)
        try:
            conn.execute(
                'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
                (username, email, pass_hash, 'student')
            )
            conn.commit()
            flash('Đăng ký tài khoản thành công! Hãy đăng nhập.', 'success')
            conn.close()
            return redirect(url_for('login'))
        except Exception as e:
            conn.close()
            flash(f'Đã xảy ra lỗi: {str(e)}', 'danger')
            
    return render_template('register.html')

@app.route('/login', methods=['GET', 'POST'])
def login():
    if is_logged_in():
        return redirect(url_for('index'))
        
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        
        if not username or not password:
            flash('Vui lòng điền đầy đủ thông tin!', 'danger')
            return render_template('login.html')
            
        conn = get_db_connection()
        user = conn.execute('SELECT * FROM users WHERE username = ?', (username,)).fetchone()
        conn.close()
        
        if user and check_password_hash(user['password_hash'], password):
            session['user_id'] = user['id']
            session['username'] = user['username']
            session['role'] = user['role']
            flash(f'Chào mừng trở lại, {username}!', 'success')
            return redirect(url_for('index'))
        else:
            flash('Tên đăng nhập hoặc mật khẩu không chính xác!', 'danger')
            
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear()
    flash('Bạn đã đăng xuất thành công.', 'info')
    return redirect(url_for('login'))

# Learning & Chat Routes
@app.route('/chat/<int:char_id>')
def chat_room(char_id):
    conn = get_db_connection()
    character = conn.execute('SELECT * FROM characters WHERE id = ?', (char_id,)).fetchone()
    if not character:
        conn.close()
        flash('Nhân vật không tồn tại!', 'danger')
        return redirect(url_for('index'))

    topics = conn.execute('SELECT * FROM topics WHERE character_id = ?', (char_id,)).fetchall()
    user_id = session['user_id']

    # Find the most recent conversation for this user + character
    active_conv = conn.execute('''
        SELECT id FROM conversations
        WHERE user_id = ? AND character_id = ?
        ORDER BY updated_at DESC LIMIT 1
    ''', (user_id, char_id)).fetchone()

    if active_conv:
        active_conv_id = active_conv['id']
        # Load history only for this conversation
        history = conn.execute('''
            SELECT sender, message, timestamp
            FROM chat_history
            WHERE user_id = ? AND character_id = ? AND conversation_id = ?
            ORDER BY timestamp ASC
        ''', (user_id, char_id, active_conv_id)).fetchall()
    else:
        active_conv_id = None
        history = []

    # Load all conversations for sidebar
    conversations = conn.execute('''
        SELECT id, title, created_at, updated_at,
               (SELECT message FROM chat_history WHERE conversation_id = conversations.id AND sender = 'user' ORDER BY timestamp ASC LIMIT 1) as first_message
        FROM conversations
        WHERE user_id = ? AND character_id = ?
        ORDER BY updated_at DESC
    ''', (user_id, char_id)).fetchall()

    conn.close()
    return render_template('chat.html', character=character, topics=topics, history=history,
                           active_conversation_id=active_conv_id, conversations=conversations)

@app.route('/chat', methods=['POST'])
def handle_chat():
    data = request.json
    character_id = data.get('character_id')
    message = data.get('message', '').strip()
    topic_id = data.get('topic_id')  # Optional
    conversation_id = data.get('conversation_id')  # Optional

    if not character_id or not message:
        return jsonify({'error': 'Thiếu thông tin yêu cầu.'}), 400

    conn = get_db_connection()
    character = conn.execute('SELECT * FROM characters WHERE id = ?', (character_id,)).fetchone()

    if not character:
        conn.close()
        return jsonify({'error': 'Nhân vật không tìm thấy.'}), 404

    user_id = session['user_id']

    # Auto-create conversation if not provided
    is_new_conversation = False
    if not conversation_id:
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO conversations (user_id, character_id) VALUES (?, ?)',
            (user_id, character_id)
        )
        conversation_id = cursor.lastrowid
        is_new_conversation = True

    # Save user message to database
    conn.execute(
        'INSERT INTO chat_history (user_id, character_id, sender, message, conversation_id) VALUES (?, ?, ?, ?, ?)',
        (user_id, character_id, 'user', message, conversation_id)
    )
    conn.commit()

    # Auto-update conversation title from first user message
    if is_new_conversation:
        title_text = message[:50] + ('...' if len(message) > 50 else '')
        conn.execute(
            'UPDATE conversations SET title = ? WHERE id = ?',
            (title_text, conversation_id)
        )
        conn.commit()

    # Update conversation timestamp
    conn.execute(
        'UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        (conversation_id,)
    )
    conn.commit()

    # Retrieve past chat history (up to last 15 messages from THIS conversation)
    history_rows = conn.execute('''
        SELECT sender, message
        FROM chat_history
        WHERE user_id = ? AND character_id = ? AND conversation_id = ?
        ORDER BY id DESC LIMIT 15
    ''', (user_id, character_id, conversation_id)).fetchall()

    # Reverse so it's in chronological order
    history_rows = list(reversed(history_rows))
    
    # Build System Prompt and Context
    system_prompt = character['system_prompt']
    
    # If the user selected a topic, we append the topic context to the prompt
    topic_context = ""
    if topic_id:
        topic = conn.execute('SELECT * FROM topics WHERE id = ?', (topic_id,)).fetchone()
        if topic:
            topic_context = f"\n[Bối cảnh bài giảng về '{topic['title']}']:\nNội dung chính: {topic['lecture_content']}\n\nHãy tập trung giải thích sâu hơn, trả lời các thắc mắc về chủ đề này dựa trên nội dung bài giảng trên."
            system_prompt += topic_context

    ai_reply = ""

    # Check if NIM client is active
    if nim_client:
        try:
            # Build messages for OpenAI-compatible API
            messages = [{"role": "system", "content": system_prompt}]

            # Add conversation history
            for row in history_rows:
                role = "user" if row['sender'] == 'user' else 'assistant'
                messages.append({"role": role, "content": row['message']})

            # Request generation from NIM
            response = nim_client.chat.completions.create(
                model=nim_model,
                messages=messages,
                temperature=character['temperature'] or 0.7,
                max_tokens=2048,
            )

            ai_reply = response.choices[0].message.content
            # Clean markdown, action descriptions from AI response
            ai_reply = clean_ai_reply(ai_reply)
        except Exception as e:
            print(f"NIM API Error: {str(e)}")
            ai_reply = f"Thực xin lỗi, ta đang gặp chút khó khăn khi kết nối với tinh tú vũ trụ (Lỗi kết nối AI: {str(e)}). Ngươi hãy hỏi lại sau nhé!"
    else:
        # Fallback Mock AI response
        ai_reply = f"[MÔ PHỎNG] Ta là {character['name']}. Hiện tại NVIDIA NIM chưa được cấu hình. Câu hỏi của bạn là: '{message}'. Khi có API key, ta sẽ trả lời chính xác theo tính cách của ta!"

    # Save character response to database
    conn.execute(
        'INSERT INTO chat_history (user_id, character_id, sender, message, conversation_id) VALUES (?, ?, ?, ?, ?)',
        (user_id, character_id, 'character', ai_reply, conversation_id)
    )
    conn.commit()

    # Get updated title for response
    conv_title = conn.execute('SELECT title FROM conversations WHERE id = ?', (conversation_id,)).fetchone()['title']
    conn.close()

    return jsonify({
        'reply': ai_reply,
        'sender': 'character',
        'conversation_id': conversation_id,
        'title': conv_title
    })

# Topic activation (returns the static lecture content to play first)
@app.route('/topic/<int:topic_id>')
def get_topic(topic_id):
    conn = get_db_connection()
    topic = conn.execute('SELECT * FROM topics WHERE id = ?', (topic_id,)).fetchone()
    conn.close()
    
    if not topic:
        return jsonify({'error': 'Dòng kiến thức không tồn tại.'}), 404
        
    return jsonify({
        'id': topic['id'],
        'title': topic['title'],
        'lecture_content': topic['lecture_content']
    })

# ── TTS cache directory ──
TTS_CACHE_DIR = os.path.join(tempfile.gettempdir(), 'history_voyage_tts')
os.makedirs(TTS_CACHE_DIR, exist_ok=True)

# Vietnamese neural voice from Microsoft Edge TTS
EDGE_TTS_VOICE = 'vi-VN-NamMinhNeural'  # Alternate: vi-VN-HoaiMyNeural (Female)


def _text_to_speech_edge(text: str) -> BytesIO | None:
    """
    Generate TTS audio via Microsoft Edge TTS (neural Vietnamese voice).
    Returns BytesIO with MP3 data, or None on failure.
    """
    try:
        communicate = edge_tts.Communicate(text=text, voice=EDGE_TTS_VOICE)
        buf = BytesIO()

        async def _stream():
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    buf.write(chunk["data"])

        asyncio.run(_stream())
        buf.seek(0)

        if buf.getbuffer().nbytes == 0:
            return None
        return buf

    except Exception as e:
        print(f"edge-tts error: {e}")
        return None


def _text_to_speech_audio_gtts(text: str) -> BytesIO | None:
    """
    Generate TTS audio via gTTS (Google) — fallback.
    Returns BytesIO with MP3 data, or None on failure.
    """
    try:
        tts = gTTS(text=text, lang='vi', slow=False)
        buf = BytesIO()
        tts.write_to_fp(buf)
        buf.seek(0)
        return buf
    except Exception as e:
        print(f"gTTS error: {e}")
        return None


# Audio TTS — edge-tts primary, gTTS fallback, then browser Web Speech API
@app.route('/tts', methods=['POST'])
def text_to_speech():
    data = request.json
    text = data.get('text', '').strip()

    if not text:
        return jsonify({'error': 'Không có văn bản.'}), 400

    # Cache key: text hash + voice name (so different voices produce different cache files)
    voice_key = EDGE_TTS_VOICE
    key_raw = f'{text}|{voice_key}'
    text_hash = hashlib.md5(key_raw.encode('utf-8')).hexdigest()
    cache_path = os.path.join(TTS_CACHE_DIR, f'{text_hash}.mp3')

    if not os.path.exists(cache_path):
        audio_buf = None

        # 1. Try edge-tts (neural Vietnamese — best quality)
        audio_buf = _text_to_speech_edge(text)

        # 2. Fallback to gTTS
        if not audio_buf:
            audio_buf = _text_to_speech_audio_gtts(text)

        # 3. Both failed — tell client to use browser Web Speech API
        if not audio_buf:
            return jsonify({'use_web_speech_api': True,
                            'message': 'Cả edge-tts và gTTS đều không khả dụng. Dùng browser TTS.'}), 503

        with open(cache_path, 'wb') as f:
            f.write(audio_buf.read())

    return send_file(cache_path, mimetype='audio/mpeg')

# ── Conversation Management APIs ──

@app.route('/conversations/<int:char_id>')
def get_conversations(char_id):
    """Get all conversations for the current user and character."""
    conn = get_db_connection()
    conversations = conn.execute('''
        SELECT c.id, c.title, c.created_at, c.updated_at,
               (SELECT COUNT(*) FROM chat_history WHERE conversation_id = c.id) as message_count,
               (SELECT message FROM chat_history WHERE conversation_id = c.id AND sender = 'user' ORDER BY timestamp ASC LIMIT 1) as first_message
        FROM conversations c
        WHERE c.user_id = ? AND c.character_id = ?
        ORDER BY c.updated_at DESC
    ''', (session['user_id'], char_id)).fetchall()
    conn.close()
    return jsonify([dict(conv) for conv in conversations])

@app.route('/conversation/new/<int:char_id>', methods=['POST'])
def create_conversation(char_id):
    """Create a new conversation."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        'INSERT INTO conversations (user_id, character_id) VALUES (?, ?)',
        (session['user_id'], char_id)
    )
    conn.commit()
    conv_id = cursor.lastrowid
    conv = conn.execute('SELECT * FROM conversations WHERE id = ?', (conv_id,)).fetchone()
    conn.close()
    return jsonify(dict(conv))

@app.route('/conversation/<int:conv_id>', methods=['DELETE'])
def delete_conversation(conv_id):
    """Delete a conversation (and cascade delete its messages)."""
    conn = get_db_connection()
    conv = conn.execute('SELECT * FROM conversations WHERE id = ?', (conv_id,)).fetchone()
    if not conv:
        conn.close()
        return jsonify({'error': 'Hội thoại không tồn tại.'}), 404
    if conv['user_id'] != session['user_id']:
        conn.close()
        return jsonify({'error': 'Không có quyền xóa hội thoại này.'}), 403

    # Delete messages first (SQLite doesn't support FK cascading for direct deletes)
    conn.execute('DELETE FROM chat_history WHERE conversation_id = ?', (conv_id,))
    conn.execute('DELETE FROM conversations WHERE id = ?', (conv_id,))
    conn.commit()
    conn.close()
    return jsonify({'success': True})

@app.route('/conversation/<int:conv_id>/messages')
def get_conversation_messages(conv_id):
    """Get all messages of a conversation."""
    conn = get_db_connection()
    conv = conn.execute('SELECT * FROM conversations WHERE id = ?', (conv_id,)).fetchone()
    if not conv:
        conn.close()
        return jsonify({'error': 'Hội thoại không tồn tại.'}), 404
    if conv['user_id'] != session['user_id']:
        conn.close()
        return jsonify({'error': 'Không có quyền xem hội thoại này.'}), 403

    messages = conn.execute('''
        SELECT sender, message, timestamp
        FROM chat_history
        WHERE conversation_id = ?
        ORDER BY timestamp ASC
    ''', (conv_id,)).fetchall()
    conn.close()
    return jsonify([dict(msg) for msg in messages])

# Admin Dashboard
@app.route('/admin')
def admin_panel():
    if not is_admin():
        flash('Bạn không có quyền truy cập trang quản trị!', 'danger')
        return redirect(url_for('index'))
        
    conn = get_db_connection()
    characters = conn.execute('SELECT * FROM characters').fetchall()
    
    # Build list of characters with their topics
    characters_list = []
    for char in characters:
        topics = conn.execute('SELECT * FROM topics WHERE character_id = ?', (char['id'],)).fetchall()
        characters_list.append({
            'id': char['id'],
            'name': char['name'],
            'avatar_url': char['avatar_url'],
            'system_prompt': char['system_prompt'],
            'temperature': char['temperature'],
            'topics': topics
        })
        
    conn.close()
    return render_template('admin.html', characters=characters_list, username=session.get('username'))

@app.route('/admin/character/add', methods=['POST'])
def add_character():
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 403
        
    name = request.form.get('name', '').strip()
    system_prompt = request.form.get('system_prompt', '').strip()
    temperature = float(request.form.get('temperature', 0.7))
    avatar_file = request.files.get('avatar')
    
    if not name or not system_prompt:
        flash('Tên và System Prompt là bắt buộc!', 'danger')
        return redirect(url_for('admin_panel'))
        
    avatar_url = '/static/images/default_avatar.png'
    if avatar_file and avatar_file.filename:
        filename = secure_filename(avatar_file.filename)
        # Unique filename using id or random suffix is recommended, let's prefix it
        filename = f"{int(time.time())}_{filename}"
        avatar_file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        avatar_url = f'/static/uploads/{filename}'
        
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO characters (name, avatar_url, system_prompt, temperature)
        VALUES (?, ?, ?, ?)
    ''', (name, avatar_url, system_prompt, temperature))
    conn.commit()
    conn.close()
    
    flash('Thêm nhân vật mới thành công!', 'success')
    return redirect(url_for('admin_panel'))

@app.route('/admin/character/edit/<int:char_id>', methods=['POST'])
def edit_character(char_id):
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 403
        
    name = request.form.get('name', '').strip()
    system_prompt = request.form.get('system_prompt', '').strip()
    temperature = float(request.form.get('temperature', 0.7))
    avatar_file = request.files.get('avatar')
    
    if not name or not system_prompt:
        flash('Tên và System Prompt là bắt buộc!', 'danger')
        return redirect(url_for('admin_panel'))
        
    conn = get_db_connection()
    character = conn.execute('SELECT * FROM characters WHERE id = ?', (char_id,)).fetchone()
    if not character:
        conn.close()
        flash('Nhân vật không tồn tại!', 'danger')
        return redirect(url_for('admin_panel'))
        
    avatar_url = character['avatar_url']
    if avatar_file and avatar_file.filename:
        filename = secure_filename(avatar_file.filename)
        filename = f"{int(time.time())}_{filename}"
        avatar_file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        avatar_url = f'/static/uploads/{filename}'
        
    conn.execute('''
        UPDATE characters 
        SET name = ?, avatar_url = ?, system_prompt = ?, temperature = ?
        WHERE id = ?
    ''', (name, avatar_url, system_prompt, temperature, char_id))
    conn.commit()
    conn.close()
    
    flash('Cập nhật nhân vật thành công!', 'success')
    return redirect(url_for('admin_panel'))

@app.route('/admin/character/delete/<int:char_id>', methods=['POST'])
def delete_character(char_id):
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 403
        
    conn = get_db_connection()
    conn.execute('DELETE FROM characters WHERE id = ?', (char_id,))
    conn.commit()
    conn.close()
    
    flash('Xóa nhân vật thành công!', 'success')
    return redirect(url_for('admin_panel'))

# Admin Topics Management
@app.route('/admin/topic/add', methods=['POST'])
def add_topic():
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 403
        
    character_id = request.form.get('character_id')
    title = request.form.get('title', '').strip()
    lecture_content = request.form.get('lecture_content', '').strip()
    
    if not character_id or not title or not lecture_content:
        flash('Tất cả các trường là bắt buộc!', 'danger')
        return redirect(url_for('admin_panel'))
        
    conn = get_db_connection()
    conn.execute('''
        INSERT INTO topics (character_id, title, lecture_content)
        VALUES (?, ?, ?)
    ''', (character_id, title, lecture_content))
    conn.commit()
    conn.close()
    
    flash('Thêm dòng kiến thức thành công!', 'success')
    return redirect(url_for('admin_panel'))

@app.route('/admin/topic/edit/<int:topic_id>', methods=['POST'])
def edit_topic(topic_id):
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 403
        
    title = request.form.get('title', '').strip()
    lecture_content = request.form.get('lecture_content', '').strip()
    
    if not title or not lecture_content:
        flash('Tiêu đề và Bài giảng là bắt buộc!', 'danger')
        return redirect(url_for('admin_panel'))
        
    conn = get_db_connection()
    conn.execute('''
        UPDATE topics 
        SET title = ?, lecture_content = ?
        WHERE id = ?
    ''', (title, lecture_content, topic_id))
    conn.commit()
    conn.close()
    
    flash('Cập nhật dòng kiến thức thành công!', 'success')
    return redirect(url_for('admin_panel'))

@app.route('/admin/topic/delete/<int:topic_id>', methods=['POST'])
def delete_topic(topic_id):
    if not is_admin():
        return jsonify({'error': 'Unauthorized'}), 403
        
    conn = get_db_connection()
    conn.execute('DELETE FROM topics WHERE id = ?', (topic_id,))
    conn.commit()
    conn.close()
    
    flash('Xóa dòng kiến thức thành công!', 'success')
    return redirect(url_for('admin_panel'))

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5001)
#update: 2026-08-05