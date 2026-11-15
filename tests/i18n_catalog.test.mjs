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

const evidence=JSON.parse(readFileSync(new URL('../docs/game-terminology-ru.json',import.meta.url),'utf8'));
test('Russian game terminology agrees with the reviewed client text IDs',()=>{
 for(const [source,entry] of Object.entries(evidence.terms)){
  assert.match(entry.textId,/^\d+$/,source);
  assert.equal(dictionary[source],entry.translation ?? entry.ru,source);
 }
});
test('Module and facility unlock tooltips use the same names as recipe selectors',()=>{
 for(const [source,target] of Object.entries(dictionary)){
  if(!source.startsWith('Lv.')) continue;
  const lines=target.split('\n');
  source.split('\n').forEach((line,index)=>{
   const match=line.match(/^Lv\.(\d+): (.*)$/);
   if(!match) return;
   const expected=match[2].split(', ').map(name=>{
    assert.ok(dictionary[name],name);
    return dictionary[name];
   });
   assert.equal(lines[index],`Ур. ${match[1]}: ${expected.join(', ')}`,line);
  });
 }
});
test('Game terms do not replace unrelated calculator controls',()=>{
 assert.equal(dictionary.light,'светлая');
 assert.equal(dictionary.dark,'тёмная');
 assert.equal(dictionary.Share,'Доля');
 assert.equal(dictionary.Skip,'Исключить');
});
