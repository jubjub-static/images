const puppeteer = require('puppeteer');
const { Client } = require('pg');
require('dotenv').config();

// 날짜 문자열을 비교 가능한 숫자로 변환
const toDateNumber = (dateStr) => parseInt(dateStr, 10);

// 조회 기간 설정
const start_yyyymmdd = '20250324';
const end_yyyymmdd = '20250324';
const maxPages = 100;

const client = new Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

(async () => {
  const summaryPattern = '증시요약\\([6]\\)';

  // await client.connect();
  console.log('🛢️ DB 연결 완료');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
    const url = `https://stock.mk.co.kr/news/media/infostock?page=${pageNum}`;
    console.log(`📄 페이지 ${pageNum} 접속 중...`);

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const summaryLinks = await page.evaluate((patternStr) => {
      const pattern = new RegExp(patternStr);
      const rows = document.querySelectorAll('table tr');
      let links = [];

      rows.forEach(row => {
        const linkElement = row.querySelector('a');
        if (linkElement && pattern.test(linkElement.textContent)) {
          links.push({
            title: linkElement.innerText.trim(),
            link: linkElement.href
          });
        }
      });

      return links;
    }, summaryPattern);

    if (summaryLinks.length === 0) {
      console.log(`⚠️ 페이지 ${pageNum}에 증시요약이 없습니다.`);
      continue;
    }

    for (const row of summaryLinks) {
      await page.goto(row.link, { waitUntil: 'networkidle2' });

      const timeInfo = await page.evaluate(() => {
        const el = document.querySelector('.time_info span');
        return el ? el.innerText.trim() : '시간 정보 없음';
      });

      const formattedDate = timeInfo.match(/\d{4}\.\d{2}\.\d{2}/)?.[0]?.replace(/\./g, '') || '날짜없음';
      const dateNum = toDateNumber(formattedDate);
      const startNum = toDateNumber(start_yyyymmdd);
      const endNum = toDateNumber(end_yyyymmdd);

      if (dateNum < startNum || dateNum > endNum) {
        console.log(`⏩ ${formattedDate}는 지정된 기간(${start_yyyymmdd} ~ ${end_yyyymmdd}) 외입니다. 건너뜀.`);
        continue;
      }

      const articles = await page.evaluate(() => {
        const rows = document.querySelectorAll('.tbl tr');
        const results = [];

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const codeCell = row.querySelector('td b');

          if (codeCell) {
            const codeText = codeCell.innerText;
            const match = codeText.match(/\((\d{6})\)/);
            const code = match ? match[1] : null;

            const titleCell = row.querySelectorAll('td')[1];
            const title = titleCell ? titleCell.innerText.trim() : '';

            const contentCell = row.querySelector('td');
            const contentRaw = contentCell ? contentCell.innerText.trim() : '';
            const content = contentRaw.split('▷')[1]?.trim().replace(/\.$/, '') || contentRaw.replace(/\.$/, '');

            if (code) {
              results.push({
                code,
                codeText,
                title,
                content
              });
            }
          }
        }

        return results;
      });

      console.log(`🕒 기사 작성 날짜: ${formattedDate}`);
      console.log(`🧾 기사 항목 (${articles.length}개):`);

      if (articles.length > 0) {
        const insertQuery = `
          INSERT INTO stock_history (type, title, content, date, code)
          VALUES ($1, $2, $3, $4, $5)
        `;

        for (const item of articles) {
          console.log(`📌 종목: ${item.codeText}`);
          console.log(`📝 제목: ${item.title}`);
          console.log(`📄 내용: ${item.content}`);

          const values = [
            'issue',
            item.title,
            item.content,
            formattedDate,
            item.code
          ];

          try {
            // await client.query(insertQuery, values);
            console.log('✅ 저장 완료');
          } catch (err) {
            console.error(`❌ 저장 실패 - ${err.message}`);
          }

          console.log('---------------------------------------------');
        }
      }
    }
  }

  await browser.close();
  // await client.end();
  console.log('🧯 크롤링 및 DB 저장 완료. 연결 종료.');
})();