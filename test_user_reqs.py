# File: test_user_reqs.py
import unittest
from app import app
from database import init_db

class TestUserRequirements(unittest.TestCase):
    def setUp(self):
        init_db()
        app.config['TESTING'] = True
        self.client = app.test_client()

    def test_navbar_about_contact_visibility(self):
        # 1. Unauthenticated -> Should see "Giới thiệu" and "Liên hệ"
        res_unauth = self.client.get('/')
        html_unauth = res_unauth.data.decode('utf-8')
        self.assertIn('Giới thiệu', html_unauth)
        self.assertIn('Liên hệ', html_unauth)

        # 2. Authenticated -> Should NOT see "Giới thiệu" and "Liên hệ"
        with self.client.session_transaction() as sess:
            sess['user_id'] = 1
            sess['username'] = 'student'
            sess['role'] = 'student'

        res_auth = self.client.get('/')
        html_auth = res_auth.data.decode('utf-8')
        self.assertNotIn('Giới thiệu', html_auth)
        self.assertNotIn('Liên hệ', html_auth)

    def test_timeline_subsections(self):
        # Authenticate
        with self.client.session_transaction() as sess:
            sess['user_id'] = 1
            sess['username'] = 'student'
            sess['role'] = 'student'

        res = self.client.get('/timeline')
        self.assertEqual(res.status_code, 200)
        html = res.data.decode('utf-8')

        # Check for Vietnam and World subsections for Ancient, Medieval, Modern
        self.assertIn('Cổ Đại ở Việt Nam', html)
        self.assertIn('Cổ Đại trên Thế Giới', html)

        self.assertIn('Trung Đại ở Việt Nam', html)
        self.assertIn('Trung Đại trên Thế Giới', html)

        self.assertIn('Hiện Đại ở Việt Nam', html)
        self.assertIn('Hiện Đại trên Thế Giới', html)

if __name__ == '__main__':
    unittest.main()
