import sqlite3
import os
from werkzeug.security import generate_password_hash

DATABASE_PATH = os.path.join(os.path.dirname(__file__), 'history_voyage.db')

def get_db_connection():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Create users table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone_number TEXT UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'student',
        status TEXT DEFAULT 'pending',
        verification_token TEXT,
        otp_code TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    ''')

    # Migration: add new columns to users table if missing
    user_cols = [row[1] for row in cursor.execute("PRAGMA table_info(users)").fetchall()]
    if 'phone_number' not in user_cols:
        cursor.execute('ALTER TABLE users ADD COLUMN phone_number TEXT')
    if 'status' not in user_cols:
        cursor.execute("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'")
    if 'verification_token' not in user_cols:
        cursor.execute('ALTER TABLE users ADD COLUMN verification_token TEXT')
    if 'otp_code' not in user_cols:
        cursor.execute('ALTER TABLE users ADD COLUMN otp_code TEXT')
    if 'created_at' not in user_cols:
        cursor.execute('ALTER TABLE users ADD COLUMN created_at DATETIME')
    if 'updated_at' not in user_cols:
        cursor.execute('ALTER TABLE users ADD COLUMN updated_at DATETIME')

    # Create characters table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        avatar_url TEXT,
        system_prompt TEXT NOT NULL,
        temperature REAL DEFAULT 0.7,
        era TEXT DEFAULT 'medieval',
        region TEXT DEFAULT 'vietnam'
    )
    ''')

    # Migration for characters table
    char_cols = [row[1] for row in cursor.execute("PRAGMA table_info(characters)").fetchall()]
    if 'era' not in char_cols:
        cursor.execute("ALTER TABLE characters ADD COLUMN era TEXT DEFAULT 'medieval'")
    if 'region' not in char_cols:
        cursor.execute("ALTER TABLE characters ADD COLUMN region TEXT DEFAULT 'vietnam'")

    # Create topics table (Dòng kiến thức)
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        lecture_content TEXT NOT NULL,
        FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
    )
    ''')

    # Create conversations table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        character_id INTEGER NOT NULL,
        title TEXT DEFAULT 'Hội thoại mới',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
    )
    ''')

    # Create chat_history table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        character_id INTEGER NOT NULL,
        sender TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(character_id) REFERENCES characters(id) ON DELETE CASCADE
    )
    ''')

    # Migration: add conversation_id column if it doesn't exist
    col_check = cursor.execute("PRAGMA table_info(chat_history)").fetchall()
    col_names = [row[1] for row in col_check]
    if 'conversation_id' not in col_names:
        cursor.execute('ALTER TABLE chat_history ADD COLUMN conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE')
        # Migrate existing data: group old messages by (user_id, character_id) into default conversations
        pairs = cursor.execute('''
            SELECT DISTINCT user_id, character_id FROM chat_history WHERE conversation_id IS NULL
        ''').fetchall()
        for pair in pairs:
            # Create a conversation for this pair's existing history
            cursor.execute(
                'INSERT INTO conversations (user_id, character_id, title, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)',
                (pair['user_id'], pair['character_id'], 'Hội thoại cũ')
            )
            conv_id = cursor.lastrowid
            cursor.execute(
                'UPDATE chat_history SET conversation_id = ? WHERE user_id = ? AND character_id = ? AND conversation_id IS NULL',
                (conv_id, pair['user_id'], pair['character_id'])
            )

    conn.commit()

    # Add default admin if not exists
    cursor.execute('SELECT * FROM users WHERE username = ?', ('admin',))
    if not cursor.fetchone():
        admin_pass = generate_password_hash('admin123')
        cursor.execute(
            'INSERT INTO users (username, email, phone_number, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)',
            ('admin', 'admin@history.edu.vn', '0901234567', admin_pass, 'admin', 'active')
        )

    # Add default student if not exists
    cursor.execute('SELECT * FROM users WHERE username = ?', ('student',))
    if not cursor.fetchone():
        student_pass = generate_password_hash('student123')
        cursor.execute(
            'INSERT INTO users (username, email, phone_number, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)',
            ('student', 'student@history.edu.vn', '0987654321', student_pass, 'student', 'active')
        )

    # Update character eras and regions
    cursor.execute("UPDATE characters SET era='medieval', region='vietnam' WHERE name LIKE '%Trần Hưng Đạo%'")
    cursor.execute("UPDATE characters SET era='modern', region='world' WHERE name LIKE '%Albert Einstein%'")
    cursor.execute("UPDATE characters SET era='modern', region='world' WHERE name LIKE '%Alan Turing%'")
    cursor.execute("UPDATE characters SET era='modern', region='world' WHERE name LIKE '%Charles Darwin%'")
    cursor.execute("UPDATE characters SET era='modern', region='world' WHERE name LIKE '%Thomas Edison%'")
    cursor.execute("UPDATE characters SET era='modern', region='world' WHERE name LIKE '%Marie Curie%'")
    cursor.execute("UPDATE characters SET era='modern', region='world' WHERE name LIKE '%Isaac Newton%'")
    cursor.execute("UPDATE characters SET era='modern', region='world' WHERE name LIKE '%Tesla%'")

    # Helper list of default characters for missing era/regions
    default_chars = [
        ('An Dương Vương', '/static/images/an_duong_vuong.png',
         'Bạn là An Dương Vương Thục Phán, vị vua lập ra nước Âu Lạc, xây đắp thành Cổ Loa 9 xoáy ốc và sở hữu truyền thuyết Nỏ Thần Thần Quang. Hãy trò chuyện với học sinh bằng thái độ hiền minh, trầm tư, đúc kết các bài học lịch sử sâu sắc về sự cảnh giác và tinh thần xây dựng đất nước.',
         0.6, 'ancient', 'vietnam'),
        ('Socrates', '/static/images/socrates.png',
         'Bạn là Socrates, nhà triết học cổ đại Hy Lạp vĩ đại. Hãy dùng phương pháp vấn đáp (Socratic method) để đặt ra các câu hỏi kích thích tư duy học sinh về tri thức, đạo đức và công lý. Xưng hô là "Ta" và gọi học sinh là "bạn trẻ".',
         0.7, 'ancient', 'world'),
        ('Leonardo da Vinci', '/static/images/davinci.png',
         'Bạn là Leonardo da Vinci, thiên tài toàn năng thời Phục Hưng nước Ý, họa sĩ vẽ bức Mona Lisa và tác giả của hàng trăm phát minh khoa học đi trước thời đại. Hãy trò chuyện tràn đầy cảm hứng sáng tạo và đam mê khám phá thiên nhiên.',
         0.7, 'medieval', 'world'),
        ('Võ Nguyên Giáp', '/static/images/vo_nguyen_giap.png',
         'Bạn là Đại tướng Võ Nguyên Giáp, Tổng tư lệnh Quân đội Nhân dân Việt Nam, người anh cả của QĐNDVN, chỉ huy Chiến dịch Điện Biên Phủ lừng lẫy 5 châu. Hãy trò chuyện với học sinh bằng giọng nói ấm áp, điềm tĩnh, đề cao tinh thần yêu nước và sức mạnh đoàn kết toàn dân.',
         0.6, 'modern', 'vietnam')
    ]

    for char_data in default_chars:
        cursor.execute('SELECT id FROM characters WHERE name = ?', (char_data[0],))
        if not cursor.fetchone():
            cursor.execute('''
            INSERT INTO characters (name, avatar_url, system_prompt, temperature, era, region)
            VALUES (?, ?, ?, ?, ?, ?)
            ''', char_data)

    conn.commit()
    conn.close()

if __name__ == '__main__':
    init_db()
    print("Database initialized successfully.")
