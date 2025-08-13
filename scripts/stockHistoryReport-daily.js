/**
 * 실행 예:
 * node stockHistoryReport-daily.js
 * node stockHistoryReport-daily.js 2025-01-01 2025-02-28
 */

const puppeteer = require('puppeteer');
const { Client } = require('pg');
const dayjs = require('dayjs');
require('dayjs/plugin/utc');
require('dayjs/plugin/timezone');
require('dayjs/plugin/isSameOrAfter');

dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/timezone'));
dayjs.extend(require('dayjs/plugin/isSameOrAfter'));


require('dotenv').config();

// 날짜 포맷: YYYYMMDD
function formatDateKST(date) {
  return dayjs(date).tz('Asia/Seoul').format('YYYYMMDD');
}

// 인자 처리
const args = process.argv.slice(2);
let startDate, endDate;

if (args.length === 2) {
  startDate = dayjs.tz(args[0], 'Asia/Seoul').startOf('day');
  endDate = dayjs.tz(args[1], 'Asia/Seoul').startOf('day');
} else {
  const today = dayjs().tz('Asia/Seoul').startOf('day');
  startDate = today;
  endDate = today;
}

console.log(`🔍 시작 날짜: ${startDate.format('YYYY-MM-DD')}`);
console.log(`🔍 종료 날짜: ${endDate.format('YYYY-MM-DD')}`);

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

  let currentDate = dayjs(startDate);

  while (currentDate.isSameOrAfter(endDate)) {
    const yyyymmdd = currentDate.format('YYYYMMDD');
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
            code: codeElement?.innerText.match(/\d{6}/g)?.[0] || '',
            title: titleElement ? titleElement.innerText.split('-')[1]?.trim() || '' : '',
            content: content,
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
    currentDate = currentDate.subtract(1, 'day');
  }

  await browser.close();
  await client.end();
  console.log('🧯 전체 크롤링 및 DB 저장 완료. 연결 종료.');
})();