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

    let title = lines[0];
    let subtitle = '';
    let startIdx = 1;

    if (lines.length > 1 && (lines[1].toLowerCase().startsWith('mcq') || lines[1].includes('দ্বাদশ শ্রেণি'))) {
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
    const ansRegex = /^(?:[✓✔]\s*)?(?:সঠিক\s*)?উত্তর\s*[:\-\—\s]+\s*(.*)/;

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
                answer: ''
            };
            continue;
        }

        if (!currentQ) continue;

        const aMatch = line.match(optARegex);
        const bMatch = line.match(optBRegex);
        const cMatch = line.match(optCRegex);
        const dMatch = line.match(optDRegex);
        const ansMatch = line.match(ansRegex);

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
            ansText = ansText.replace(/[\(\[]?A[\)\]\.]/g, '(ক)')
                             .replace(/[\(\[]?B[\)\]\.]/g, '(খ)')
                             .replace(/[\(\[]?C[\)\]\.]/g, '(গ)')
                             .replace(/[\(\[]?D[\)\]\.]/g, '(ঘ)');
            currentQ.answer = ansText;
        } else if (!currentQ.optionA) {
            currentQ.question += ' ' + line;
        }
    }

    if (currentQ && currentQ.optionA && currentQ.answer) {
        questionBlocks.push(currentQ);
    }

    return { title, subtitle, questions: questionBlocks };
}

function generateHtml(data) {
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

    const questionsHtml = data.questions.map(q => `
        <div class="q-card">
            <div class="q-title"><span class="q-num">${q.number}.</span> ${q.question}</div>
            <div class="options-grid">
                <div class="option-item"><span class="opt-label">(ক)</span> ${q.optionA}</div>
                <div class="option-item"><span class="opt-label">(খ)</span> ${q.optionB}</div>
                <div class="option-item"><span class="opt-label">(গ)</span> ${q.optionC}</div>
                <div class="option-item"><span class="opt-label">(ঘ)</span> ${q.optionD}</div>
            </div>
            <div class="q-answer">উত্তর:- ${q.answer}</div>
        </div>
    `).join('');

    return `<!DOCTYPE html>
<html lang="bn">
<head>
    <meta charset="UTF-8">
    <title>${data.title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+Bengali:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        ${fontFaceRules}

        @page {
            size: 148mm 210mm; /* A5 Mobile-First Portrait */
            margin: 12mm 14mm 12mm 14mm; /* Guaranteed 14mm safe margins prevent text cutoff */
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
            font-family: 'Noto Serif Bengali', 'Noto Sans Bengali', 'Lohit Bengali', serif;
            color: #111827;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        /* Fixed Aesthetic Watermark - Automatically repeats on EVERY printed page */
        .watermark {
            position: fixed;
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
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1.5px solid #0066FF;
            position: relative;
            z-index: 1;
        }

        .main-title {
            font-size: 15.5pt;
            font-weight: 700;
            color: #0066FF;
            line-height: 1.35;
            text-decoration: underline;
            text-decoration-color: #0066FF;
            text-underline-offset: 4px;
            margin-bottom: 4px;
        }

        .subtitle-wrap {
            text-align: left;
            margin-bottom: 6px;
        }

        .subtitle-badge {
            display: inline-block;
            font-size: 10.5pt;
            font-weight: 700;
            color: #0066FF;
            background: rgba(0, 102, 255, 0.08);
            padding: 2px 9px;
            border-radius: 4px;
        }

        .notice-bar {
            font-size: 8pt;
            font-weight: 600;
            color: #64748B;
            letter-spacing: 0.2px;
            text-align: center;
            margin-top: 5px;
        }

        .questions-list {
            position: relative;
            z-index: 1;
        }

        /* Continuous Dynamic Card Flow:
           Questions fill every page naturally without artificial gaps or hardcoded cutoffs.
           break-inside: avoid ensures no question is sliced across pages. */
        .q-card {
            page-break-inside: avoid;
            break-inside: avoid;
            margin-bottom: 12px;
            padding-bottom: 10px;
            border-bottom: 1px dashed #E2E8F0;
        }

        .q-card:last-child {
            border-bottom: none;
            margin-bottom: 0;
            padding-bottom: 0;
        }

        .q-title {
            font-size: 11.5pt;
            font-weight: 400; /* Regular per user rule */
            color: #111827; /* Jet Black */
            line-height: 1.48;
            margin-bottom: 5px;
        }

        .q-num {
            font-weight: 700;
            color: #111827;
            margin-right: 3px;
        }

        .options-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            column-gap: 14px;
            row-gap: 4px;
            margin-bottom: 5px;
            padding-left: 1px;
        }

        .option-item {
            font-size: 10.5pt;
            font-weight: 400; /* Regular per user rule */
            color: #1F2937; /* Jet Black */
            line-height: 1.4;
        }

        .opt-label {
            font-weight: 600;
            color: #374151;
            margin-right: 3px;
        }

        .q-answer {
            font-size: 11pt;
            font-weight: 700; /* Bold per user rule */
            color: #0066FF; /* Royal Blue */
            margin-top: 3px;
            padding-left: 1px;
            line-height: 1.35;
        }

        @media screen {
            body {
                background-color: #F1F5F9;
                padding: 20px;
                max-width: 600px;
                margin: 0 auto;
            }
            .header-container, .q-card {
                background: #FFFFFF;
            }
        }
    </style>
</head>
<body>
    <div class="watermark">Es Bangla</div>

    <div class="header-container">
        <h1 class="main-title">${data.title}</h1>
        ${data.subtitle ? `<div class="subtitle-wrap"><span class="subtitle-badge">${data.subtitle}</span></div>` : ''}
        <div class="notice-bar">© Es Bangla • শুধুমাত্র ছাত্র-ছাত্রীদের সুবিধার জন্য বানানো হয়েছে</div>
    </div>

    <div class="questions-list">
        ${questionsHtml}
    </div>
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
        const htmlPath = path.join(HTML_DIR, `${baseName}.html`);
        fs.writeFileSync(htmlPath, htmlContent, 'utf8');
        console.log(`Saved HTML preview to ${htmlPath}`);

        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

        const pdfPath = path.join(OUTPUT_DIR, `${baseName}.pdf`);
        await page.pdf({
            path: pdfPath,
            format: 'A5',
            printBackground: true,
            displayHeaderFooter: false,
            margin: {
                top: '12mm',
                bottom: '12mm',
                left: '14mm',
                right: '14mm'
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
