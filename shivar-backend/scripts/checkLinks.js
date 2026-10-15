const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '../../shivar-frontend/ecosystem-intelligence-embed.html');
const html = fs.readFileSync(file, 'utf8');

const links = [...new Set(html.match(/https?:\/\/[^\s'"<>)]+/g) || [])].filter(
  (u) => u.length > 12 && !/fonts\.|localhost|w3\.org/.test(u),
);

(async () => {
  for (const url of links) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      console.log(`${res.ok ? 'OK    ' : 'CHECK '} ${res.status}  ${url}`);
    } catch (e) {
      console.log(`FAIL   ---  ${url}  (${e.cause?.code || e.message})`);
    }
  }
})();