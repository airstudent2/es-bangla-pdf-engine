const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const QUESTIONS_DIR = path.join(__dirname, '..', 'questions');
const OUTPUT_DIR = path.join(__dirname, '..', 'output_pdfs');
const HTML_DIR = path.join(__dirname, '..', 'output_html');
const FONTS_DIR = path.join(__dirname, '..', 'fonts');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(HTML_DIR)) fs.mkdirSync(HTML_DIR, { recursive: true });

// Read local TTF fonts and encode as Base64 for 100% offline and standalone rendering
let regularBase64 = '';
let boldBase64 = '';

const regularFontPath = path.join(FONTS_DIR, 'NotoSerifBengali-Regular.ttf');
const boldFontPath = path.join(FONTS_DIR, 'NotoSerifBengali-Bold.ttf');

if (fs.existsSync(regularFontPath)) {
    regularBase64 = fs.readFileSync(regularFontPath).toString('base64');
}
if (fs.existsSync(boldFontPath)) {
    boldBase64 = fs.readFileSync(boldFontPath).toString('base64');
}

function toBengaliNumber(num) {
    const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    return String(num).split('').map(d => bnDigits[parseInt(d, 10)] || d).join('');
}

function parseQuestionFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return null;

    const isEnglish = path.basename(filePath).startsWith('english_');

    let title = lines[0];
    let startIdx = 1;

    if (lines.length > 1 && (
        lines[1].toLowerCase().startsWith('mcq') ||
        lines[1].includes('দ্বাদশ শ্রেণি') ||
        lines[1].includes('Class 12') ||
        lines[1].includes('Semester') ||
        lines[1].includes('সেমিস্টার')
    )) {
        startIdx = 2;
    }

    const questionBlocks = [];
    let currentQ = null;

    const qRegex = /^(?:প্রশ্ন\s*)?([০-৯\d]+)[\.\।\)]\s*(.*)/;
    const optARegex = /^[\(\[]?(?:ক|A)[\)\]\.]\s*(.*)/;
    const optBRegex = /^[\(\[]?(?:খ|B)[\)\]\.]\s*(.*)/;
    const optCRegex = /^[\(\[]?(?:গ|C)[\)\]\.]\s*(.*)/;
    const optDRegex = /^[\(\[]?(?:ঘ|D)[\)\]\.]\s*(.*)/;
    const ansRegex = /^(?:[✓✔]\s*)?(?:সঠিক\s*)?(?:উত্তর|Answer)\s*[:\-\—\s]+\s*(.*)/i;
    const expRegex = /^(?:ব্যাখ্যা|Explanation)\s*[:\-\—\s]+\s*(.*)/i;

    for (let i = startIdx; i < lines.length; i++) {
        const line = lines[i];

        const qMatch = line.match(qRegex);
        if (qMatch && !line.startsWith('(ক)') && !line.startsWith('(খ)') && !line.startsWith('(গ)') && !line.startsWith('(ঘ)') && !line.startsWith('(A)') && !line.startsWith('(B)') && !line.startsWith('(C)') && !line.startsWith('(D)')) {
            if (currentQ && currentQ.optionA && currentQ.answer) {
                questionBlocks.push(currentQ);
            }
            currentQ = {
                number: qMatch[1],
                question: qMatch[2],
                optionA: '',
                optionB: '',
                optionC: '',
                optionD: '',
                answer: '',
                explanation: ''
            };
            continue;
        }

        if (!currentQ) continue;

        const aMatch = line.match(optARegex);
        const bMatch = line.match(optBRegex);
        const cMatch = line.match(optCRegex);
        const dMatch = line.match(optDRegex);
        const ansMatch = line.match(ansRegex);
        const expMatch = line.match(expRegex);

        if (aMatch) {
            currentQ.optionA = aMatch[1].trim();
        } else if (bMatch) {
            currentQ.optionB = bMatch[1].trim();
        } else if (cMatch) {
            currentQ.optionC = cMatch[1].trim();
        } else if (dMatch) {
            currentQ.optionD = dMatch[1].trim();
        } else if (ansMatch) {
            let ansText = ansMatch[1].trim();
            if (!isEnglish) {
                ansText = ansText.replace(/[\(\[]?A[\)\]\.]/g, '(ক)')
                                 .replace(/[\(\[]?B[\)\]\.]/g, '(খ)')
                                 .replace(/[\(\[]?C[\)\]\.]/g, '(গ)')
                                 .replace(/[\(\[]?D[\)\]\.]/g, '(ঘ)');
            }
            currentQ.answer = ansText;
        } else if (expMatch) {
            let exp = expMatch[1].trim();
            if (!exp.startsWith('(')) exp = '(' + exp;
            if (!exp.endsWith(')')) exp = exp + ')';
            currentQ.explanation = exp;
        } else if (!currentQ.optionA) {
            currentQ.question += ' ' + line;
        }
    }

    if (currentQ && currentQ.optionA && currentQ.answer) {
        questionBlocks.push(currentQ);
    }

    return { title, isEnglish, isPyq: false, questions: questionBlocks };
}

