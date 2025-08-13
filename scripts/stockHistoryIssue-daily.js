const puppeteer = require('puppeteer');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

require('dotenv').config();


const toDateNumber = (dateStr) => parseInt(dateStr, 10);


const getTodayYyyymmdd = () => dayjs().tz('Asia/Seoul').format('YYYYMMDD');

const args = process.argv.slice(2);
const start_yyyymmdd = args[0] || getTodayYyyymmdd();
const end_yyyymmdd = args[1] || getTodayYyyymmdd();
const maxPages = 5;

console.log(`🔍 시작일: ${start_yyyymmdd}`);
console.log(`🔍 종료일: ${end_yyyymmdd}`);

const client = new Client({
  host: process.env.PG_HOST,
  port: Number(process.env.PG_PORT),
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

const REPO_PATH = path.resolve(__dirname, '..');
const NAVER_FINANCE_DIR = path.join(REPO_PATH, 'naver-finance');

// Git 원격 저장소 최신 상태로 업데이트 (git pull)
const pullFromGitHub = () => {
    try {
        console.log("🔄 GitHub에서 최신 변경 사항 가져오는 중...")
        
        execSync(`GIT_SSH_COMMAND='ssh -i /Users/argus/.ssh/jubjub-static' git pull --rebase origin main`, {
            cwd: REPO_PATH,
            stdio: 'inherit'
        })

        console.log("✅ 최신 상태로 업데이트 완료.")
    } catch (error) {
        console.error("❌ GitHub pull 중 오류 발생:", error)
    }
}

const commitAndPush = () => {
  try {
    console.log('📡 Git 변경 사항 확인 중...');
    const status = execSync(`GIT_SSH_COMMAND='ssh -i /Users/argus/.ssh/jubjub-static' git status --porcelain`, {
            cwd: REPO_PATH
        }).toString().trim()

    if (!status) {
      console.log('🚀 변경 사항 없음. Git 커밋 생략.');
      return;
    }

    execSync(`GIT_SSH_COMMAND='ssh -i /Users/argus/.ssh/jubjub-static' git add .`, {
        cwd: REPO_PATH,
        stdio: 'inherit'
    })

    execSync(`GIT_SSH_COMMAND='ssh -i /Users/argus/.ssh/jubjub-static' git commit -m "${start_yyyymmdd} updated."`, {
        cwd: REPO_PATH,
        stdio: 'inherit'
    })

    execSync(`GIT_SSH_COMMAND='ssh -i /Users/argus/.ssh/jubjub-static' git push --force origin main`, {
        cwd: REPO_PATH,
        stdio: 'inherit'
    })

    console.log('✅ GitHub 푸시 완료!');
  } catch (error) {
    console.error('❌ GitHub 푸시 중 오류:', error);
  }
};

(async () => {
  pullFromGitHub()
  
  const summaryPattern = '증시요약\\([4-5]\\)';
  const collectedArticles = [];

  await client.connect();
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
          const codeCell = row.querySelector('td[rowspan="2"] b');

          if (codeCell) {
            const codeText = codeCell.innerText;
            const match = codeText.match(/\((\d{6})\)/);
            const rateMatch = codeText.match(/\([+-][\d.]+%\)/);
            const isPositive = rateMatch?.[0]?.includes('+');

            if (!isPositive) continue;

            const code = match ? match[1] : null;
            const titleCell = row.querySelectorAll('td')[1];
            const title = titleCell ? titleCell.innerText.trim() : '';

            const nextRow = rows[i + 1];
            const contentCell = nextRow ? nextRow.querySelector('td') : null;
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
      console.log(`🧾 등락률 + 종목 (${articles.length}개):`);

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
            await client.query(insertQuery, values);
            console.log('✅ 저장 완료');
          } catch (err) {
            console.error(`❌ 저장 실패 - ${err.message}`);
          }

          collectedArticles.push({
            code: item.code,
            content: item.content
          });

          console.log('---------------------------------------------');
        }
      }
    }
  }

  // JSON 저장
  if (!fs.existsSync(NAVER_FINANCE_DIR)) {
    fs.mkdirSync(NAVER_FINANCE_DIR, { recursive: true });
  }

  const outputFilePath = path.join(NAVER_FINANCE_DIR, `${start_yyyymmdd}.json`);
  fs.writeFileSync(outputFilePath, JSON.stringify(collectedArticles, null, 2), 'utf-8');
  console.log(`📁 JSON 파일 저장 완료: ${outputFilePath}`);

  await browser.close();
  await client.end();
  console.log('🧯 크롤링 및 DB 저장 완료. 연결 종료.');

  // GitHub에 푸시
  commitAndPush();
})();