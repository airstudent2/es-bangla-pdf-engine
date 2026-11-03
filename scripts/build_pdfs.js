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

    const title = lines[0];
    let subtitle = '';
    let startIdx = 1;

    if (lines.length > 1 && lines[1].toLowerCase().startsWith('mcq')) {
        subtitle = lines[1];
        startIdx = 2;
    }

    const content = lines.slice(startIdx).join('\n');
    const questionBlocks = [];

    // Regex to capture Question, (ক), (খ), (গ), (ঘ), and Answer
    const qRegex = /(?:^|\n)\s*(\d+)[\.\।\)]\s*([^\n]+(?:\n(?!\([কখগঘ]\))[^\n]+)*)\s*\n\s*\(ক\)\s*([^\n]+?)\s*(?:\n|\s{2,})\s*\(খ\)\s*([^\n]+?)\s*\n\s*\(গ\)\s*([^\n]+?)\s*(?:\n|\s{2,})\s*\(ঘ\)\s*([^\n]+?)\s*\n\s*(?:উত্তর|Ans)\s*[:\-\—\s]+\s*([^\n]+)/gi;

    let match;
    while ((match = qRegex.exec(content)) !== null) {
        questionBlocks.push({
            number: match[1],
            question: match[2].trim(),
            optionA: match[3].trim(),
            optionB: match[4].trim(),
            optionC: match[5].trim(),
            optionD: match[6].trim(),
            answer: match[7].trim()
        });
    }

    // Fallback line-by-line state machine if regex didn't match all
    if (questionBlocks.length === 0) {
        let currentQ = null;
        for (let i = 0; i < lines.slice(startIdx).length; i++) {
            const line = lines.slice(startIdx)[i];
            const qMatch = line.match(/^(\d+)[\.\।\)]\s*(.*)/);
            if (qMatch) {
                if (currentQ) questionBlocks.push(currentQ);
                currentQ = { number: qMatch[1], question: qMatch[2], optionA: '', optionB: '', optionC: '', optionD: '', answer: '' };
            } else if (currentQ) {
                if (line.includes('(ক)')) {
                    const parts = line.split(/(?=\([খঘ]\))/);
                    currentQ.optionA = (parts[0] || '').replace('(ক)', '').trim();
                    if (parts[1]) currentQ.optionB = parts[1].replace('(খ)', '').trim();
                } else if (line.includes('(গ)')) {
                    const parts = line.split(/(?=\([ঘ]\))/);
                    currentQ.optionC = (parts[0] || '').replace('(গ)', '').trim();
                    if (parts[1]) currentQ.optionD = parts[1].replace('(ঘ)', '').trim();
                } else if (line.startsWith('উত্তর') || line.startsWith('Ans')) {
                    currentQ.answer = line.replace(/^(?:উত্তর|Ans)[:\-\—\s]*/, '').trim();
                } else if (!currentQ.optionA) {
                    currentQ.question += ' ' + line;
                }
            }
        }
        if (currentQ) questionBlocks.push(currentQ);
    }

    return { title, subtitle, questions: questionBlocks };
}

// Smart paginator: Ensures 4 questions on Page 1 (with title) and balanced 4-5 on subsequent pages
function paginateQuestions(questions) {
    if (questions.length <= 4) {
        return [questions];
    }
    if (questions.length <= 8) {
        // Balanced 4 and 4 split for 8 questions
        const half = Math.ceil(questions.length / 2);
        return [questions.slice(0, half), questions.slice(half)];
    }

    // General multi-page handling
    const pages = [];
    pages.push(questions.slice(0, 4)); // Page 1 gets 4 questions
    let remaining = questions.slice(4);

    while (remaining.length > 0) {
        if (remaining.length <= 5) {
            pages.push(remaining);
            break;
        } else if (remaining.length === 6) {
            // Split 3 and 3 rather than 5 and 1
            pages.push(remaining.slice(0, 3));
            pages.push(remaining.slice(3));
            break;
        } else {
            pages.push(remaining.slice(0, 5));
            remaining = remaining.slice(5);
        }
    }
    return pages;
}

