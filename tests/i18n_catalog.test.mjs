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

const {compileTemplates,translateCatalog}=await import('../web/i18n-catalog.js');
const templates=compileTemplates(dictionary);
const translate=text=>translateCatalog(text,dictionary,templates);
test('RV14 compound labels translate without swallowing sentences or decimal values',()=>{
 assert.equal(translate('11,071,910 Home Coins, 34,523 Mineral Sand'),'11,071,910 монет дома, 34,523 Минеральный песок');
 assert.equal(translate('7h 0m in-game upgrade timer after you start it.'),'После запуска улучшения игровой таймер составит 7ч 0м.');
 assert.equal(translate('The selected 120% grid band uses 630 / 660 power. 1 Lightning Aniimo is included in the team for the active generators. Active rated spare: 170; total configured spare: 170.'),'Выбран режим сети 120%; потребление мощности: 630 / 660. В команду включён анимо стихии «Молния» для генератора: 1. Резерв активной мощности: 170; общий заданный резерв: 170.');
 assert.equal(translate('E-Mode levels used for this plan: 1 × Lv. 3 Blazing Stove, 2 × Lv. 4 Carousel Mill. Actual levels determine power use.'),'Уровни объектов в электрорежиме: 1 × Жаркая плита ур. 3, 2 × Карусельная мельница ур. 4. Потребление мощности зависит от фактического уровня объектов.');
 assert.equal(translate('Woodland: Coconut ×12'),'Лесной массив: Кокос ×12');
 assert.equal(translate('3× Water Lv.4 · Faithful (F) (+20% speed) · 3× Well (Quick Fresh Water)'),'3× Вода ур. 4 · Верность (F) (+20% к скорости) · 3× Колодец (Быстрый рецепт: пресная вода)');
 assert.equal(translate('0.014 batch deliveries/hour · 13.6 tiles from storage'),'Доставок партий в час: 0.014 · Расстояние до хранилища: 13.6 клеток');
 assert.equal(translate('Grape · E-Mode · direct generator coverage'),'Виноград · Электрорежим · Прямое покрытие генератора');
 assert.equal(translate('Lv.8: Premium Potato, Quick Agave'),'Ур. 8: Премиальный картофель, Быстрая формула - Агава');
 assert.equal(translate('About Fill from RV'),'О разделе «Заполнение по уровню автодома»');
});
test('Unknown text and captured replacement characters are preserved',()=>{
 assert.equal(translate('Unknown text 1.5'),'Unknown text 1.5');
 assert.equal(translate('Unlock $&'),'Открыть рецепт «$&»');
});

test('Reported GitHub Pages examples, including ability upgrades and dot-grouped rates',()=>{
 assert.equal(translate('Active rated spare: 140; total configured spare: 140.'),'Резерв активной мощности: 140; общий заданный резерв: 140.');
 for(const mode of ['Scorching','Cool','Adequate']) assert.equal(translate(`${mode} coverage`),`Покрытие: ${dictionary[mode]}`);
 for(const ability of ['Water','Leisure','Earth']) assert.equal(translate(`${ability} Aniimo Lv.4`),`Анимо: ${dictionary[ability]} ур. 4`);
 assert.equal(translate('Water Aniimo Lv.3–4'),'Анимо: Вода, ур. 3–4');
 assert.equal(translate('+3.2% Home Coins (+4.951/hour)'),'Монеты дома: +3.2% (+4.951/ч)');
 assert.equal(translate('~+17% Home Coins (+26.472/hour)'),'≈Монеты дома: +17% (+26.472/ч)');
 assert.equal(translate('Unlock Ginseng Porridge'),'Открыть рецепт «Каша с женьшенем»');
});