function parsePyqJson(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const isEnglish = path.basename(filePath).includes('english');

    const questions = data.questions.map(q => {
        let optA = '', optB = '', optC = '', optD = '';
        if (Array.isArray(q.options) && q.options.length === 4) {
            optA = q.options[0].replace(/^[\(\[]?[A-Dক-ঘ][\)\]\.]\s*/, '').trim();
            optB = q.options[1].replace(/^[\(\[]?[A-Dক-ঘ][\)\]\.]\s*/, '').trim();
            optC = q.options[2].replace(/^[\(\[]?[A-Dক-ঘ][\)\]\.]\s*/, '').trim();
            optD = q.options[3].replace(/^[\(\[]?[A-Dক-ঘ][\)\]\.]\s*/, '').trim();
        }
        return {
            number: q.num || q.number,
            unit: q.unit || '',
            question: q.text,
            optionA: optA,
            optionB: optB,
            optionC: optC,
            optionD: optD,
            answer: q.answer || '',
            explanation: q.explanation || ''
        };
    });

    return {
        title: data.title,
        isEnglish: isEnglish,
        isPyq: true,
        series: data.series || '',
        subject_code: data.subject_code || '',
        booklet_no: data.booklet_no || '',
        code_no: data.code_no || '',
        total_marks: data.total_marks || 40,
        time: data.time || '1 Hour 30 Minutes',
        questions: questions
    };
}

