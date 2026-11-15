import { open, vale } from './pw.mjs';
process.env.VALE_URL = process.env.VALE_URL;
const { browser, page, logs } = await open('/?dev=1&seed=7', { hmr: false });
await page.waitForTimeout(6000);
console.log(await page.evaluate(() => [...document.querySelectorAll('button,a,[role=button],[role=tab]')].map(e=>`${e.tagName}.${(e.className||'').toString().slice(0,40)}|${(e.textContent||'').trim().slice(0,30)}|${e.getAttribute('aria-label')||''}`).join('\n')));
console.log(await vale(page, v => Object.keys(v).join(',')));
console.log(logs.join('\n'));
await browser.close();
