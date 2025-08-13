const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args))
const dayjs = require('dayjs')
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
dayjs.extend(utc);
dayjs.extend(timezone);

const REPO_PATH = path.resolve("..")  // 절대 경로로 변경
const IMAGE_DIR = "logo"
const JSON_DIR = "json"

const LOCAL_IMAGE_DIR = path.join(REPO_PATH, IMAGE_DIR)
const LOCAL_JSON_DIR = path.join(REPO_PATH, JSON_DIR)

// 디렉토리 생성
if (!fs.existsSync(LOCAL_JSON_DIR)) {
    fs.mkdirSync(LOCAL_JSON_DIR, { recursive: true })
}



const yyyymmdd = dayjs().tz('Asia/Seoul').format('YYYYMMDD');
const apiUrls = [
    {
        name: "ETF",
        url: `https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd?bld=dbms/MDC/STAT/standard/MDCSTAT04601&locale=ko_KR&share=1&csvxls_isNo=false&trdDd=${yyyymmdd}`,
        filename: "etf.json"
    },
    {
        name: "KOSPI",
        url: `https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd?bld=dbms/MDC/STAT/standard/MDCSTAT01901&locale=ko_KR&mktId=STK&share=1&csvxls_isNo=false&trdDd=${yyyymmdd}`,
        filename: "kospi.json"
    },
    {
        name: "KOSDAQ",
        url: `https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd?bld=dbms/MDC/STAT/standard/MDCSTAT01901&locale=ko_KR&mktId=KSQ&segTpCd=ALL&share=1&csvxls_isNo=false&trdDd=${yyyymmdd}`,
        filename: "kosdaq.json"
    }
]

// 저장할 디렉토리 생성
if (!fs.existsSync(LOCAL_IMAGE_DIR)) {
    fs.mkdirSync(LOCAL_IMAGE_DIR, { recursive: true })
}
if (!fs.existsSync(LOCAL_JSON_DIR)) {
    fs.mkdirSync(LOCAL_JSON_DIR, { recursive: true })
}

// JSON 저장 함수 개선
const saveJsonToFile = (filename, data) => {
    try {
        if (!data || data.length === 0) {
            console.error(`❌ 저장할 데이터가 없음 (${filename})`)
            return
        }

        const filePath = path.join(LOCAL_JSON_DIR, filename)
        
        // 기존 파일 삭제 후 저장
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath) // 기존 파일 제거
        }

        const jsonData = JSON.stringify(data, null, 2)
        fs.writeFileSync(filePath, jsonData, { encoding: 'utf8' })
        console.log(`✅ JSON 저장 완료 (application/json): ${filePath}`)
    } catch (error) {
        console.error(`❌ JSON 저장 중 오류 발생 (${filename}):`, error)
    }
}

// 이미지 다운로드 함수
const downloadImage = async (url, filename) => {
    try {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.statusText}`)
        }
        const buffer = await response.buffer()
        const filepath = path.join(LOCAL_IMAGE_DIR, filename)
        fs.writeFileSync(filepath, buffer)
        console.log(`🖼️  이미지 다운로드 완료: ${filename}`)
    } catch (error) {
        console.error(`❌ 이미지 다운로드 실패 (${url}):`, error)
    }
}

// Git 변경 사항 커밋 및 푸시 함수
const commitAndPushToGitHub = () => {
    try {
        // 변경 사항 있는지 확인
        const status = execSync(`GIT_SSH_COMMAND='ssh -i /Users/argus/.ssh/jubjub-static' git status --porcelain`, {
            cwd: REPO_PATH
        }).toString().trim()

        if (!status) {
            console.log("🚀 변경 사항이 없어 Git 커밋을 건너뜁니다.")
            return
        }

        execSync(`GIT_SSH_COMMAND='ssh -i /Users/argus/.ssh/jubjub-static' git add .`, {
            cwd: REPO_PATH,
            stdio: 'inherit'
        })

        execSync(`GIT_SSH_COMMAND='ssh -i /Users/argus/.ssh/jubjub-static' git commit -m "${yyyymmdd} updated."`, {
            cwd: REPO_PATH,
            stdio: 'inherit'
        })

        execSync(`GIT_SSH_COMMAND='ssh -i /Users/argus/.ssh/jubjub-static' git push --force origin main`, {
            cwd: REPO_PATH,
            stdio: 'inherit'
        })

        console.log("✅ GitHub에 성공적으로 업로드되었습니다.")
    } catch (error) {
        console.error("❌ GitHub 업로드 중 오류 발생:", error)
    }
}

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

const fetchWithHeaders = (url) => {
    return fetch(url, {
        method: "GET",
        headers: {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/x-www-form-urlencoded",
            "Origin": "https://data.krx.co.kr",
            "Referer": "https://data.krx.co.kr",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/113.0.0.0 Safari/537.36"
        }
    });
};

// API 데이터 가져와서 JSON 저장 및 이미지 다운로드 후 GitHub에 업로드
const fetchAndProcessData = async () => {
    try {
        pullFromGitHub()

        for (const api of apiUrls) {
            console.log(`📡 ${api.name} 데이터 가져오는 중...`);
            const response = await fetchWithHeaders(api.url);
            if (!response.ok) throw new Error(`❌ API 요청 실패 (${api.name}): ${response.statusText}`);

            const jsonData = await response.json();
            const dataArray = jsonData.output || jsonData.OutBlock_1;

            if (!dataArray || !Array.isArray(dataArray)) {
                console.error(`❌ JSON 데이터 형식이 잘못됨 (${api.name})`);
                continue;
            }

            saveJsonToFile(api.filename, dataArray);

            for (const item of dataArray) {
                let imageUrl, filename;

                // toss
                // const imageUrl = `https://static.toss.im/png-icons/securities/icn-sec-fill-${stockCode}.png`;
                //const filename = `${stockCode}.png`;
                
                //naver
                //etf
                // "ISU_ABBRV": "1Q 25-08 회사채(A+이상)액티브" 에서 앞에 잘라서 StockKRETF 뒤에 붙이기 아래처럼,
                //https://ssl.pstatic.net/imgstock/fn/real/logo/etf/StockKRETF1Q.svg
                //stock
                //https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock005930.svg

                if (api.name === 'ETF') {
                    const stockCode = item.ISU_SRT_CD;
                    const abbrev = item.ISU_ABBRV?.split(' ')[0] ?? 'Unknown';
                    imageUrl = `https://ssl.pstatic.net/imgstock/fn/real/logo/etf/StockKRETF${abbrev}.svg`;
                    filename = `${stockCode}.svg`;
                } else {
                    const stockCode = item.ISU_SRT_CD;
                    imageUrl = `https://ssl.pstatic.net/imgstock/fn/real/logo/stock/Stock${stockCode}.svg`;
                    filename = `${stockCode}.svg`;
                }


                await downloadImage(imageUrl, filename);
            }
        }

        

        console.log('📂 모든 JSON 저장 및 이미지 다운로드 완료! GitHub에 업로드 시작...')
        commitAndPushToGitHub()
    } catch (error) {
        console.error('❌ 데이터 가져오기 또는 처리 중 오류 발생:', error)
    }
}

fetchAndProcessData()