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
    let subtitle = '';
    let startIdx = 1;

    if (lines.length > 1 && (
        lines[1].toLowerCase().startsWith('mcq') ||
        lines[1].includes('দ্বাদশ শ্রেণি') ||
        lines[1].includes('Class 12') ||
        lines[1].includes('Semester')
    )) {
        subtitle = lines[1];
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

    return { title, subtitle, isEnglish, questions: questionBlocks };
}

function generateHtml(data) {
    const isEnglish = !!data.isEnglish;
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
        const optALabel = isEnglish ? '(A)' : '(ক)';
        const optBLabel = isEnglish ? '(B)' : '(খ)';
        const optCLabel = isEnglish ? '(C)' : '(গ)';
        const optDLabel = isEnglish ? '(D)' : '(ঘ)';
        const ansPrefix = isEnglish ? 'Answer: ' : 'উত্তর:- ';

        return `
        <div class="q-card">
            <div class="q-title"><span class="q-num">${q.number}.</span> ${q.question}</div>
            <div class="options-grid">
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

        /* Dedicated A5 Page Container */
        .pdf-page {
            width: 148mm;
            height: 210mm;
            box-sizing: border-box;
            padding: 10mm 13mm; /* 13mm safe left/right margin, 10mm top/bottom */
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

        /* Diagonal Aesthetic Watermark - on EVERY page */
        .watermark {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-28deg);
            font-family: 'Noto Serif Bengali', serif;
            font-size: 52pt;
            font-weight: 700;
            color: rgba(0, 102, 255, 0.055); /* Elegant, subtle 5.5% opacity */
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

        .main-title {
            font-size: 14pt;
            font-weight: 700;
            color: #0066FF;
            line-height: 1.32;
            text-decoration: underline;
            text-decoration-color: #0066FF;
            text-underline-offset: 3px;
            margin-bottom: 3px;
        }

        .subtitle-wrap {
            text-align: left;
            margin-bottom: 4px;
        }

        .subtitle-badge {
            display: inline-block;
            font-size: 10pt;
            font-weight: 700;
            color: #0066FF;
            background: rgba(0, 102, 255, 0.08);
            padding: 2px 8px;
            border-radius: 4px;
        }

        .notice-bar {
            font-size: 8pt;
            font-weight: 600;
            color: #64748B;
            letter-spacing: 0.2px;
            text-align: center;
            margin-top: 4px;
        }

        /* Flex container that naturally spans the full page height */
        .page-content {
            flex: 1;
            display: flex;
            flex-direction: column;
            justify-content: space-between; /* Fills the page completely from top to bottom */
            position: relative;
            z-index: 1;
            min-height: 0;
        }

        /* Last page does not stretch unnaturally if only 1-2 questions remain */
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

        .q-title {
            font-size: 10.8pt;
            font-weight: 400; /* Regular per user rule */
            color: #111827; /* Jet Black */
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

        .option-item {
            font-size: 9.8pt;
            font-weight: 400; /* Regular per user rule */
            color: #1F2937; /* Jet Black */
            line-height: 1.35;
        }

        .opt-label {
            font-weight: 600;
            color: #374151;
            margin-right: 3px;
        }

        .q-answer {
            font-size: 10.2pt;
            font-weight: 700; /* Bold per user rule */
            color: #0066FF; /* Royal Blue */
            margin-top: 2px;
            padding-left: 1px;
            line-height: 1.32;
        }

        .q-explanation {
            font-family: 'Noto Serif Bengali', serif;
            font-size: 9.3pt;
            font-weight: 400; /* Regular Bengali font per user rule */
            color: #475569; /* Slate grey */
            line-height: 1.35;
            margin-top: 2px;
            padding-left: 1px;
        }

        /* Measurement stage styles */
        #measure-container {
            width: 122mm; /* Exactly 148mm - 26mm padding */
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
        <div id="raw-header" class="header-container">
            <h1 class="main-title">${data.title}</h1>
            ${data.subtitle ? `<div class="subtitle-wrap"><span class="subtitle-badge">${data.subtitle}</span></div>` : ''}
            <div class="notice-bar">© Es Bangla • শুধুমাত্র ছাত্র-ছাত্রীদের সুবিধার জন্য বানানো হয়েছে</div>
        </div>

        <div id="raw-questions">
            ${questionsHtml}
        </div>
    </div>

    <div id="paged-output"></div>
</body>
</html>`;
}

