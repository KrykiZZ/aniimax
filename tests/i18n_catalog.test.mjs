import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
const dictionary=JSON.parse(readFileSync(new URL('../web/locales/ru.json',import.meta.url),'utf8'));
test('Russian messages preserve interpolated values',()=>{
 for(const [source,target] of Object.entries(dictionary)){
  assert.ok(target.trim(),source);
  const slots=s=>[...new Set(s.match(/\{[a-z_]+\}/gi)||[])].sort();
  assert.deepEqual(slots(target),slots(source),source);
 }
});
