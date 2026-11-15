import copy
import json
from pathlib import Path
import tempfile
import unittest

from audit import ROOT, compare, compare_operations, extract, locale


def numeric_keys(value):
    if isinstance(value, dict):
        return {int(k) if k.isdigit() else k: numeric_keys(v) for k, v in value.items()}
    if isinstance(value, list):
        return [numeric_keys(v) for v in value]
    return value


class ClientDataAuditTests(unittest.TestCase):
    def setUp(self):
        self.sample = numeric_keys(json.loads((ROOT / 'tests/fixtures/game-data-3934365.json').read_text()))
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        (self.repo / 'data').mkdir()
        (self.repo / 'docs').mkdir()
        (self.repo / 'docs/game-terminology-ru.json').write_text(
            (ROOT / 'docs/game-terminology-ru.json').read_text())

    def csv(self, name, content):
        (self.repo / 'data' / name).write_text(content)

    def test_normal_workload_is_not_electric_time(self):
        self.csv('carousel_mill.csv', 'name,workload,facility_level,raw_materials,required_amount\nwheatmeal,54,1,wheat,50\n')
        self.csv('e_mode.csv', 'name,production_time\nwheatmeal,54\n')
        rows = compare(self.sample, self.repo)
        self.assertEqual([r['status'] for r in rows], ['matched', 'matched'])
        self.assertEqual([r['formulaId'] for r in rows], [4010032, 40100321])
        altered = copy.deepcopy(self.sample)
        next(r for r in altered['recipes'] if r['id'] == 40100321)['raw'].pop('time')
        self.assertEqual(compare(altered, self.repo)[1]['status'], 'partial')

    def test_reports_historical_season_mistakes(self):
        self.csv('magical_wonder_night.csv', 'name,facility,production_time,facility_level,raw_materials,required_amount\nmagic_pumpkin,Farmland,1800,5,,\nmagic_pumpkin_cake,Blazing Stove,,2,magic_pumpkin;wheatmeal,8;1\n')
        rows = compare(self.sample, self.repo)
        self.assertEqual([r['status'] for r in rows], ['different', 'different'])
        timer = next(c for c in rows[0]['checks'] if c['field'] == 'production_time')
        self.assertEqual(timer['client'], 2400)
        ingredients = next(c for c in rows[1]['checks'] if c['field'] == 'ingredients')
        self.assertEqual(ingredients['client'], [('magic_pumpkin', 8), ('milled_rice', 1)])

    def test_quick_formula_preview_is_not_its_output_item(self):
        self.csv('farmland.csv', 'name,production_time,yield,facility_level\nquick_wheat,1200,42,2\n')
        row = compare(self.sample, self.repo)[0]
        self.assertEqual(row['status'], 'matched')
        self.assertEqual(row['formulaId'], 4020033)

    def test_duplicate_candidates_are_never_selected_arbitrarily(self):
        self.csv('e_mode.csv', 'name,production_time\nwheatmeal,54\n')
        self.sample['recipes'].append(copy.deepcopy(next(r for r in self.sample['recipes'] if r['id'] == 40100321)))
        self.assertEqual(compare(self.sample, self.repo)[0]['status'], 'ambiguous')

    def test_worker_requirement_uses_operation_not_facility_level(self):
        self.csv('aniimo_requirements.csv', 'name,facility,ability,min_level\nlaminated_beams,Woodworking Bench,Artisanship,2\n')
        self.csv('grower_steps.csv', 'name,facility,step,ability,min_level,workload\n')
        rows = compare_operations(self.sample, [{'name': 'laminated_beams', 'mode': 'normal',
                                                'formulaId': 4010171}], self.repo)
        self.assertEqual(rows[0]['status'], 'different')
        self.assertEqual(rows[0]['operationId'], 110103)
        self.assertEqual(rows[0]['checks'][1]['client'], 3)

    def test_missing_worker_rows_are_reported_instead_of_defaulting_to_level_one(self):
        self.csv('aniimo_requirements.csv', 'name,facility,ability,min_level\n')
        self.csv('grower_steps.csv', 'name,facility,step,ability,min_level,workload\n')
        rows = compare_operations(self.sample, [{'name': 'laminated_beams', 'mode': 'normal',
                                                'formulaId': 4010171}], self.repo)
        self.assertEqual(rows[0]['status'], 'missing')
        self.assertEqual(rows[0]['name'], 'laminated_beams')

    def test_manifest_mismatch_stops_before_decode(self):
        archive = self.repo / 'bad.xdf'
        archive.write_bytes(b'not a game archive')
        archive.with_suffix('.xdt').write_text(json.dumps({'CMDataLen': 0, 'CMDataMD5': 'invalid'}))
        with self.assertRaisesRegex(ValueError, 'manifest'):
            extract(archive)

    def test_localization_rejects_out_of_bounds_span(self):
        class Archive:
            def read(self, name):
                return (json.dumps({'_version': 1, '_count': 1, '123': [4, 99]}).encode()
                        if name.endswith('.json') else b'\x01\0\0\0test')
        with self.assertRaisesRegex(ValueError, 'span'):
            locale(Archive(), 'en')


if __name__ == '__main__':
    unittest.main()
