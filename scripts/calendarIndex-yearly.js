/*
1. 국가별 기본 지표 가져오기

https://datamall.koscom.co.kr/kor/checkCalendar/view.do?menuNo=200085
경제지표 : 미국, 중국, 일본만 사용함
한달치 쿼리만 작성되고 yyyy, mm 수정해서 해당 월 가져오기


2. FOMC는 그냥 아래 사이트 가서 날짜 수기로 처리
https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm

INSERT INTO stock_calendar (event_type, nation, content, start_date, end_date) VALUES ('index', 'united-states', 'FOMC(Federal Open Market Committee)', '20250506', '20250507');
INSERT INTO stock_calendar (event_type, nation, content, start_date, end_date) VALUES ('index', 'united-states', 'FOMC(Federal Open Market Committee)', '20250617', '20250618');
INSERT INTO stock_calendar (event_type, nation, content, start_date, end_date) VALUES ('index', 'united-states', 'FOMC(Federal Open Market Committee)', '20250729', '20250730');
INSERT INTO stock_calendar (event_type, nation, content, start_date, end_date) VALUES ('index', 'united-states', 'FOMC(Federal Open Market Committee)', '20250916', '20250917');
INSERT INTO stock_calendar (event_type, nation, content, start_date, end_date) VALUES ('index', 'united-states', 'FOMC(Federal Open Market Committee)', '20251028', '20251029');
INSERT INTO stock_calendar (event_type, nation, content, start_date, end_date) VALUES ('index', 'united-states', 'FOMC(Federal Open Market Committee)', '20251209', '20251210');

3. 한국 금리결정 수기로 처리
https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?mtgSe=A&menuNo=200755
INSERT INTO stock_calendar (event_type, nation, content, start_date, end_date) VALUES ('index', 'south-korea', '한국은행 통화정책방향 결정회의(기준금리 결정)', '20250417', '20250417');
INSERT INTO stock_calendar (event_type, nation, content, start_date, end_date) VALUES ('index', 'south-korea', '한국은행 통화정책방향 결정회의(기준금리 결정)', '20250529', '20250529');
INSERT INTO stock_calendar (event_type, nation, content, start_date, end_date) VALUES ('index', 'south-korea', '한국은행 통화정책방향 결정회의(기준금리 결정)', '20250710', '20250710');
INSERT INTO stock_calendar (event_type, nation, content, start_date, end_date) VALUES ('index', 'south-korea', '한국은행 통화정책방향 결정회의(기준금리 결정)', '20250828', '20250828');
INSERT INTO stock_calendar (event_type, nation, content, start_date, end_date) VALUES ('index', 'south-korea', '한국은행 통화정책방향 결정회의(기준금리 결정)', '20251023', '20251023');
INSERT INTO stock_calendar (event_type, nation, content, start_date, end_date) VALUES ('index', 'south-korea', '한국은행 통화정책방향 결정회의(기준금리 결정)', '20251127', '20251127');

*/

const axios = require('axios');
const qs = require('qs');
const { Client } = require('pg');
const readline = require('readline');
require('dotenv').config();

const yyyy = '2025';
const mm = '12';

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

async function fetchCheckCalendar() {
  try {
    await client.connect();

    const url = 'https://checkmall.koscom.co.kr/checkmall/checkCalendar/list.json';

    const payload = {
      disType: 'm',
      eventGroup: "[{ group: 'G101', cls: '002,003,004' }]",
      onDate: `${yyyy}${mm}01`,
      searchWrd: ''
    };

    const formData = qs.stringify(payload);

    const response = await axios.post(url, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    const eventsToInsert = [];

    for (const ev of response.data.eventList) {
      if (!ev.eventContent) continue;

      const eventYyyymmdd = `${yyyy}${ev.eventDate.match(/\d{2}\/\d{2}/)[0].replace(/\//g, '')}`;
      let nation = null;
      if (ev.classNm === '미국') nation = 'united-states';
      else if (ev.classNm === '일본') nation = 'japan';
      else if (ev.classNm === '중국') nation = 'china';

      if (nation) {
        eventsToInsert.push({
          event_type: 'index',
          nation,
          content: ev.eventContent,
          start_date: eventYyyymmdd,
          end_date: eventYyyymmdd
        });
        console.log(`[Preview] ${eventYyyymmdd} | ${nation} | ${ev.eventContent}`);
      }
    }

    if (eventsToInsert.length === 0) {
      console.log('😶 등록할 이벤트가 없습니다.');
      await client.end();
      rl.close();
      return;
    }

    rl.question('\n🔥 위 이벤트들을 DB에 실제로 삽입할까요? (y/N): ', async (answer) => {
      if (answer.trim().toLowerCase() === 'y') {
        const insertQuery = `
          INSERT INTO stock_calendar (event_type, nation, content, start_date, end_date)
          VALUES ($1, $2, $3, $4, $5)
        `;

        for (const ev of eventsToInsert) {
          await client.query(insertQuery, [
            ev.event_type,
            ev.nation,
            ev.content,
            ev.start_date,
            ev.end_date
          ]);
          console.log(`✅ Inserted: ${ev.start_date} | ${ev.nation} | ${ev.content}`);
        }
      } else {
        console.log('삽입 취소됨.');
      }

      await client.end();
      rl.close();
      console.log('🔚 DB connection closed.');
    });

  } catch (error) {
    console.error('❌ Error:', error.message || error);
    await client.end();
    console.log('🔚 DB connection closed.');
    rl.close();
  }
}

fetchCheckCalendar();