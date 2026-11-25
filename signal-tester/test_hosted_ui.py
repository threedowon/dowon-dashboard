import unittest
import test_dashboard_bridge


class HostedUITests(unittest.TestCase):
    setUp = test_dashboard_bridge.DashboardBridgeTests.setUp
    tearDown = test_dashboard_bridge.DashboardBridgeTests.tearDown
    request = test_dashboard_bridge.DashboardBridgeTests.request
    api = test_dashboard_bridge.DashboardBridgeTests.api

    def test_pairing_requires_local_click_and_does_not_open_anonymous_api(self):
        status, headers, body = self.request(path='/pair')
        self.assertEqual(status, 200)
        self.assertIn(b'id="allowPair"', body)
        self.assertIn(b'pair.js', body)
        self.assertNotIn('Location', headers)
        self.assertEqual(self.request(path='/pair', headers={'Origin':'https://evil.example'})[0], 403)
        self.assertEqual(self.request(path='/api/state')[0], 403)
        self.assertEqual(self.request(path='/api/state',headers={'Origin':'https://dashboard.3dowon.com'})[0],403)
        self.assertEqual(self.api()[1]['bridgeApiVersion'], 1)
        self.assertEqual(self.request(path='/pair.js')[0],200)
        self.assertEqual(self.request(path='/bridge.js')[0],200)

    def test_untrusted_origins_and_hosts_remain_blocked(self):
        for origin in ['https://dashboard.3dowon.com.evil.example','http://dashboard.3dowon.com','null']:
            self.assertEqual(self.request(path='/api/state',headers={'Origin':origin,'X-Tester-Token':self.server.token})[0],403)
        self.assertEqual(self.request(path='/pair',headers={'Host':'evil.example'})[0],403)


if __name__=='__main__':unittest.main()