async function main() {
    const files = fs.readdirSync(QUESTIONS_DIR).filter(f => f.endsWith('.txt'));
    console.log(`Found ${files.length} question files to process.`);

    if (files.length === 0) {
        console.log('No txt files in questions/ directory.');
        return;
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--font-render-hinting=none',
            '--enable-font-antialiasing'
        ]
    });

    for (const file of files) {
        const fullPath = path.join(QUESTIONS_DIR, file);
        const data = parseQuestionFile(fullPath);
        if (!data || data.questions.length === 0) {
            console.log(`Skipping ${file} (no questions parsed).`);
            continue;
        }

        console.log(`Parsed ${data.questions.length} questions from ${file}`);

        const htmlContent = generateHtml(data);
        const baseName = path.basename(file, '.txt');
        const page = await browser.newPage();

        // Load the HTML and wait for fonts
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        await page.evaluateHandle('document.fonts.ready');

        // Execute dynamic optimal page distribution
        const stats = await page.evaluate(() => {
            const cal = document.createElement('div');
            cal.style.height = '1mm';
            document.body.appendChild(cal);
            const pxPerMm = cal.getBoundingClientRect().height;
            cal.remove();

            // Printable area for A5 (210mm x 148mm) with 10mm top/bottom padding: 190mm
            const printableHeightPx = 190 * pxPerMm;

            const headerEl = document.getElementById('raw-header');
            const headerHeightPx = headerEl ? headerEl.offsetHeight : 0;
            // Page 1 available height for questions (subtracting header and small margin)
            const page1TargetPx = printableHeightPx - headerHeightPx - (4 * pxPerMm);

            const rawCards = Array.from(document.querySelectorAll('#raw-questions .q-card'));

            // Greedy optimal packing
            const pages = [];
            let curPage = [];
            let curH = 0;
            const minGap = 8; // min gap in px

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
            if (curPage.length > 0) {
                pages.push(curPage);
            }

            // Build final paged DOM
            const pagedOutput = document.getElementById('paged-output');
            pagedOutput.innerHTML = '';

            pages.forEach((pageCards, pIdx) => {
                const isFirst = (pIdx === 0);
                const isLast = (pIdx === pages.length - 1);

                const pageDiv = document.createElement('div');
                pageDiv.className = 'pdf-page' + (isLast ? ' last-page' : '');

                // Watermark on every page
                const wm = document.createElement('div');
                wm.className = 'watermark';
                wm.textContent = 'Es Bangla';
                pageDiv.appendChild(wm);

                // Header on page 1 only
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

            // Remove measurement container
            document.getElementById('measure-container').remove();

            return {
                totalPages: pages.length,
                counts: pages.map(p => p.length)
            };
        });

        console.log(`Packed ${data.questions.length} questions into ${stats.totalPages} pages. First 10 page counts:`, stats.counts.slice(0, 10));

        // Save final paged HTML preview
        const finalHtml = await page.content();
        const htmlPath = path.join(HTML_DIR, `${baseName}.html`);
        fs.writeFileSync(htmlPath, finalHtml, 'utf8');

        // Generate PDF with exact A5 dimensions and 0 margin (since padding is in .pdf-page)
        const pdfPath = path.join(OUTPUT_DIR, `${baseName}.pdf`);
        await page.pdf({
            path: pdfPath,
            format: 'A5',
            printBackground: true,
            displayHeaderFooter: false,
            preferCSSPageSize: true,
            margin: {
                top: '0mm',
                bottom: '0mm',
                left: '0mm',
                right: '0mm'
            }
        });

        console.log(`Generated PDF: ${pdfPath}`);
        await page.close();
    }

    await browser.close();
    console.log('All PDFs generated successfully!');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

