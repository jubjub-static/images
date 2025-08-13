const puppeteer = require('puppeteer');
const { Client } = require('pg');
require('dotenv').config();

// 날짜 포맷을 yyyymmdd로 바꾸는 헬퍼 함수
function formatDate(date) {
  return date.toISOString().split('T')[0].replace(/-/g, '');
}

// 시작일과 종료일 설정
// 뒷날짜부터 역순으로 돌리니 뒷날짜가 startDate로 설정해야 함.
const startDate = new Date('2025-04-01'); 
const endDate = new Date('2025-04-01');

const client = new Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

(async () => {
  await client.connect();
  console.log('🛢️ DB 연결 완료');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let currentDate = startDate;

  while (currentDate >= endDate) {
    const yyyymmdd = formatDate(currentDate);
    console.log(`📆 처리 중 날짜: ${yyyymmdd}`);

    const page = await browser.newPage();
    const url = `https://comp.fnguide.com/SVO2/asp/SVD_Report_Summary_Data.asp?fr_dt=${yyyymmdd}&to_dt=${yyyymmdd}&stext=&check=all`;

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 0 });
      page.on('console', msg => console.log('📢 브라우저 로그:', msg.text()));

      const articles = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('dl.um_tdinsm'));
        return rows.map(row => {
          const codeElement = row.querySelector('dt a .txt1');
          const codeTextElement = row.querySelector('dt a');
          const titleElement = row.querySelector('dt .txt2');
          const contentElements = row.querySelectorAll('dd');

          let sibling = row.nextElementSibling;
          let spanCount = 0;
          let thirdSpanText = '';
          let content = Array.from(contentElements).map(el => el.innerText.trim().replace(/\.$/, '')).join('\n');
          let date = '';

          while (sibling) {
            if (sibling.tagName === 'SPAN') {
              spanCount++;
              if (spanCount === 3) {
                thirdSpanText = sibling.innerText;
                break;
              }
            }
            sibling = sibling.nextElementSibling;
          }
          content += `\n\n${thirdSpanText.split(/\s/).join(" / ")}`;

          return {
            date: date,
            codeText: codeTextElement 
              ? Array.from(codeTextElement.childNodes)
                  .filter(node => node.nodeType === 3)
                  .map(node => node.textContent.trim())
                  .join(' ')
              : '',
            code: codeElement.innerText.match(/\d{6}/g)[0],
            title: titleElement ? titleElement.innerText.split('-')[1]?.trim() || '' : '',
            content: content,
            date: date,
          };
        }).filter(item => item.title !== '');
      });

      if (articles.length > 0) {
        const insertQuery = `
          INSERT INTO stock_history (type, title, content, date, code)
          VALUES ($1, $2, $3, $4, $5)
        `;

        for (const item of articles) {
          console.log(`📌 종목: ${item.codeText}`);
          console.log(`📌 코드: ${item.code}`);
          console.log(`📝 제목: ${item.title}`);
          console.log(`📄 내용: ${item.content}`);

          const values = [
            'report',
            item.title,
            item.content,
            yyyymmdd,
            item.code
          ];

          try {
            await client.query(insertQuery, values);
            console.log('✅ 저장 완료');
          } catch (err) {
            console.error(`❌ 저장 실패 - ${err.message}`);
          }
        }
      } else {
        console.log('⚠️ 해당 날짜에 데이터 없음');
      }

      await page.close();

    } catch (error) {
      console.error(`🚨 ${yyyymmdd} 처리 중 오류 발생:`, error.message);
    }

    // 하루 감소
    currentDate.setDate(currentDate.getDate() - 1);
  }

  await browser.close();
  await client.end();
  console.log('🧯 전체 크롤링 및 DB 저장 완료. 연결 종료.');
})();