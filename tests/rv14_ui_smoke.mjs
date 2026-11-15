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

// Inspect rendered text and user-facing attributes, including SVG tooltips but not
// diagram abbreviations, formula markup, technical attributes or hidden dialogs.
async function untranslated(root = 'body') {
 return page.locator(root).evaluate(element => {
  const findings=new Set();
  const check=text=>{
   const rest=text.replace(/aniimax|github|Zudin987|ae-bii/gi,'');
   if(/[a-z]{3}|Lv\./i.test(rest)) findings.add(text);
  };
  const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
  while(walker.nextNode()) {
   const node=walker.currentNode;
   if(!node.parentElement?.getClientRects().length || node.parentElement.closest('script,style,svg,mjx-container,[data-no-i18n]')) continue;
   check(node.nodeValue.trim());
  }
  for(const el of element.querySelectorAll('*')) {
   if(!el.getClientRects().length || el.closest('[data-no-i18n]')) continue;
   for(const name of ['title','aria-label','placeholder','data-help','data-tip-text','data-tip-detail','data-tip-stats']) {
    if(el.hasAttribute(name)) check(el.getAttribute(name));
   }
  }
  return [...findings];
 });
}
async function checkLayout(width) {
 await page.setViewportSize({width,height:1000});
 const metrics=await page.evaluate(()=>({
  viewport:innerWidth,width:document.documentElement.scrollWidth,
  body:document.body.getBoundingClientRect().width,
  tables:[...document.querySelectorAll('.env-unit-table,.facility-plan-table')].filter(el=>el.getClientRects().length).map(el=>({width:el.clientWidth,scroll:el.scrollWidth})),
 }));
 assert.ok(metrics.width<=width+2,`page overflow at ${width}: ${JSON.stringify(metrics)}`);
 assert.ok(metrics.tables.every(t=>t.scroll<=t.width+2),`plan table overflow at ${width}: ${JSON.stringify(metrics)}`);
 if(width===1600) assert.ok(metrics.body>=1580,'wide desktop uses the expanded page');
 if(width===1440) assert.ok(metrics.body>=1400,'desktop uses the available width');
 const moduleMetrics=await page.locator('#simple-module-levels').evaluate(el=>[...el.querySelectorAll('select')].map(select=>{
  const box=select.getBoundingClientRect();
  const canvas=document.createElement('canvas');const context=canvas.getContext('2d');context.font=getComputedStyle(select).font;
  return {width:box.width,top:Math.round(box.top),text:context.measureText(select.selectedOptions[0].textContent).width};
 }));
 assert.ok(moduleMetrics.every(m=>m.width>=m.text+40),`module selection clipped at ${width}: ${JSON.stringify(moduleMetrics)}`);
 if(width>=1440) assert.equal(new Set(moduleMetrics.map(m=>m.top)).size,1,'module selectors align');
 await page.locator('#simple-module-levels').screenshot({path:`test-results/rv14-modules-${width}.png`});
 await page.screenshot({path:`test-results/rv14-${width}.png`,fullPage:true});
}
try {
 await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
 await page.goto(url);
 await page.waitForFunction(()=>document.getElementById('version').textContent.includes('0.16'));
 await page.locator('#home-level').selectOption('14');
 await page.locator('#language-switch').selectOption('ru');
 await page.waitForFunction(()=>document.documentElement.lang==='ru');
 // Include ability-upgrade opportunities, not just recipe unlocks.
 for(const ability of ['Water','Leisure','Earth']) await page.locator(`label:has(input[name="level-${ability}"][value="3"])`).click();
 await page.locator('#optimize-btn').click();
 await page.waitForFunction(()=>!document.getElementById('optimize-btn').disabled,{},{timeout:180000});
 await page.waitForSelector('#layout-diagram svg',{timeout:180000});
 await page.waitForFunction(()=>!document.querySelector('.progress-step.running,.progress-step.pending'),{},{timeout:180000});
 await page.evaluate(()=>document.querySelectorAll('details').forEach(el=>el.open=true));
 await page.locator('#aniimo-toggle').click();
 await page.locator('#layout-sim-on').uncheck();
 assert.equal(await page.locator('#home-level').inputValue(),'14');
 assert.ok(await page.locator('.facility-plan-table tbody tr').count()>20);
 const missing=await untranslated();
 await writeFile('test-results/rv14-untranslated.json',JSON.stringify(missing,null,2));
 assert.deepEqual(missing,[],'RV14 visible text and help must be translated');
 await page.locator('.config-section').screenshot({path:'test-results/rv14-setup.png'});
 await page.locator('.env-unit').first().screenshot({path:'test-results/rv14-environment.png'});
 for(const width of [1600,1440,1280,1024,768,390]) await checkLayout(width);
 await page.locator('.env-unit').first().screenshot({path:'test-results/rv14-environment-mobile.png'});
 await page.locator('#themeToggle').click();
 await checkLayout(390);
 await page.locator('#facilitiesToggle').click();
 await page.waitForSelector('.recipe-table');
 assert.deepEqual(await untranslated('#facilitiesModal'),[],'Recipe reference must be translated');
 const modalOverflow=await page.locator('#facilitiesModal .modal-content').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
 assert.ok(modalOverflow.scroll<=modalOverflow.width+2,JSON.stringify(modalOverflow));
 await page.screenshot({path:'test-results/rv14-recipes-mobile.png'});
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:'test-results/rv14-recipes.png'});
 await page.locator('#facilitiesModal .close-button').click();
 await page.locator('#language-switch').selectOption('en');
 await page.waitForFunction(()=>document.documentElement.lang==='en');
 assert.ok((await page.locator('#facility-plan-container').innerText()).includes('Tidewhisper Sandcastle'));
 await page.locator('#language-switch').selectOption('ru');
 await page.waitForFunction(()=>document.documentElement.lang==='ru');
 assert.deepEqual(await untranslated(),[],'Switching back to RU translates the completed plan');
 await page.reload();
 await page.waitForFunction(()=>document.documentElement.lang==='ru');
 assert.equal(await page.locator('#home-level').inputValue(),'14');
 await page.locator('label:has(#mode-advanced)').click();
 for(const width of [1600,390]) {
  await page.setViewportSize({width,height:1000});
  assert.deepEqual(await untranslated('.modules-grid'),[]);
  const moduleOverflow=await page.locator('.modules-grid').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
  assert.ok(moduleOverflow.scroll<=moduleOverflow.width+2,JSON.stringify(moduleOverflow));
  await page.locator('.modules-grid').screenshot({path:`test-results/rv14-advanced-modules-${width}.png`});
 }
 assert.deepEqual(errors,[]);
 console.log('RV14: calculation, layout, terminology, tooltips, recipes, RU/EN, persistence and six viewport widths passed.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
