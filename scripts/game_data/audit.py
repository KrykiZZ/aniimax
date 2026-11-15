#!/usr/bin/env python3
"""Read-only Aniimo client export and conservative comparison with Aniimax CSVs.

Run from any directory. No game code is executed. Outputs go only to --out;
this command never modifies planner data. Python standard library only.
"""
import argparse
import csv
import hashlib
import json
import re
from collections import defaultdict
from pathlib import Path
from zipfile import ZipFile
from packed import PackedData

ROOT = Path(__file__).resolve().parents[2]
PREFIX = 'xfs/luascripts/'


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def locale(archive, code):
    base = PREFIX + 'Data/I18N/'
    index = json.loads(archive.read(base + f'NewTextMap_{code}.json'))
    blob = archive.read(base + f'Compress_{code}.bin')
    if len(blob) < 4 or int.from_bytes(blob[:4], 'little') != index['_version']:
        raise ValueError('Locale version mismatch: ' + code)
    result = {}
    for key, span in index.items():
        if key.startswith('_'):
            continue
        start, length = span
        if start < 4 or length < 0 or start + length > len(blob):
            raise ValueError('Invalid locale span: ' + key)
        result[int(key)] = blob[start:start + length].decode('utf-8')
    if len(result) != index['_count']:
        raise ValueError('Locale count mismatch: ' + code)
    return result


def slug(value):
    return re.sub(r'[^a-z0-9]+', '_', value.lower()).strip('_')


def extract(archive_path):
    manifest = json.loads(archive_path.with_suffix('.xdt').read_text(encoding='utf-8-sig'))
    raw = archive_path.read_bytes()
    if len(raw) != manifest['CMDataLen'] or hashlib.md5(raw).hexdigest() != manifest['CMDataMD5']:
        raise ValueError('Archive does not match its manifest')
    with ZipFile(archive_path) as archive:
        packed = PackedData(archive.read(PREFIX + 'Common/Data/pmdata.bin'))
        texts = {code: locale(archive, code) for code in ('en', 'ru_RU')}
        names = sorted(n for n in packed.tables if n.startswith(('home_', 'homeland_')))
        tables = {n: packed.expand(packed.tables[n]) for n in names}
        # Items are linked by stable IDs; localized labels are presentation only.
        items = packed.expand(packed.tables['item_data'])
    def label(text_id):
        return {code: values.get(text_id) for code, values in texts.items()}
    def item(item_id):
        row = items.get(item_id, {})
        return {'id': item_id, 'textId': row.get('itemName'), **label(row.get('itemName'))}
    facility_links = defaultdict(list)
    for fid, row in tables['homeland_facility_data'].items():
        for field, mode in [('formulaList', 'normal'), ('electricModeFormulaList', 'electric')]:
            for rid in row.get(field, {}).values():
                facility_links[rid].append({'id': fid, 'typeId': row.get('typeId'), 'level': row.get('level'),
                    'mode': mode, 'name': label(row.get('typeName')),
                    'electricRequire': row.get('electricRequire'), 'mbti': row.get('mbti')})
    recipes = []
    for rid, row in tables['homeland_formula_data'].items():
        inputs = [{'item': item(row[f'consumable{i}']), 'amount': row[f'consumableNum{i}']}
                  for i in range(1, 4) if f'consumable{i}' in row]
        outputs = [{'item': item(pair[1]), 'amount': pair[2]}
                   for pair in row.get('outputs', {}).values()]
        recipes.append({'id': rid, 'item': item(row.get('previewItemId')), 'inputs': inputs,
                        'outputs': outputs, 'facilities': facility_links[rid], 'raw': row})
    referenced = {entry['item']['id'] for r in recipes for entry in r['inputs'] + r['outputs']}
    return {'build': manifest['CMVersion'], 'archiveSha256': hashlib.sha256(raw).hexdigest(),
            'tables': tables, 'items': {i: items[i] for i in sorted(referenced) if i in items},
            'recipes': recipes, 'text': texts}