function generateHtml(data) {
    const pages = paginateQuestions(data.questions);
    const totalPages = pages.length;

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

    const pagesHtml = pages.map((pageQuestions, pageIdx) => {
        const isFirstPage = pageIdx === 0;

        const questionsHtml = pageQuestions.map(q => `
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

        return `
            <div class="pdf-page">
                <!-- Background Aesthetic Watermark -->
                <div class="watermark">Es Bangla</div>

                <!-- Page Content Area -->
                <div class="page-body">
                    ${isFirstPage ? `
                        <div class="header-container">
                            <h1 class="main-title">${data.title}</h1>
                        </div>
                        ${data.subtitle ? `<div class="subtitle-wrap"><span class="subtitle-badge">${data.subtitle}</span></div>` : ''}
                    ` : ''}

                    <div class="questions-list">
                        ${questionsHtml}
                    </div>
                </div>

                <!-- Native In-Page Footer with Full Bengali Typography -->
                <div class="pdf-footer">
                    <div class="pdf-footer-left">© Es Bangla • ছাত্র-ছাত্রীদের সুবিধার জন্য বানানো হয়েছে</div>
                    <div class="pdf-footer-right">পৃষ্ঠা ${toBengaliNumber(pageIdx + 1)} / ${toBengaliNumber(totalPages)}</div>
                </div>
            </div>
        `;
    }).join('');

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
            margin: 0;
        }

        *, *::before, *::after {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        html, body {
            margin: 0;
            padding: 0;
            background-color: #FFFFFF;
            font-family: 'Noto Serif Bengali', 'Noto Sans Bengali', 'Lohit Bengali', serif;
            color: #111827;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        /* Dedicated A5 Page Container with Guaranteed Safe Margins */
        .pdf-page {
            width: 148mm;
            height: 210mm;
            padding: 12mm 14mm 9mm 14mm; /* 14mm left/right safe margin prevents any text cutoff */
            position: relative;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            page-break-after: always;
            break-after: page;
            overflow: hidden;
            background-color: #FFFFFF;
        }

        .pdf-page:last-child {
            page-break-after: avoid;
            break-after: avoid;
        }

        /* Diagonal Aesthetic Watermark - Perfectly Centered in Page Container */
        .watermark {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-28deg);
            font-family: 'Noto Serif Bengali', serif;
            font-size: 50pt;
            font-weight: 700;
            color: rgba(0, 102, 255, 0.055); /* Clearly visible yet completely non-intrusive */
            letter-spacing: 3px;
            pointer-events: none;
            z-index: 0;
            white-space: nowrap;
            user-select: none;
        }

        .page-body {
            position: relative;
            z-index: 1;
            flex: 1;
        }

        .header-container {
            text-align: center;
            margin-bottom: 8px;
            padding-bottom: 5px;
            border-bottom: 1.5px solid #0066FF;
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
            margin-bottom: 8px;
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

        .questions-list {
            display: flex;
            flex-direction: column;
        }

        /* Clean Question Card Spacing */
        .q-card {
            margin-bottom: 11px;
            padding-bottom: 9px;
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

        /* Native Clean Footer Bar */
        .pdf-footer {
            position: relative;
            z-index: 1;
            margin-top: auto;
            padding-top: 2.5mm;
            border-top: 0.8px solid #CBD5E1;
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-family: 'Noto Serif Bengali', serif;
            color: #64748B;
        }

        .pdf-footer-left {
            font-size: 8pt;
            font-weight: 600;
            color: #64748B;
            letter-spacing: 0.2px;
        }

        .pdf-footer-right {
            font-size: 8.5pt;
            font-weight: 700;
            color: #0066FF;
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
                border-radius: 8px;
            }
        }
    </style>
</head>
<body>
    ${pagesHtml}
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
            displayHeaderFooter: false, // In-Page Native Footer eliminates Puppeteer Skia font distortion
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
