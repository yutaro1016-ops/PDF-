import importlib.util, pathlib, unittest
spec = importlib.util.spec_from_file_location('cost', pathlib.Path(__file__).resolve().parents[1] / 'scripts/hosting-cost-estimate.py')
cost = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cost)

class CostTest(unittest.TestCase):
    def test_full_capacity_requires_sharding_review(self):
        row = cost.estimate(100, 5)
        self.assertEqual(row['pdfGB'], 500)
        self.assertEqual(row['r2GBWithTwoBackups'], 1550)
        self.assertTrue(row['singleD1NeedsCapacityReview'])
        self.assertEqual(row['cloudflareJPY'], 6465)

    def test_annual_price_and_retention_sensitivity(self):
        normal = cost.estimate(10, 1)
        retained = cost.estimate(10, 1, backup_copies=30)
        self.assertLess(normal['annualPlanMonthlyGrossJPY'], normal['supabaseR2JPY'])
        self.assertGreater(retained['cloudflareJPY'], normal['cloudflareJPY'])

if __name__ == '__main__': unittest.main()