def compare(export, repo):
    evidence = json.loads((repo / 'docs/game-terminology-ru.json').read_text())['terms']
    aliases = {slug(k): v['en'] for k, v in evidence.items()}
    recipes = export['recipes']
    results = []
    # A CSV name can be a quick-formula alias for the same output item.
    def base_name(name):
        return name.removeprefix('quick_')
    def matches(name, english):
        return english and slug(english) in {name, slug(aliases.get(name, ''))}
    for path in sorted((repo / 'data').glob('*.csv')):
        with path.open(encoding='utf-8', newline='') as stream:
            rows = list(csv.DictReader(stream, skipinitialspace=True))
        if not rows or not ('workload' in rows[0] or 'production_time' in rows[0]):
            continue
        if path.stem == 'grower_steps':
            continue  # Multi-step work needs a separate operation-level audit.
        for row in rows:
            row = {k.strip(): (v or '').strip() for k, v in row.items()}
            name = row['name']
            mode = 'electric' if path.stem == 'e_mode' else 'normal'
            facility = row.get('facility') or path.stem
            candidates = []
            for recipe in recipes:
                if not matches(name, recipe['item'].get('en')):
                    continue
                if bool(recipe['raw'].get('isHighSpeedFormula')) != name.startswith('quick_'):
                    continue
                links = [f for f in recipe['facilities'] if f['mode'] == mode and
                         (path.stem == 'e_mode' or matches(slug(facility), f['name']['en']))]
                if links:
                    candidates.append((recipe, links))
            result = {'file': 'data/' + path.name, 'name': name, 'mode': mode,
                      'candidateIds': [r['id'] for r, _ in candidates], 'checks': []}
            if len(candidates) != 1:
                result['status'] = 'unmatched' if not candidates else 'ambiguous'
                results.append(result)
                continue
            recipe, links = candidates[0]
            result['formulaId'] = recipe['id']
            def check(field, actual):
                if row.get(field) == '' or field not in row:
                    return
                expected = float(row[field])
                result['checks'].append({'field': field, 'planner': expected, 'client': actual,
                                        'status': 'unknown' if actual is None else 'match' if expected == actual else 'different'})
            check('workload', recipe['raw'].get('workload'))
            check('production_time', recipe['raw'].get('time'))
            check('facility_level', min(f['level'] for f in links))
            primary = [o['amount'] for o in recipe['outputs'] if matches(base_name(name), o['item'].get('en'))]
            check('yield', primary[0] if len(primary) == 1 else None)
            primary_ids = [o['item']['id'] for o in recipe['outputs'] if matches(base_name(name), o['item'].get('en'))]
            if len(primary_ids) == 1:
                product_id = primary_ids[0]
                check('energy', export['items'].get(product_id, {}).get('homeFoodAdd'))
                prices = {r['price'][2] for r in export['tables']['homeland_material_config_data'].values()
                          if r['itemId'] == product_id and r.get('price', {}).get(1) == 1010}
                check('sell_value', next(iter(prices)) if len(prices) == 1 else None)
            if row.get('byproduct_yield'):
                byproducts = [o['amount'] for o in recipe['outputs'] if o['item']['id'] not in primary_ids]
                check('byproduct_yield', byproducts[0] if len(byproducts) == 1 else None)
            if row.get('raw_materials'):
                expected = sorted(zip(row['raw_materials'].split(';'), map(float, row['required_amount'].split(';'))))
                actual = sorted((slug(i['item']['en'] or str(i['item']['id'])), i['amount']) for i in recipe['inputs'])
                canonical = sorted((slug(aliases.get(n, n)), a) for n, a in expected)
                result['checks'].append({'field': 'ingredients', 'planner': expected, 'client': actual,
                                        'status': 'match' if canonical == actual else 'different'})
            result['status'] = ('different' if any(c['status'] == 'different' for c in result['checks'])
                                else 'partial' if any(c['status'] == 'unknown' for c in result['checks'])
                                else 'matched')
            results.append(result)
    return results


