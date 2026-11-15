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
const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://cdn.jsdelivr.net/**',r=>r.abort());
const url=`http://127.0.0.1:${server.address().port}/`;
try{
 await page.goto(url);
 await page.waitForFunction(()=>document.getElementById('version').textContent.includes('0.16'));
 await page.locator('#home-level').selectOption('5');
 await page.locator('#language-switch').selectOption('ru');
 await page.waitForFunction(()=>document.documentElement.lang==='ru');
 assert.match(await page.locator('#setup-copy-link').textContent(),/Поделиться/);
 assert.match(await page.locator('#simple-summary-title').textContent(),/Объектов/);
 assert.equal(await page.locator('#home-level').inputValue(),'5');
 await page.locator('#home-level').selectOption('6');
 await page.waitForFunction(()=>document.getElementById('simple-summary-title').textContent.includes('уровень автодома: 6'));
 await page.locator('#language-switch').selectOption('en');
 await page.waitForFunction(()=>document.documentElement.lang==='en');
 assert.equal(await page.locator('#setup-copy-link').textContent(),'Share setup link');
 assert.equal(await page.locator('#home-level').inputValue(),'6');
 await page.locator('#language-switch').selectOption('ru');
 await page.waitForFunction(()=>document.documentElement.lang==='ru');
 await page.reload();
 await page.waitForFunction(()=>document.documentElement.lang==='ru');
 assert.equal(await page.locator('#home-level').inputValue(),'6');
 await page.waitForFunction(()=>document.querySelector('#skip-options option'));
 const russianRecipe=await page.locator('#skip-options option').first().getAttribute('value');
 await page.locator('#skip-input').evaluate((el,value)=>el.value=value,russianRecipe);
 await page.locator('#language-switch').selectOption('en');
 await page.waitForFunction(()=>document.documentElement.lang==='en');
 const englishRecipe=await page.locator('#skip-options option').first().getAttribute('value');
 assert.equal(await page.locator('#skip-input').inputValue(),englishRecipe);
 await page.locator('#language-switch').selectOption('ru');
 await page.waitForFunction(()=>document.documentElement.lang==='ru');
 await page.locator('#home-level').selectOption('2');
 await page.locator('#optimize-btn').click();
 await page.waitForFunction(()=>!document.getElementById('optimize-btn').disabled,{},{timeout:120000});
 const before=await page.locator('#plan-rate').textContent();
 const planBefore=await page.locator('#facility-plan-container').innerHTML();
 assert.ok(planBefore.includes('producing') || planBefore.includes('facility-plan-table') || planBefore.includes('<table'),'calculated plan is present');
 await page.locator('#language-switch').selectOption('en');
 await page.waitForFunction(()=>document.documentElement.lang==='en');
 // The amount is unchanged; the rate's currency and unit now translate too.
 if(before) {
  const after=await page.locator('#plan-rate').textContent();
  assert.equal(after.match(/^[\d.,\s]+/)[0],before.match(/^[\d.,\s]+/)[0]);
  assert.ok(after.includes('Home Coins'));
 }
 await page.locator('#language-switch').selectOption('ru');
 await page.waitForFunction(()=>document.documentElement.lang==='ru');
 await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
 await page.screenshot({path:fileURLToPath(new URL('../test-results/russian-desktop.png',import.meta.url)),fullPage:true});
 const untranslated=await page.evaluate(()=>{const out=new Set();const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);while(w.nextNode()){const n=w.currentNode;if(n.parentElement?.closest('script,style,select,svg,mjx-container'))continue;if(!n.parentElement?.getClientRects().length)continue;const t=n.nodeValue.trim();if(/[a-zA-Z]{3}/.test(t)&&!/[а-яА-Я]/.test(t))out.add(t);}return [...out];});
 await writeFile(new URL('../test-results/untranslated.json',import.meta.url),JSON.stringify(untranslated,null,2));
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:fileURLToPath(new URL('../test-results/russian-mobile.png',import.meta.url)),fullPage:true});
 const overflow=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+2&&getComputedStyle(el).position!=='absolute').slice(0,8).map(el=>({tag:el.tagName,id:el.id,class:el.className,right:el.getBoundingClientRect().right}))}));
 assert.ok(overflow.scroll<=overflow.width+2,`mobile overflow: ${JSON.stringify(overflow)}`);
 assert.deepEqual(errors,[]);
 console.log('RU/EN switching, persistence, dynamic text, calculation and mobile checks passed.');
}finally{await browser.close();await new Promise(r=>server.close(r));}

