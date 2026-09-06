const { chromium } = require("playwright");
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  const errors=[]; page.on("pageerror",e=>errors.push(e.message)); page.on("console",m=>{if(m.type()==="error")errors.push(m.text())});
  await page.goto("http://127.0.0.1:3081/admin/creators",{waitUntil:"networkidle"});
  await page.waitForTimeout(500);
  const admin={status:await page.title(),logSections:await page.locator("section[data-api-logs]").count(),navLinks:await page.locator("#railNav a").count()};
  await page.goto("http://127.0.0.1:3081/ops/creators",{waitUntil:"networkidle"});
  await page.waitForTimeout(500);
  const evalPage={url:page.url(),title:await page.title(),newCaseButton:await page.locator("#newCase").count(),caseCards:await page.locator(".case-card").count(),viewText:(await page.locator("#view").innerText()).slice(0,120)};
  evalPage.tail=(await page.locator("#view").innerHTML()).slice(-1000);evalPage.buttons=await page.locator("#view button").evaluateAll(bs=>bs.map(b=>({id:b.id,text:b.textContent})).slice(-8));if(await page.locator("#newCase").count()){await page.locator("#newCase").click();await page.waitForTimeout(100);evalPage.form=await page.locator("#enhancedCaseForm").count();}
  console.log(JSON.stringify({admin,evalPage,errors},null,2));
  await browser.close();
  process.exit(errors.length?1:0);
})().catch(e=>{console.error(e);process.exit(1)});