def compare_operations(export, recipe_checks, repo):
    recipes = {r['id']: r for r in export['recipes']}
    normal = {r['name']: recipes[r['formulaId']] for r in recipe_checks
              if r['mode'] == 'normal' and 'formulaId' in r}
    operations = export['tables']['homeland_operate_data']
    # Game ability IDs, checked against home_ability_data; these are planner aliases.
    ability_names = {1000: 'Fire', 1001: 'Grass', 1002: 'Water', 1003: 'Earth',
                     1004: 'Lightning', 1005: 'Ice', 1006: 'Wind', 1007: 'Dark',
                     1008: 'Light', 1100: 'Hauling', 1101: 'Artisanship',
                     1102: 'Leisure', 1103: 'Perfumery'}
    results = []
    for filename in ['aniimo_requirements.csv', 'grower_steps.csv']:
        with (repo / 'data' / filename).open(encoding='utf-8', newline='') as stream:
            rows = list(csv.DictReader(stream, skipinitialspace=True))
        for row in rows:
            row = {k.strip(): v.strip() for k, v in row.items()}
            recipe = normal.get(row['name'])
            result = {'file': 'data/' + filename, 'name': row['name'], 'step': row.get('step'), 'checks': []}
            if not recipe:
                result['status'] = 'unmatched'
                results.append(result)
                continue
            raw = recipe['raw']
            op_ids = list(raw.get('postOperateList', {}).values())
            if filename == 'grower_steps.csv':
                op_ids += list(raw.get('preOperateList', {}).values())
                if raw.get('timerState'):
                    op_ids.append(raw['timerState'])
                name = 'Cultivating' if row['step'] == 'Reclaiming' else row['step']
                op_ids = [i for i in op_ids if export['text']['en'].get(
                    operations[i].get('workingNameWithoutEllipsis')) == name]
            candidates = [(i, operations[i]) for i in set(op_ids) if operations[i].get('homeAbility')]
            if len(candidates) != 1:
                result.update(status='unmatched' if not candidates else 'ambiguous', candidateIds=[i for i, _ in candidates])
                results.append(result)
                continue
            oid, op = candidates[0]
            actual = {'ability': ability_names.get(op['homeAbility'][1]), 'min_level': op['homeAbility'][2],
                      'workload': op.get('workload')}
            result.update(formulaId=recipe['id'], operationId=oid)
            for field in ['ability', 'min_level', 'workload']:
                if field not in row:
                    continue
                expected = row[field] if field == 'ability' else float(row[field])
                result['checks'].append({'field': field, 'planner': expected, 'client': actual[field],
                    'status': 'unknown' if actual[field] is None else 'match' if expected == actual[field] else 'different'})
            result['status'] = ('different' if any(c['status'] == 'different' for c in result['checks'])
                                else 'partial' if any(c['status'] == 'unknown' for c in result['checks']) else 'matched')
            results.append(result)
    for filename, timed in [('aniimo_requirements.csv', False), ('grower_steps.csv', True)]:
        seen = {r['name'] for r in results if r['file'] == 'data/' + filename}
        for name, recipe in normal.items():
            raw = recipe['raw']
            if ('workload' not in raw) != timed:
                continue
            ids = list(raw.get('postOperateList', {}).values()) + list(raw.get('preOperateList', {}).values())
            if timed:
                ids = [i for i in ids if operations[i].get('workload')]
            if name not in seen and any(operations[i].get('homeAbility') for i in ids):
                results.append({'file': 'data/' + filename, 'name': name, 'formulaId': recipe['id'],
                                'status': 'missing', 'checks': []})
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--repo', type=Path, default=ROOT)
    args = parser.parse_args()
    # Prevent accidental writes anywhere inside the supplied game installation.
    archive = args.archive.resolve()
    game_root = next((p for p in archive.parents if p.name.endswith('_Data')), archive.parent)
    out = args.out.resolve()
    if out == game_root.parent or game_root.parent in out.parents:
        raise ValueError('Output must be outside the game installation')
    export = extract(archive)
    results = compare(export, args.repo)
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / 'recipes.json', export['recipes'])
    write_json(out / 'tables.json', export['tables'])
    write_json(out / 'items.json', export['items'])
    write_json(out / 'comparison.json', results)
    operation_results = compare_operations(export, results, args.repo)
    write_json(out / 'operation-comparison.json', operation_results)
    used = {r['formulaId'] for r in results if 'formulaId' in r}
    write_json(out / 'unmapped-client-recipes.json', [r for r in export['recipes'] if r['id'] not in used])
    counts = {s: sum(r['status'] == s for r in results) for s in ['matched', 'partial', 'different', 'unmatched', 'ambiguous', 'missing']}
    summary = {'build': export['build'], 'archiveSha256': export['archiveSha256'],
               'tables': {n: len(v) for n, v in export['tables'].items()},
               'recipeRecords': len(export['recipes']), 'comparison': counts,
               'operations': {s: sum(r['status'] == s for r in operation_results) for s in ['matched', 'partial', 'different', 'unmatched', 'ambiguous', 'missing']},
               'limitations': ['Recipe records include electric, seasonal and service variants.',
                   'Workload is not a duration; missing time/workload fields are not interchangeable.',
                   'Matching a client row does not prove current server availability.',
                   'Price comparison uses Home Coin prices in homeland_material_config_data; dynamic sale bonuses are not modeled.',
                   'Seed costs, module gates, environment, automatic extra operations and speed formulas need separate semantic verification.']}
    write_json(out / 'summary.json', summary)
    print(json.dumps({'build': export['build'], 'recipes': len(export['recipes']), **counts}, ensure_ascii=False))


if __name__ == '__main__':
    main()
