import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root=path.resolve(fileURLToPath(new URL('../web/',import.meta.url))); 
const server=createServer(async(req,res)=>{try{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 const data=await readFile(file);
 res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.wasm':'application/wasm'})[path.extname(file)]||'application/octet-stream'}).end(data);
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.ANIIMAX_CHROMIUM_PATH?{executablePath:process.env.ANIIMAX_CHROMIUM_PATH}:{})});
const page=await browser.newPage({viewport:{width:1600,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://cdn.jsdelivr.net/**',r=>r.abort());
const url=`http://127.0.0.1:${server.address().port}/`;

await mkdir('test-results',{recursive:true});
const inventory=new Map();
async function readRows() {
 return await page.evaluate(()=>{
  const rows=[];
  const where=el=>el.closest('[id]')?.id || el.tagName;
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()) {
   const n=walker.currentNode;const el=n.parentElement;
   if(!el||el.closest('script,style,[data-no-i18n],.math-block,mjx-container'))continue;
   const source=n.nodeValue.trim();if(/[a-z]{2}/i.test(source)) rows.push({source,kind:'text',location:where(el)});
  }
  for(const el of document.querySelectorAll('*')){
   if(el.closest('[data-no-i18n]'))continue;
   for(const kind of ['title','aria-label','aria-description','placeholder','data-label','data-help','data-tip-text','data-tip-detail','data-tip-stats']){
    const source=el.getAttribute(kind)?.trim();if(source&&/[a-z]{2}/i.test(source))rows.push({source,kind,location:where(el)});
   }
  }
  return rows;
 });
}
async function capture(state) {
 const rows=await readRows();
 for(const row of rows){const key=row.source;const prior=inventory.get(key)||{source:row.source,contexts:[]};
 const context={state,kind:row.kind,location:row.location};if(!prior.contexts.some(x=>JSON.stringify(x)===JSON.stringify(context)))prior.contexts.push(context);inventory.set(key,prior);}
 await writeFile('test-results/localization-inventory.json',JSON.stringify([...inventory.values()],null,2));
 await page.locator('#language-switch').selectOption('ru');
 await page.waitForFunction(()=>document.documentElement.lang==='ru');
 const missing=(await readRows()).filter(r=>/[a-z]{3}/i.test(r.source.replace(/\\\(.*?\\\)|aniimax|aniimo|HiGHS|github|Zudin987|ae-bii/gi,'')));
 assert.deepEqual(missing,[],state);
 await page.locator('#language-switch').selectOption('en');
 await page.waitForFunction(()=>document.documentElement.lang==='en');
 console.log(state,inventory.size);
}
try {
 await page.goto(url);
 await page.waitForFunction(()=>document.getElementById('version').textContent.includes('0.16'));
 await capture('initial-hidden-help');
 await page.locator('#home-level').selectOption('20');
 await page.locator('label:has(#mode-advanced)').click();
 await capture('rv20-advanced');
 await page.locator('label:has(#mode-simple)').click();
 await page.locator('#home-level').selectOption('14');
 await page.locator('label:has(#season-on)').click();
 await page.locator('#season-wheat-budget').fill('200');await page.locator('#season-wheat-budget').dispatchEvent('change');
 await page.locator('#season-mutation-plots').fill('1');await page.locator('#season-mutation-plots').dispatchEvent('change');
 await page.evaluate(()=>document.querySelectorAll('details').forEach(el=>el.open=true));
 await page.locator('#festival-batch-build').click();await capture('season-crafting-locked');
 await page.locator('#festival-batch-amount').fill('0');await page.locator('#festival-batch-build').click();await capture('crafting-invalid-quantity');
 await page.locator('#festival-batch-amount').fill('3');await page.locator('#festival-batch-amount').dispatchEvent('input');
 for(const cb of await page.locator('#season-notes input').all())await cb.check({force:true});
 await page.locator('#festival-batch-build').click();await capture('season-crafting-unlocked');
 await page.locator('label:has(#aniimo-custom)').click();
 await page.locator('[data-roster="add"]').click();
 await capture('custom-roster');
 await page.locator('.roster-family').first().selectOption('Iris');
 await capture('iris-roster');
 assert.equal(await page.locator('.roster-family').first().inputValue(),'Iris');
 await page.locator('label:has(#aniimo-best)').click();
 await page.locator('#setup-import-code').click();await page.locator('#setup-import-value').fill('not-a-code');await page.locator('#setup-import-apply').click();await capture('invalid-import');await page.locator('#setup-import-cancel').click();
 await page.locator('#facilitiesToggle').click();await page.waitForSelector('.recipe-table');await capture('recipe-reference');
 const petalsRow=page.locator('.recipe-table tr').filter({has:page.getByText('Petals',{exact:true})}).first();
 assert.match(await petalsRow.innerText(),/Iris family/);
 assert.doesNotMatch(await petalsRow.innerText(),/Nimbi family/);
 await page.locator('#language-switch').selectOption('ru');
 await page.waitForFunction(()=>document.documentElement.lang==='ru');
 const petalsRu=page.locator('.recipe-table tr').filter({has:page.getByText('Лепестки',{exact:true})}).first();
 assert.match(await petalsRu.innerText(),/Ирис/);
 assert.doesNotMatch(await petalsRu.innerText(),/Пушинка/);
 await page.locator('#facilitiesModal .close-button').click();
 assert.deepEqual(errors,[], 'No browser errors');
} finally {
 await writeFile('test-results/localization-inventory.json',JSON.stringify([...inventory.values()],null,2));
 await browser.close();await new Promise(resolve=>server.close(resolve));
}
