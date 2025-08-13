const axios = require('axios');
const cheerio = require('cheerio');
const { Client } = require('pg');
const readline = require('readline');
require('dotenv').config();

const client = new Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});


const end_yyyymmdd = '20250321';
const start_yyyymmdd = '20241101';


function isWithinRange(dateStr) {
  return dateStr >= start_yyyymmdd && dateStr <= end_yyyymmdd;
}

async function fetchNewsInRange() {
  try {
    await client.connect();

    let page = 1;
    let totalMatched = 0;

    while (true) {
      const url = `https://www.etoday.co.kr/news/section/subsection?MID=1202&page=${page}`;
      console.log(`📄 페이지 ${page} 수집 중...`);

      const { data } = await axios.get(url);
      const $ = cheerio.load(data);

      const items = $('.sp_newslist');
      if (items.length === 0) {
        console.log('✅ 더 이상 뉴스 항목이 없습니다. 종료.');
        break;
      }

      let pageMatched = 0;

      items.each((i, el) => {
        const dateTextRaw = $(el).find('.cluster_text_press21').text().trim(); // ex: '2025-03-21 15:10'
        const summaryText = $(el).find('.t_reduce').text().trim();

        const dateOnly = dateTextRaw.split(' ')[0]; // '2025-03-21'
        const compactDate = dateOnly.replace(/-/g, ''); // '20250321'

        if (isWithinRange(compactDate)) {
          console.log(`📰 [${compactDate}] ${summaryText}`);
          pageMatched++;
        }
      });

      totalMatched += pageMatched;

      // 다음 페이지로
      page++;
    }

    if (totalMatched === 0) {
      console.log(`😶 ${start_yyyymmdd} ~ ${end_yyyymmdd} 범위 내 뉴스 없음.`);
    }

    await client.end();
    rl.close();
    console.log('🔚 DB connection closed.');
  } catch (error) {
    console.error('❌ Error:', error.message || error);
    await client.end();
    rl.close();
  }
}

fetchNewsInRange();