import os
import sqlite3
from flask import Flask, render_template, request, redirect, url_for, session, jsonify, flash
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
from openai import OpenAI
from database import get_db_connection, init_db

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
    allowed_routes = ['login', 'register', 'static']
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
    
    # Get chat history for this user and character
    history = conn.execute('''
        SELECT sender, message, timestamp 
        FROM chat_history 
        WHERE user_id = ? AND character_id = ? 
        ORDER BY timestamp ASC
    ''', (session['user_id'], char_id)).fetchall()
    
    conn.close()
    return render_template('chat.html', character=character, topics=topics, history=history)

@app.route('/chat', methods=['POST'])
def handle_chat():
    data = request.json
    character_id = data.get('character_id')
    message = data.get('message', '').strip()
    topic_id = data.get('topic_id')  # Optional
    
    if not character_id or not message:
        return jsonify({'error': 'Thiếu thông tin yêu cầu.'}), 400
        
    conn = get_db_connection()
    character = conn.execute('SELECT * FROM characters WHERE id = ?', (character_id,)).fetchone()
    
    if not character:
        conn.close()
        return jsonify({'error': 'Nhân vật không tìm thấy.'}), 404
        
    user_id = session['user_id']
    
    # Save user message to database
    conn.execute(
        'INSERT INTO chat_history (user_id, character_id, sender, message) VALUES (?, ?, ?, ?)',
        (user_id, character_id, 'user', message)
    )
    conn.commit()
    
    # Retrieve past chat history (up to last 15 messages)
    history_rows = conn.execute('''
        SELECT sender, message 
        FROM chat_history 
        WHERE user_id = ? AND character_id = ? 
        ORDER BY id DESC LIMIT 15
    ''', (user_id, character_id)).fetchall()
    
    # Reverse so it's in chronological order
    history_rows = reversed(history_rows)
    
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
        except Exception as e:
            print(f"NIM API Error: {str(e)}")
            ai_reply = f"Thực xin lỗi, ta đang gặp chút khó khăn khi kết nối với tinh tú vũ trụ (Lỗi kết nối AI: {str(e)}). Ngươi hãy hỏi lại sau nhé!"
    else:
        # Fallback Mock AI response
        ai_reply = f"[MÔ PHỎNG] Ta là {character['name']}. Hiện tại NVIDIA NIM chưa được cấu hình. Câu hỏi của bạn là: '{message}'. Khi có API key, ta sẽ trả lời chính xác theo tính cách của ta!"

    # Save character response to database
    conn.execute(
        'INSERT INTO chat_history (user_id, character_id, sender, message) VALUES (?, ?, ?, ?)',
        (user_id, character_id, 'character', ai_reply)
    )
    conn.commit()
    conn.close()
    
    return jsonify({
        'reply': ai_reply,
        'sender': 'character'
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

# Audio TTS (Mock / Google Cloud TTS fallback)
@app.route('/tts', methods=['POST'])
def text_to_speech():
    data = request.json
    text = data.get('text', '').strip()
    
    if not text:
        return jsonify({'error': 'Không có văn bản.'}), 400
        
    # Standard fallback tells the client to use Web Speech API (Frontend JavaScript)
    # This is highly efficient and works out of the box.
    return jsonify({
        'use_web_speech_api': True,
        'message': 'Sử dụng Web Speech API trên trình duyệt.'
    })

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
        import time
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
        import time
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