function generateHtml(data) {
    const isEnglish = !!data.isEnglish;
    const isPyq = !!data.isPyq;
    const fontFaceRules = regularBase64 && boldBase64 ? `
        @font-face {
            font-family: 'Noto Serif Bengali';
            src: url('data:font/truetype;charset=utf-8;base64,${regularBase64}') format('truetype');
            font-weight: 400;
            font-style: normal;
        }
        @font-face {
            font-family: 'Noto Serif Bengali';
            src: url('data:font/truetype;charset=utf-8;base64,${boldBase64}') format('truetype');
            font-weight: 700;
            font-style: normal;
        }
    ` : '';

    const questionsHtml = data.questions.map(q => {
        const optALabel = isEnglish || isPyq ? '(A)' : '(ক)';
        const optBLabel = isEnglish || isPyq ? '(B)' : '(খ)';
        const optCLabel = isEnglish || isPyq ? '(C)' : '(গ)';
        const optDLabel = isEnglish || isPyq ? '(D)' : '(ঘ)';
        const ansPrefix = isEnglish ? 'Answer: ' : (isPyq ? 'সঠিক উত্তর: ' : 'উত্তর:- ');

        const formattedQ = (q.question || '').split('\n').map(l => l.trim()).filter(Boolean).join('<br>');
        const isLongOption = [q.optionA, q.optionB, q.optionC, q.optionD].some(o => (o || '').length > 28);
        const gridClass = isLongOption ? 'options-grid single-col' : 'options-grid';

        return `
        <div class="q-card">
            ${q.unit ? `<div class="unit-tag">${q.unit}</div>` : ''}
            <div class="q-title"><span class="q-num">${q.number}.</span> ${formattedQ}</div>
            <div class="${gridClass}">
                <div class="option-item"><span class="opt-label">${optALabel}</span> ${q.optionA}</div>
                <div class="option-item"><span class="opt-label">${optBLabel}</span> ${q.optionB}</div>
                <div class="option-item"><span class="opt-label">${optCLabel}</span> ${q.optionC}</div>
                <div class="option-item"><span class="opt-label">${optDLabel}</span> ${q.optionD}</div>
            </div>
            <div class="q-answer">${ansPrefix}${q.answer}</div>
            ${q.explanation ? `<div class="q-explanation">${q.explanation}</div>` : ''}
        </div>
        `;
    }).join('');

    const headerHtml = isPyq ? `
        <div id="raw-header" class="header-container pyq-header">
            <div class="badge-row">
                <span class="sub-badge">WBCHSE Class 12 • Semester-III 2027</span>
                <span class="status-badge">অফিসিয়াল প্রশ্নপত্র ও নির্ভুল সমাধান</span>
            </div>
            <h1 class="main-title">${data.title}</h1>
            <div class="meta-row">
                ${data.series ? `<span>সিরিজ: <strong>Series ${data.series}</strong></span> • ` : ''}
                ${data.subject_code ? `<span>বিষয় কোড: <strong>${data.subject_code}</strong></span> • ` : ''}
                ${data.booklet_no ? `<span>বুকলেট নং: <strong>${data.booklet_no}</strong></span> • ` : ''}
                <span>পূর্ণমান: <strong>${data.total_marks || 40}</strong></span> • 
                <span>সময়: <strong>${data.time || '1 Hour 30 Minutes'}</strong></span>
            </div>
            <div class="notice-bar">© Es Bangla • শুধুমাত্র ছাত্র-ছাত্রীদের পড়াশোনার সুবিধার্থে প্রস্তুত</div>
        </div>
    ` : `
        <div id="raw-header" class="header-container">
            <h1 class="main-title">${data.title}</h1>
            <div class="notice-bar">© Es Bangla • শুধুমাত্র ছাত্র-ছাত্রীদের সুবিধার জন্য বানানো হয়েছে</div>
        </div>
    `;

    return `<!DOCTYPE html>
<html lang="${isEnglish ? 'en' : 'bn'}">
<head>
    <meta charset="UTF-8">
    <title>${data.title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Serif:ital,wght@0,400;0,600;0,700;1,400&family=Noto+Serif+Bengali:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        ${fontFaceRules}

        @page {
            size: 148mm 210mm; /* A5 Mobile-First Portrait */
            margin: 0;
        }

        *, *::before, *::after {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            margin: 0;
            padding: 0;
            background-color: #FFFFFF;
            font-family: ${isEnglish ? "'Noto Serif', 'Noto Serif Bengali', serif" : "'Noto Serif Bengali', 'Noto Sans Bengali', 'Lohit Bengali', serif"};
            color: #111827;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .pdf-page {
            width: 148mm;
            height: 210mm;
            box-sizing: border-box;
            padding: 10mm 13mm;
            position: relative;
            page-break-after: always;
            break-after: page;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            background-color: #FFFFFF;
        }

        .pdf-page:last-child {
            page-break-after: avoid;
            break-after: avoid;
        }

        .watermark {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-28deg);
            font-family: 'Noto Serif Bengali', serif;
            font-size: 52pt;
            font-weight: 700;
            color: rgba(0, 102, 255, 0.055);
            letter-spacing: 3px;
            pointer-events: none;
            z-index: 0;
            white-space: nowrap;
            user-select: none;
        }

        .header-container {
            text-align: center;
            margin-bottom: 8px;
            padding-bottom: 6px;
            border-bottom: 1.5px solid #0066FF;
            position: relative;
            z-index: 1;
        }

        .badge-row {
            display: flex;
            justify-content: center;
            gap: 8px;
            margin-bottom: 4px;
        }

        .sub-badge {
            display: inline-block;
            background-color: #EFF6FF;
            color: #1D4ED8;
            border: 1px solid #BFDBFE;
            border-radius: 4px;
            padding: 2px 8px;
            font-size: 7.5pt;
            font-weight: 700;
        }

        .status-badge {
            display: inline-block;
            background-color: #ECFDF5;
            color: #059669;
            border: 1px solid #A7F3D0;
            border-radius: 4px;
            padding: 2px 8px;
            font-size: 7.5pt;
            font-weight: 700;
        }

        .main-title {
            font-size: 13pt;
            font-weight: 700;
            color: #0066FF;
            line-height: 1.32;
            text-decoration: underline;
            text-decoration-color: #0066FF;
            text-underline-offset: 3px;
            margin-bottom: 3px;
        }

        .meta-row {
            font-size: 8.5pt;
            color: #475569;
            margin-top: 3px;
            margin-bottom: 2px;
        }

        .meta-row strong {
            color: #0F172A;
        }

        .notice-bar {
            font-size: 8pt;
            font-weight: 600;
            color: #64748B;
            letter-spacing: 0.2px;
            text-align: center;
            margin-top: 4px;
        }

        .page-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            position: relative;
            z-index: 1;
            min-height: 0;
        }

        .pdf-page.last-page .page-content {
            justify-content: flex-start;
            gap: 12px;
        }

        .q-card {
            position: relative;
            z-index: 1;
            padding-bottom: 2px;
        }

        .q-card.last-card {
            padding-bottom: 0;
        }

        .unit-tag {
            font-size: 8pt;
            font-weight: 700;
            color: #2563EB;
            margin-bottom: 2px;
            text-transform: uppercase;
        }

        .q-title {
            font-size: 10.8pt;
            font-weight: 400;
            color: #111827;
            line-height: 1.4;
            margin-bottom: 3px;
        }

        .q-num {
            font-weight: 700;
            color: #111827;
            margin-right: 3px;
        }

        .options-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            column-gap: 12px;
            row-gap: 3px;
            margin-bottom: 3px;
            padding-left: 1px;
        }

        .options-grid.single-col {
            grid-template-columns: 1fr;
            row-gap: 3px;
        }

        .option-item {
            font-size: 9.8pt;
            font-weight: 400;
            color: #1F2937;
            line-height: 1.35;
        }

        .opt-label {
            font-weight: 600;
            color: #374151;
            margin-right: 3px;
        }

        .q-answer {
            font-size: 10.2pt;
            font-weight: 700;
            color: #0066FF;
            margin-top: 2px;
            padding-left: 1px;
            line-height: 1.32;
        }

        .q-explanation {
            font-family: 'Noto Serif Bengali', serif;
            font-size: 9.3pt;
            font-weight: 400;
            color: #475569;
            line-height: 1.35;
            margin-top: 2px;
            padding-left: 1px;
        }

        #measure-container {
            width: 122mm;
            margin: 0 auto;
        }

        @media screen {
            body {
                background-color: #F1F5F9;
                padding: 20px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 20px;
            }
            .pdf-page {
                box-shadow: 0 4px 20px rgba(0,0,0,0.1);
                border-radius: 6px;
            }
        }
    </style>
</head>
<body>
    <div id="measure-container">
        ${headerHtml}
        <div id="raw-questions">
            ${questionsHtml}
        </div>
    </div>
    <div id="paged-output"></div>
</body>
</html>`;
}

