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
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'student'
    )
    ''')
    
    # Create characters table
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS characters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        avatar_url TEXT,
        system_prompt TEXT NOT NULL,
        temperature REAL DEFAULT 0.7
    )
    ''')
    
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
            'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
            ('admin', 'admin@history.edu.vn', admin_pass, 'admin')
        )
    
    # Add default student if not exists
    cursor.execute('SELECT * FROM users WHERE username = ?', ('student',))
    if not cursor.fetchone():
        student_pass = generate_password_hash('student123')
        cursor.execute(
            'INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
            ('student', 'student@history.edu.vn', student_pass, 'student')
        )
        
    # Add default characters if none exist
    cursor.execute('SELECT COUNT(*) FROM characters')
    if cursor.fetchone()[0] == 0:
        # Albert Einstein
        cursor.execute('''
        INSERT INTO characters (name, avatar_url, system_prompt, temperature)
        VALUES (?, ?, ?, ?)
        ''', (
            'Albert Einstein',
            '/static/images/einstein.png',
            'Bạn là Albert Einstein, nhà vật lý lý thuyết vĩ đại người Đức. Hãy nói chuyện với học sinh bằng thái độ thông thái, tò mò, luôn sẵn lòng giải thích các hiện tượng khoa học phức tạp bằng cách so sánh gần gũi nhất. Hãy trả lời bằng tiếng Việt tự nhiên, sử dụng các từ ngữ hóm hỉnh và lịch sự. Xưng hô là "Ta" hoặc "Tôi" và gọi học sinh là "bạn" hoặc "nhà khoa học trẻ". Chỉ tập trung thảo luận về khoa học, vật lý, triết học và cuộc đời của bạn. Không trả lời các câu hỏi ngoài lề.',
            0.7
        ))
        einstein_id = cursor.lastrowid
        
        # Einstein topics
        cursor.execute('''
        INSERT INTO topics (character_id, title, lecture_content)
        VALUES (?, ?, ?)
        ''', (
            einstein_id,
            'Hiệu ứng quang điện',
            'Chào bạn! Tôi là Albert Einstein. Hôm nay chúng ta sẽ cùng khám phá Hiệu ứng Quang điện - công trình đã giúp tôi nhận giải Nobel Vật lý năm 1921. Bạn có biết rằng ánh sáng không chỉ lan truyền như những làn sóng, mà còn hoạt động giống như một dòng gồm các hạt năng lượng tí hon gọi là "photon"? Khi các photon này đập vào bề mặt kim loại, chúng truyền năng lượng cho các electron. Nếu năng lượng đủ lớn, electron sẽ bị "đá bay" ra ngoài, tạo ra dòng điện! Điều này giống như việc bạn dùng bóng bowling để ném đổ các chai pin vậy. Bạn có câu hỏi nào về cách ánh sáng tương tác với vật chất không?'
        ))
        cursor.execute('''
        INSERT INTO topics (character_id, title, lecture_content)
        VALUES (?, ?, ?)
        ''', (
            einstein_id,
            'Thuyết tương đối hẹp',
            'Xin chào! Hãy tưởng tượng bạn đang ngồi trên một con tàu chuyển động với tốc độ cực nhanh, gần bằng tốc độ ánh sáng. Đối với bạn, mọi thứ trên tàu vẫn bình thường, nhưng đối với một người đứng trên sân ga, thời gian của bạn dường như trôi chậm lại, và con tàu của bạn dường như bị co ngắn lại! Đó chính là cốt lõi của Thuyết tương đối hẹp mà tôi công bố năm 1905. Thời gian và không gian không hề tuyệt đối mà phụ thuộc vào tốc độ của người quan sát. Và từ đây, chúng ta có công thức nổi tiếng E=mc², cho thấy năng lượng và khối lượng thực chất là hai mặt của cùng một đồng xu. Bạn có thấy điều này kỳ diệu không?'
        ))
        
        # Trần Hưng Đạo
        cursor.execute('''
        INSERT INTO characters (name, avatar_url, system_prompt, temperature)
        VALUES (?, ?, ?, ?)
        ''', (
            'Trần Hưng Đạo',
            '/static/images/tran_hung_dao.png',
            'Bạn là Hưng Đạo Đại Vương Trần Quốc Tuấn (Trần Hưng Đạo), vị Tiết chế thống lĩnh các lực lượng quân sự Đại Việt trong kháng chiến chống quân Nguyên-Mông. Hãy nói chuyện với học sinh bằng phong thái uy nghiêm, trung quân ái quốc, trăn trở về vận mệnh đất nước nhưng hiền từ đối với thế hệ mai sau. Sử dụng ngôn từ trang trọng, hào sảng của một vị tướng thời Trần. Xưng hô là "Ta" và gọi học sinh là "ngươi" hoặc "kẻ hiếu học". Tập trung giảng dạy về lịch sử chiến đấu bảo vệ đất nước thời Trần, tinh thần đoàn kết toàn dân và nghệ thuật quân sự Đại Việt.',
            0.6
        ))
        tran_id = cursor.lastrowid
        
        # Tran Hung Dao topics
        cursor.execute('''
        INSERT INTO topics (character_id, title, lecture_content)
        VALUES (?, ?, ?)
        ''', (
            tran_id,
            'Hịch tướng sĩ',
            'Ta là Trần Quốc Tuấn. Nghe ta hỏi đây! Vận nước đang lúc ngàn cân treo sợi tóc, giặc Nguyên Mông hung hãn đang nhòm ngó cõi bờ. Ta viết Hịch Tướng Sĩ không chỉ để răn đe quân sĩ dưới trướng, mà là để khơi dậy lòng tự tôn dân tộc, chí khí căm thù giặc của muôn dân Đại Việt. Ta thường tới bữa quên ăn, nửa đêm vỗ gối, ruột đau như cắt, nước mắt đầm đìa, chỉ căm tức chưa xả thịt lột da, nuốt gan uống máu quân thù. Dẫu trăm thân này phơi ngoài nội cỏ, nghìn xác này gói trong da ngựa, ta cũng nguyện lòng! Ngươi có hiểu tại sao ý chí đồng lòng của quân dân lại là vũ khí sắc bén nhất để chiến thắng kẻ thù mạnh hơn gấp bội không?'
        ))
        cursor.execute('''
        INSERT INTO topics (character_id, title, lecture_content)
        VALUES (?, ?, ?)
        ''', (
            tran_id,
            'Chiến thuật Vườn không nhà trống',
            'Chào kẻ hiếu học Đại Việt! Quân Nguyên Mông mạnh về kỵ binh, hung hãn và tốc chiến tốc thắng. Nếu ta đối đầu trực diện với thế mạnh của chúng ở đồng bằng, dẫu có dũng cảm cũng khó lòng thủ vững. Do đó, ta cùng triều đình đã dùng kế sách "Vườn không nhà trống". Khi giặc đến, ta chủ động rút lui, mang theo lương thực, phá sạch cầu đường, khiến giặc rơi vào cảnh không có lương ăn, mệt mỏi và chán nản. Khi nhuệ khí của chúng đã suy giảm, thời tiết nắng nóng bệnh tật nổi lên, đó mới là lúc quân ta phản công giành thắng lợi quyết định trên sông Bạch Đằng. Kế sách này cốt ở chỗ biết nhu biết cương, biến bất lợi thành có lợi. Ngươi có thắc mắc gì về nghệ thuật quân sự này không?'
        ))
        
    conn.commit()
    conn.close()

if __name__ == '__main__':
    init_db()
    print("Database initialized successfully.")
