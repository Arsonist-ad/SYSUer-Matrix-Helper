// ==UserScript==
// @name         Matrix 打包助手
// @namespace    http://tampermonkey.net/
// @version      3.7
// @description  1.修复UnknownWeek逻辑；2.消除序号换行；3.优化Word排版与答案提取。
// @author       AI Assistant
// @match        *://matrix.sysu.edu.cn/*
// @match        *://matrix.moe/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function getPageMode() {
        const hasCodeTabs = !!Array.from(document.querySelectorAll('.code-block-item')).find(t => t.innerText.includes('.'));
        if (hasCodeTabs) return 'coding';
        const hasTheoryElements = !!document.querySelector('.ant-radio-group, .ant-checkbox-group, .ant-pagination, .ant-radio-wrapper');
        if (hasTheoryElements) return 'theory';
        return null;
    }

    // 强化版：智能命名识别
    function generateSmartFileName(isTheory = false) {
        // 尝试从多个可能的地方获取标题
        const selectors = ['.assignment-title', 'h1', '.ant-breadcrumb', '.assignment-info-card'];
        let fullTitle = "";
        for (let sel of selectors) {
            const el = document.querySelector(sel);
            if (el && el.innerText.includes('周')) {
                fullTitle = el.innerText;
                break;
            }
        }
        if (!fullTitle) fullTitle = document.body.innerText.substring(0, 500); // 兜底：搜索前500字

        let weekStr = "WeekX";
        // 改进的正则：支持不同格式的“周”
        const weekMatch = fullTitle.match(/[周]\s*(\d+)/);
        if (weekMatch) weekStr = `Week${weekMatch[1]}`;

        if (isTheory) {
            return `${weekStr}-Theory`.replace(/[\\/:*?"<>|☆]/g, '');
        } else {
            const probName = (document.querySelector('.markdown-body h1') || document.querySelector('h1'))?.innerText.trim() || "Problem";
            return `${weekStr}-Coding-${probName}`.replace(/[\\/:*?"<>|☆]/g, '').replace(/\s+/g, '_');
        }
    }

    function injectButton() {
        const mode = getPageMode();
        const existingBtn = document.getElementById('matrix-download-btn');
        if (mode) {
            if (!existingBtn) {
                const btn = document.createElement('button');
                btn.id = 'matrix-download-btn';
                btn.innerHTML = '📂 导出题目';
                btn.style = "position:fixed; bottom:50px; right:30px; z-index:99999; padding:12px 24px; background:#007bff; color:white; border:none; border-radius:30px; cursor:pointer; font-weight:bold; box-shadow: 0 4px 15px rgba(0,0,0,0.3); transition: all 0.3s;";
                btn.onmouseover = () => btn.style.transform = "scale(1.05)";
                btn.onmouseout = () => btn.style.transform = "scale(1)";
                document.body.appendChild(btn);
                btn.onclick = () => {
                    const currentMode = getPageMode();
                    if (currentMode === 'coding') runCodingExport();
                    else runTheoryExport();
                };
            }
        } else if (existingBtn) {
            existingBtn.remove();
        }
    }

    // --- 理论题：Word 导出 (解决序号换行 & 增强识别) ---
    async function runTheoryExport() {
        const btn = document.getElementById('matrix-download-btn');
        const smartName = generateSmartFileName(true);
        let htmlHeader = `
            <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
            <head><meta charset='utf-8'><title>${smartName}</title>
            <style>
                body { font-family: "Microsoft YaHei", sans-serif; line-height: 1.5; padding: 40px; }
                .doc-title { font-size: 18pt; font-weight: bold; text-align: center; margin-bottom: 30px; border-bottom: 1.5pt solid #000; padding-bottom: 10px; }
                .q-container { margin-bottom: 25pt; page-break-inside: avoid; }
                /* 核心修复：强制让题干里的 p 标签变为行内显示，防止序号后换行 */
                .q-stem { font-weight: bold; font-size: 11pt; margin-bottom: 8pt; color: #000; }
                .q-stem p, .q-stem div { display: inline !important; margin: 0; padding: 0; }
                .q-option { margin-left: 30pt; font-size: 10.5pt; display: block; margin-bottom: 3pt; color: #333; }
                .q-answer { margin-top: 8pt; font-weight: bold; color: #d9534f; background: #f9f2f4; padding: 5px; display: inline-block; border: 0.5pt solid #d9534f; margin-left: 20pt; }
                pre { background: #f0f0f0; padding: 10px; border: 0.5pt solid #ccc; font-family: Consolas, monospace; font-size: 9pt; white-space: pre-wrap; margin: 10pt 0; }
                .page-sep { color: #aaa; font-size: 9pt; text-align: center; margin: 20pt 0; border-top: 0.5pt dashed #ccc; padding-top: 5pt; }
                .page-break { page-break-after: always; }
            </style>
            </head><body>
            <div class="doc-title">${smartName} 完整备份</div>
        `;

        let bodyContent = "";
        const paginationItems = Array.from(document.querySelectorAll('.ant-pagination-item'));
        const totalPages = paginationItems.length > 0 ? parseInt(paginationItems[paginationItems.length - 1].innerText) : 1;
        const activePage = document.querySelector('.ant-pagination-item-active')?.innerText || "1";

        let globalIndex = 1;

        btn.disabled = true;

        for (let i = 1; i <= totalPages; i++) {
            btn.innerHTML = `🚀 正在同步第 ${i}/${totalPages} 页`;
            const targetTab = Array.from(document.querySelectorAll('.ant-pagination-item')).find(el => el.innerText == i);
            if (targetTab) {
                targetTab.click();
                await sleep(1500);
            }

            bodyContent += `<div class="page-sep">--- 第 ${i} 页 ---</div>`;

            const cards = document.querySelectorAll('.ant-card-body, .question-container');
            cards.forEach((card) => {
                const stem = card.querySelector('.markdown-body');
                if (stem) {
                    bodyContent += `<div class="q-container">`;
                    // 修复换行：将序号和 stem.innerHTML 放在同一个容器，并靠 CSS 控制
                    bodyContent += `<div class="q-stem"><span>${globalIndex}. </span>${stem.innerHTML}</div>`;
                    globalIndex++;

                    const options = card.querySelectorAll('.ant-radio-wrapper, .ant-checkbox-wrapper, label');
                    options.forEach(opt => {
                        const optText = opt.innerText.trim();
                        if (optText) bodyContent += `<div class="q-option">${optText}</div>`;
                    });

                    // 增强答案抓取：寻找 Standard Answer 文本
                    const allDivs = Array.from(card.querySelectorAll('div, span, p'));
                    const answerEl = allDivs.find(el => el.innerText.includes("Standard Answer"));
                    if (answerEl) {
                        bodyContent += `<div class="q-answer">${answerEl.innerText.trim()}</div>`;
                    }
                    bodyContent += `</div>`;
                }
            });

            if (i < totalPages) bodyContent += `<div class="page-break"></div>`;
        }

        const originalTab = Array.from(document.querySelectorAll('.ant-pagination-item')).find(el => el.innerText == activePage);
        if (originalTab) originalTab.click();

        const finalHtml = htmlHeader + bodyContent + "</body></html>";
        const blob = new Blob([finalHtml], {type: "application/msword;charset=utf-8"});
        const a = document.createElement('a');
        a.href = window.URL.createObjectURL(blob);
        a.download = `${smartName}.doc`;
        a.click();

        btn.disabled = false;
        btn.innerHTML = '📂 导出题目';
    }

    // --- 编程题：ZIP 导出 (保持稳定) ---
    async function runCodingExport() {
        const btn = document.getElementById('matrix-download-btn');
        const smartName = generateSmartFileName(false);
        btn.innerHTML = '🚀 打包中...';
        btn.disabled = true;
        try {
            const zip = new JSZip();
            const root = zip.folder(smartName);
            root.file("Description.md", document.querySelector('.markdown-body')?.innerText || "");
            const testsDir = root.folder("Tests");
            const pres = document.querySelectorAll('.markdown-body pre');
            if (pres.length >= 2) {
                testsDir.file("in1.txt", pres[0].innerText);
                testsDir.file("out1.txt", pres[1].innerText);
            }
            const latestSub = root.folder("Latest Submission");
            const codeTabs = Array.from(document.querySelectorAll('.code-block-item')).filter(t => t.innerText.includes('.'));
            if (codeTabs.length > 0) {
                for (let tab of codeTabs) {
                    const fileName = tab.firstChild.textContent.trim();
                    tab.click();
                    await sleep(1000);
                    let finalCode = "";
                    if (window.monaco) {
                        const models = monaco.editor.getModels();
                        const match = models.find(m => m.uri.path.includes(fileName));
                        finalCode = match ? match.getValue() : monaco.editor.getEditors()[0].getValue();
                    } else {
                        finalCode = document.querySelector('.monaco-editor')?.innerText || "";
                    }
                    latestSub.file(fileName, finalCode);
                }
            }
            const blob = await zip.generateAsync({type: "blob"});
            const a = document.createElement('a');
            a.href = window.URL.createObjectURL(blob);
            a.download = `${smartName}.zip`;
            a.click();
        } catch (err) { alert("下载失败"); }
        finally {
            btn.disabled = false;
            btn.innerHTML = '📂 导出题目';
        }
    }

    setInterval(injectButton, 2000);
})();