async function main() {
    const txtFiles = fs.readdirSync(QUESTIONS_DIR).filter(f => f.endsWith('.txt'));
    const jsonFiles = fs.readdirSync(QUESTIONS_DIR).filter(f => f.startsWith('pyq_') && f.endsWith('.json'));

    const allTasks = [];

    // Add TXT files
    for (const f of txtFiles) {
        allTasks.push({
            type: 'txt',
            filePath: path.join(QUESTIONS_DIR, f),
            baseName: path.basename(f, '.txt')
        });
    }

    // Add PYQ JSON files
    for (const f of jsonFiles) {
        allTasks.push({
            type: 'json',
            filePath: path.join(QUESTIONS_DIR, f),
            baseName: path.basename(f, '.json').replace('_extracted', '')
        });
    }

    console.log(`Found ${allTasks.length} tasks to process (${txtFiles.length} notes + ${jsonFiles.length} PYQs).`);

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--font-render-hinting=none',
            '--enable-font-antialiasing'
        ]
    });

    for (const task of allTasks) {
        let data = null;
        if (task.type === 'txt') {
            data = parseQuestionFile(task.filePath);
        } else {
            data = parsePyqJson(task.filePath);
        }

        if (!data || data.questions.length === 0) {
            console.log(`Skipping ${task.baseName} (no questions).`);
            continue;
        }

        console.log(`Processing ${task.baseName} (${data.questions.length} questions)...`);

        const htmlContent = generateHtml(data);
        const page = await browser.newPage();

        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        await page.evaluateHandle('document.fonts.ready');

        const stats = await page.evaluate(() => {
            const cal = document.createElement('div');
            cal.style.height = '1mm';
            document.body.appendChild(cal);
            const pxPerMm = cal.getBoundingClientRect().height;
            cal.remove();

            const printableHeightPx = 190 * pxPerMm;
            const headerEl = document.getElementById('raw-header');
            const headerHeightPx = headerEl ? headerEl.offsetHeight : 0;
            const page1TargetPx = printableHeightPx - headerHeightPx - (4 * pxPerMm);

            const rawCards = Array.from(document.querySelectorAll('#raw-questions .q-card'));
            const pages = [];
            let curPage = [];
            let curH = 0;
            const minGap = 8;

            for (let i = 0; i < rawCards.length; i++) {
                const card = rawCards[i];
                const h = card.offsetHeight;
                const target = pages.length === 0 ? page1TargetPx : printableHeightPx;
                const needed = curPage.length === 0 ? h : (h + minGap);

                if (curH + needed <= target) {
                    curPage.push(card);
                    curH += needed;
                } else {
                    if (curPage.length === 0) {
                        curPage.push(card);
                        pages.push(curPage);
                        curPage = [];
                        curH = 0;
                    } else {
                        pages.push(curPage);
                        curPage = [card];
                        curH = h;
                    }
                }
            }
            if (curPage.length > 0) pages.push(curPage);

            const pagedOutput = document.getElementById('paged-output');
            pagedOutput.innerHTML = '';

            pages.forEach((pageCards, pIdx) => {
                const isFirst = (pIdx === 0);
                const isLast = (pIdx === pages.length - 1);

                const pageDiv = document.createElement('div');
                pageDiv.className = 'pdf-page' + (isLast ? ' last-page' : '');

                const wm = document.createElement('div');
                wm.className = 'watermark';
                wm.textContent = 'Es Bangla';
                pageDiv.appendChild(wm);

                if (isFirst && headerEl) {
                    pageDiv.appendChild(headerEl.cloneNode(true));
                }

                const contentDiv = document.createElement('div');
                contentDiv.className = 'page-content';

                pageCards.forEach((c, cIdx) => {
                    const clone = c.cloneNode(true);
                    if (cIdx === pageCards.length - 1) {
                        clone.classList.add('last-card');
                    }
                    contentDiv.appendChild(clone);
                });

                pageDiv.appendChild(contentDiv);
                pagedOutput.appendChild(pageDiv);
            });

            document.getElementById('measure-container').remove();
            return { totalPages: pages.length, counts: pages.map(p => p.length) };
        });

        console.log(`Packed ${data.questions.length} questions into ${stats.totalPages} pages.`);

        const finalHtml = await page.content();
        fs.writeFileSync(path.join(HTML_DIR, `${task.baseName}.html`), finalHtml, 'utf8');

        const pdfPath = path.join(OUTPUT_DIR, `${task.baseName}.pdf`);
        await page.pdf({
            path: pdfPath,
            format: 'A5',
            printBackground: true,
            displayHeaderFooter: false,
            preferCSSPageSize: true,
            tagged: false,
            margin: { top: '0mm', bottom: '0mm', left: '0mm', right: '0mm' }
        });

        console.log(`Generated: ${pdfPath}`);
        await page.close();
    }

    await browser.close();
    console.log('All PDFs generated successfully!');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
