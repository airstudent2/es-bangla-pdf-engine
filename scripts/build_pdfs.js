const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

const QUESTIONS_DIR = path.join(__dirname, '..', 'questions');
const OUTPUT_DIR = path.join(__dirname, '..', 'output_pdfs');
const HTML_DIR = path.join(__dirname, '..', 'output_html');
const FONTS_DIR = path.join(__dirname, '..', 'fonts');

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(HTML_DIR)) fs.mkdirSync(HTML_DIR, { recursive: true });

// Read local TTF fonts and encode as Base64 for 100% bulletproof offline rendering
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

function generateHtml(data) {
    const questionsHtml = data.questions.map(q => `
        <div class="q-card">
            <div class="q-title"><strong>${q.number}.</strong> ${q.question}</div>
            <div class="options-grid">
                <div class="option-item"><span class="opt-label">(ক)</span> ${q.optionA}</div>
                <div class="option-item"><span class="opt-label">(খ)</span> ${q.optionB}</div>
                <div class="option-item"><span class="opt-label">(গ)</span> ${q.optionC}</div>
                <div class="option-item"><span class="opt-label">(ঘ)</span> ${q.optionD}</div>
            </div>
            <div class="q-answer">উত্তর:- ${q.answer}</div>
        </div>
    `).join('');

    const fontFaceRules = regularBase64 && boldBase64 ? `
        @font-face {
            font-family: 'Noto Serif Bengali';
            src: url('data:font/truetype;charset=utf-8;base64,${regularBase64}') format('truetype');
            font-weight: 400;
            font-style: normal;
            font-display: swap;
        }
        @font-face {
            font-family: 'Noto Serif Bengali';
            src: url('data:font/truetype;charset=utf-8;base64,${boldBase64}') format('truetype');
            font-weight: 700;
            font-style: normal;
            font-display: swap;
        }
    ` : '';

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
            margin: 0; /* Let Puppeteer margins govern the printable area */
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Noto Serif Bengali', 'Noto Sans Bengali', 'Lohit Bengali', serif;
            background-color: #FFFFFF;
            color: #111827;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            position: relative;
            padding: 0;
            font-size: 11pt;
            line-height: 1.45;
        }

        /* Diagonal Aesthetic Watermark (5.5% Opacity - Clearly visible yet 100% non-intrusive) */
        .watermark {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%) rotate(-28deg);
            font-family: 'Noto Serif Bengali', serif;
            font-size: 48pt;
            font-weight: 700;
            color: rgba(0, 102, 255, 0.055);
            letter-spacing: 2.5px;
            pointer-events: none;
            z-index: 0;
            white-space: nowrap;
            user-select: none;
        }

        .header-container {
            text-align: center;
            margin-bottom: 8px;
            padding-bottom: 5px;
            border-bottom: 1.5px solid #0066FF;
        }

        .main-title {
            font-size: 15pt;
            font-weight: 700;
            color: #0066FF;
            line-height: 1.32;
            text-decoration: underline;
            text-decoration-color: #0066FF;
            text-underline-offset: 4px;
            margin-bottom: 4px;
        }

        .subtitle-badge {
            display: inline-block;
            font-size: 10.5pt;
            font-weight: 700;
            color: #0066FF;
            background: rgba(0, 102, 255, 0.08);
            padding: 1px 9px;
            border-radius: 4px;
            margin-top: 2px;
            margin-bottom: 6px;
        }

        .questions-list {
            position: relative;
            z-index: 1;
        }

        /* Compact & Balanced Card Spacing - Fits 4 questions per A5 page with zero waste */
        .q-card {
            page-break-inside: avoid;
            break-inside: avoid;
            margin-bottom: 9px;
            padding-bottom: 8px;
            border-bottom: 1px dashed #E2E8F0;
        }

        .q-card:last-child {
            border-bottom: none;
            margin-bottom: 0;
            padding-bottom: 0;
        }

        .q-title {
            font-size: 11.2pt;
            font-weight: 400; /* Regular per user rule */
            color: #111827; /* Jet Black */
            line-height: 1.45;
            margin-bottom: 4px;
        }

        .q-title strong {
            font-weight: 700;
            color: #111827;
        }

        .options-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            column-gap: 12px;
            row-gap: 3px;
            margin-bottom: 4px;
            padding-left: 2px;
        }

        .option-item {
            font-size: 10.2pt;
            font-weight: 400; /* Regular per user rule */
            color: #1F2937; /* Jet Black */
            line-height: 1.38;
        }

        .opt-label {
            font-weight: 600;
            color: #4B5563;
            margin-right: 2px;
        }

        .q-answer {
            font-size: 10.8pt;
            font-weight: 700; /* Bold per user rule */
            color: #0066FF; /* Royal Blue */
            margin-top: 3px;
            padding-left: 2px;
            line-height: 1.35;
        }

        @media screen {
            body {
                max-width: 600px;
                margin: 20px auto;
                padding: 24px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.08);
                border-radius: 12px;
            }
        }
    </style>
</head>
<body>
    <div class="watermark">Es Bangla</div>

    <div class="header-container">
        <h1 class="main-title">${data.title}</h1>
    </div>

    ${data.subtitle ? `<div style="text-align: left;"><span class="subtitle-badge">${data.subtitle}</span></div>` : ''}

    <div class="questions-list">
        ${questionsHtml}
    </div>
</body>
</html>`;
}

function buildFooterTemplate() {
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

    return `
        <style>
            ${fontFaceRules}
            .pdf-footer {
                width: 100%;
                margin: 0;
                padding: 0 11mm;
                box-sizing: border-box;
                font-family: 'Noto Serif Bengali', 'Noto Sans Bengali', 'Lohit Bengali', sans-serif !important;
                font-size: 8pt;
                line-height: 1;
                display: flex;
                justify-content: space-between;
                align-items: center;
                color: #64748B;
                border-top: 0.6px solid #CBD5E1;
                padding-top: 1.8mm;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
        </style>
        <div class="pdf-footer">
            <span style="font-weight: 600;">© Es Bangla • ছাত্র-ছাত্রীদের সুবিধার জন্য বানানো হয়েছে</span>
            <span style="color: #0066FF; font-weight: 700;">পৃষ্ঠা <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>
    `;
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
            displayHeaderFooter: true,
            headerTemplate: '<div></div>',
            footerTemplate: buildFooterTemplate(),
            margin: {
                top: '10mm',
                bottom: '12mm',
                left: '11mm',
                right: '11mm'
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
