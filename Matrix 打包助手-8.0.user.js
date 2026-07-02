// ==UserScript==
// @name         Matrix 打包助手 (全模式版 v9.0 - 代码+理论题)
// @namespace    http://tampermonkey.net/
// @version      9.0
// @description  代码题：生成 1-练习区（清空模板）+ 2-答案区（完整代码）；理论题：打包题目及答案到 .md 文件。
// @author       AI Assistant
// @match        *://matrix.sysu.edu.cn/*
// @match        *://matrix.moe/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // ── 页面模式判断 ──────────────────────────────────────────────
    function getPageMode() {
        // coding: 页面存在带文件扩展名的代码标签
        return !!Array.from(document.querySelectorAll('.code-block-item'))
            .find(t => t.innerText.includes('.')) ? 'coding' : 'theory';
    }

    // ── 作业上下文（周次/类型/课程名） ──────────────────────────
    function getAssignmentContext() {
        // 按优先级取标题：原来好用选择器 > 含"周"的 heading > 页面通用 heading > 兜底
        let rawTitle = '';

        // 1) 原有选择器（代码题页面常用）
        const legacyEl = document.querySelector('.assignment-title, .ant-page-header-heading-title');
        if (legacyEl) {
            rawTitle = (legacyEl.innerText || legacyEl.textContent || '').trim();
        }

        // 2) 在所有 h1/h2/h3 中找包含"周"的（理论题页面确认有效）
        if (!rawTitle) {
            const headings = document.querySelectorAll('h1, h2, h3');
            for (const el of headings) {
                const t = (el.innerText || el.textContent || '').trim();
                if (t && /周\s*\d+/.test(t)) {
                    rawTitle = t;
                    break;
                }
            }
        }

        // 3) 取第一个有意义的 heading（长度>5且非系统标题）
        if (!rawTitle) {
            const headings = document.querySelectorAll('h1, h2, h3');
            for (const el of headings) {
                const t = (el.innerText || el.textContent || '').trim();
                if (t && t.length > 5 && !t.includes('Matrix') && !t.includes('art of coding')) {
                    rawTitle = t;
                    break;
                }
            }
        }

        // 4) 兜底
        if (!rawTitle) {
            rawTitle = (document.querySelector('.ant-breadcrumb')?.innerText || document.title || '').trim();
        }

        // 提取课程名（如 "25程设Ⅱ"）
        const courseMatch = rawTitle.match(/(\d{2}[^-–—\s周]*)/);
        const course = courseMatch ? courseMatch[1].trim() : '';

        // 提取周次
        let week = "WeekX";
        const weekMatch = rawTitle.match(/周\s*(\d+)/);
        if (weekMatch) week = `Week${weekMatch[1].padStart(2, '0')}`;

        // 提取类型
        let typeStr = "Task";
        if (rawTitle.includes('理论')) typeStr = 'Theory';
        else if (rawTitle.includes('代码') || rawTitle.includes('编程')) typeStr = 'Coding';
        else if (rawTitle.includes('课后')) typeStr = `AfterClass${(rawTitle.match(/课后\s*(\d*)/) || [])[1] || ''}`;
        else if (rawTitle.includes('课堂')) typeStr = `InClass${(rawTitle.match(/课堂\s*(\d*)/) || [])[1] || ''}`;

        // 干净的标题：不含课程编号和"周XX"
        let cleanTitle = rawTitle
            .replace(/^\d{2}[^-–—\s周]*[\-–—]/, '')
            .replace(/周\s*\d+[\-–—]?/, '')
            .replace(/^\s*[\-–—]\s*/, '')
            .trim();

        if (!cleanTitle || cleanTitle.length < 2) {
            cleanTitle = rawTitle;
        }

        return { week, typeStr, course, cleanTitle, rawTitle };
    }

    // ── 提取测试用例 ─────────────────────────────────────────────
    function extractTestCases(text) {
        const regex = /(?:输入示例|Sample Input|Input)\s*\d*[:：]?\s*\n([\s\S]*?)(?=\n(?:输出示例|Sample Output|输入示例|Sample Input|Output|$))/gi;
        const matches = [...text.matchAll(regex)];
        if (matches.length > 0) {
            return matches.map(m => m[1].trim()).join('\n\n');
        }
        return "";
    }

    // ── 获取当前活跃的 Monaco 编辑器内容 ─────────────────────────
    function getActiveEditorValue(editors) {
        for (let ed of editors) {
            const domNode = ed.getDomNode();
            if (domNode && (domNode.offsetWidth > 0 || domNode.offsetHeight > 0)) {
                return ed.getValue();
            }
        }
        return editors.find(ed => ed.hasWidgetFocus())?.getValue()
            || editors[editors.length - 1]?.getValue() || "";
    }

    // ════════════════════════════════════════════════════════════════
    //  代码题导出（原 v8.0 逻辑，保留不变）
    // ════════════════════════════════════════════════════════════════
    async function runCodingExport() {
        const monaco = unsafeWindow.monaco;
        if (!monaco) return alert("Monaco 编辑器未加载");

        const btn = document.getElementById('matrix-download-btn');
        const ctx = getAssignmentContext();
        const probName = (document.querySelector('.markdown-body h1') || document.querySelector('h1'))
            ?.innerText.trim() || "Problem";
        const smartName = `${ctx.week}-${ctx.typeStr}-${probName}`
            .replace(/[\\/:*?"<>|☆]/g, '').replace(/\s+/g, '_');

        btn.disabled = true;

        try {
            const zip = new JSZip();
            const root = zip.folder(smartName);

            // 1. 题目描述
            const descBody = document.querySelector('.markdown-body');
            const descText = descBody?.innerText || "";
            root.file("Problem_Description.md", descText);

            // 2. 测试用例
            const testData = extractTestCases(descText);
            if (testData) {
                root.file("in.txt", testData);
            }

            // 3. 练习区 & 答案区
            const practiceFolder = root.folder("1-Practice_Workspace");
            const solutionFolder = root.folder("2-My_Solutions");

            const tabs = Array.from(document.querySelectorAll('.code-block-item'))
                .filter(t => t.innerText.includes('.'));

            for (let tab of tabs) {
                const fName = tab.firstChild.textContent.trim();
                const isLocked = !!tab.querySelector('.anticon-lock');
                btn.innerHTML = `抓取中: ${fName}`;

                const editors = monaco.editor.getEditors();
                const oldStates = editors.map(ed => ed.getModel()?.id);

                tab.scrollIntoView();
                tab.click();

                for (let i = 0; i < 20; i++) {
                    await sleep(150);
                    const currentEditors = monaco.editor.getEditors();
                    if (tab.classList.contains('active')
                        && currentEditors.some((ed, idx) => ed.getModel()?.id !== oldStates[idx])) break;
                }
                await sleep(250);

                const currentEditors = monaco.editor.getEditors();
                const finalContent = getActiveEditorValue(currentEditors);

                // 答案区：保留完整代码
                solutionFolder.file(fName, finalContent);

                // 练习区
                if (isLocked) {
                    practiceFolder.file(fName, finalContent);
                } else {
                    let practiceTemplate = `// TODO: 请在此处手写你的代码实现\n`;
                    if (fName.endsWith('.cpp')) {
                        const possibleHeader = fName.replace('.cpp', '.h');
                        const hasHeader = tabs.some(t => t.textContent.trim() === possibleHeader);
                        if (hasHeader) {
                            practiceTemplate += `#include "${possibleHeader}"\n\n`;
                        } else {
                            practiceTemplate += `#include <iostream>\nusing namespace std;\n\n`;
                        }
                    }
                    practiceFolder.file(fName, practiceTemplate);
                }
            }

            const blob = await zip.generateAsync({ type: "blob" });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${smartName}.zip`;
            a.click();
            btn.innerHTML = "✅ 导出成功";
        } catch (e) {
            console.error(e);
            alert("导出异常");
        } finally {
            await sleep(2000);
            btn.disabled = false;
            btn.innerHTML = '📂 导出题目';
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  理论题导出（基于真实 DOM 结构：.question > nz-card）
    // ════════════════════════════════════════════════════════════════

    /**
     * 从 .question 容器中提取一道题的完整数据。
     *
     * 已知 DOM 结构（Matrix / NG-ZORRO）：
     *   <div class="question ng-star-inserted">
     *     <nz-card class="ant-card ant-card-bordered">
     *       <div class="ant-card-head">
     *         <div class="ant-card-head-title">Question N - 题型</div>
     *       </div>
     *       <div class="ant-card-body">
     *         题干文本
     *         A. 选项A
     *         B. 选项B
     *         ...
     *         Standard Answer: X
     *       </div>
     *     </nz-card>
     *   </div>
     *
     * @returns {{ index: number, type: string, stem: string, options: string[], answer: string }}
     */
    function parseQuestionCard(questionEl, index) {
        const card = questionEl.querySelector('nz-card, .ant-card');
        const cardEl = card || questionEl;

        // 1) 标题：Question N - 题型
        const titleEl = cardEl.querySelector('.ant-card-head-title');
        const titleRaw = (titleEl?.innerText || '').trim();
        // 从 "Question 1 - 单选题" 中提取题型
        const typeMatch = titleRaw.match(/-\s*(.+)/);
        const qType = typeMatch ? typeMatch[1].trim() : '';

        // 2) 全文（Angular 动态渲染可能导致 innerText 为空，优先用 textContent）
        const fullText = (cardEl.textContent || cardEl.innerText || '').trim();
        // 如果 cardEl 也是空的，直接取 questionEl
        const rawFullText = fullText || (questionEl.textContent || questionEl.innerText || '').trim();

        // 3) 按 "Standard Answer:" 切分前半（题干+选项）与后半（答案）
        const answerSplitter = /Standard\s*Answer\s*[:：]\s*/i;
        const parts = rawFullText.split(answerSplitter);

        const bodyText = (parts[0] || '').trim();   // 题干 + 选项
        const answerRaw = (parts[1] || '').trim();   // 纯答案（可能带解析）

        // 4) 从 bodyText 中拆出题干和选项。
        //    Matrix 页面中选项字母和文本可能分行，例如：
        //      A.          <-- 选项字母独占一行
        //      选项文本     <-- 文本在下一行
        //    所以不能直接用 .+ 要求字母后必须有文本。
        const lines = bodyText.split(/\n/).map(l => l.trim()).filter(Boolean);

        // 行首是 A. / A、/ A) 格式（允许后面为空或跟文本）
        const optStartRe = /^([A-F])[\.\、\．\)](.*)/;

        let stem = '';
        const options = [];
        let inOptions = false;  // 是否已进入选项区域

        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(optStartRe);
            if (m) {
                inOptions = true;
                const label = m[1];                // "A"
                let text = m[2].trim();            // 可能为空
                // 如果当前行只有字母没有文本，看下一行是不是纯文本（非选项头、非答案）
                if (!text && i + 1 < lines.length) {
                    const next = lines[i + 1];
                    if (!optStartRe.test(next) && !/^Standard\s*Answer/i.test(next)) {
                        text = next;
                        i++;  // 消费掉下一行
                    }
                }
                options.push(`${label}. ${text}`.trim());
            } else if (!inOptions) {
                // 还没进选项区 → 属于题干
                stem += (stem ? '\n' : '') + lines[i];
            } else {
                // 已进选项区但不匹配选项头 → 可能是上一选项的续行
                if (options.length > 0) {
                    options[options.length - 1] += ' ' + lines[i];
                }
            }
        }

        // 如果没有解析到选项（inOptions 仍为 false），全部内容当题干
        if (options.length === 0) {
            stem = lines.join('\n');
        }

        // 5) 清理题干（去掉标题行重复）
        if (titleRaw && stem.startsWith(titleRaw)) {
            stem = stem.substring(titleRaw.length).trim();
        }
        // 标题可能也包含 "Question N - 题型"，尝试去掉
        const qPrefix = new RegExp(`^Question\\s*${index}\\s*-\\s*[^\\n]*\\n?`, 'i');
        stem = stem.replace(qPrefix, '').trim();

        return {
            index,
            type: qType,
            stem,
            options,
            answer: answerRaw || '（未找到答案，请手动补充）',
        };
    }

    /**
     * 构建单道题的 Markdown（含答案）。
     */
    function renderQuestionMD(q) {
        let md = `### 第 ${q.index} 题`;

        if (q.type) {
            md += ` *（${q.type}）*`;
        }
        md += '\n\n';

        md += `**题干：**\n\n${q.stem}\n\n`;

        if (q.options.length > 0) {
            md += `**选项：**\n\n`;
            for (const opt of q.options) {
                md += `- ${opt}\n`;
            }
            md += '\n';
        }

        md += `**答案：** ${q.answer}\n\n`;
        md += '---\n\n';
        return md;
    }

    /**
     * 收集所有分页中的 .question 元素。
     * 如果存在 .ant-pagination，则逐页点击收集；否则只取当前页。
     */
    async function collectAllQuestionEls(btn) {
        const pagination = document.querySelector('.ant-pagination');
        if (!pagination) {
            return Array.from(document.querySelectorAll('.question'));
        }

        // 获取页码按钮：通过 title 属性找数字页码
        const pageItems = Array.from(pagination.querySelectorAll('li[title]'));
        const pageNums = pageItems
            .map(li => parseInt(li.getAttribute('title')))
            .filter(n => !isNaN(n))
            .sort((a, b) => a - b);

        if (pageNums.length <= 1) {
            return Array.from(document.querySelectorAll('.question'));
        }

        const allEls = [];
        const seenText = new Set(); // 用于去重

        for (let pageIdx = 0; pageIdx < pageNums.length; pageIdx++) {
            const pageNum = pageNums[pageIdx];
            btn.innerHTML = `翻页中: 第 ${pageNum}/${pageNums[pageNums.length - 1]} 页`;

            // 点击对应页码
            const targetLi = pageItems.find(li => li.getAttribute('title') === String(pageNum));
            if (targetLi) {
                const clickable = targetLi.querySelector('a') || targetLi;
                clickable.click();
                await sleep(800); // 等待 Angular 渲染
            }

            // 收集当前页的题目
            const currentQuestions = Array.from(document.querySelectorAll('.question'));
            for (const qEl of currentQuestions) {
                const text = (qEl.textContent || qEl.innerText || '').trim();
                // 用文本前 100 字符去重，避免分页切换时重复
                const key = text.substring(0, 100);
                if (!seenText.has(key)) {
                    seenText.add(key);
                    allEls.push(qEl);
                }
            }
        }

        return allEls;
    }

    async function runTheoryExport() {
        const btn = document.getElementById('matrix-download-btn');
        const ctx = getAssignmentContext();

        // 标题优先级：上下文中的 cleanTitle > 面包屑末级 > document.title
        const rawTitle = ctx.cleanTitle || ctx.rawTitle
            || (document.querySelector('.ant-breadcrumb')?.innerText?.split(/[\n>\/]/).pop()?.trim())
            || document.title.split(/[-–—|]/)[0].trim()
            || 'TheoryProblem';
        const pageTitle = rawTitle.replace(/[\\/:*?"<>|]/g, '').trim();

        // 文件名：Week14-Theory-理论题
        const smartName = `${ctx.week}-${ctx.typeStr}-${pageTitle}`
            .replace(/[\\/:*?"<>|☆]/g, '').replace(/\s+/g, '_');

        btn.disabled = true;
        btn.innerHTML = '🔍 正在分析理论题...';

        try {
            // 先确保在答题区域（点击第二个 tab，即索引 1 = "答题区域"）
            const tabs = document.querySelectorAll('.ant-tabs-tab');
            if (tabs.length >= 2) {
                const answerTab = tabs[1];
                answerTab.click();
                await sleep(800);
            }

            // 收集所有分页的题目
            const questionEls = await collectAllQuestionEls(btn);
            btn.innerHTML = `发现 ${questionEls.length} 道理论题，正在打包...`;

            // 解析所有题目
            const questions = questionEls
                .map((el, i) => parseQuestionCard(el, i + 1))
                .filter(q => q.stem.length > 0);

            // 构建 Markdown
            let fullMD = '';
            fullMD += `# ${pageTitle}（理论题·含答案）\n\n`;
            fullMD += `> - **周次：** ${ctx.week}\n`;
            fullMD += `> - **类型：** ${ctx.typeStr}\n`;
            fullMD += `> - **导出时间：** ${new Date().toLocaleString()}\n`;
            fullMD += `> - **题目数量：** ${questions.length}\n\n`;
            fullMD += `---\n\n`;

            let hasAnyAnswer = false;

            for (let i = 0; i < questions.length; i++) {
                btn.innerHTML = `打包中: 第 ${i + 1}/${questions.length} 题`;
                const q = questions[i];
                const md = renderQuestionMD(q);
                if (q.answer && !q.answer.includes('未找到答案')) {
                    hasAnyAnswer = true;
                }
                fullMD += md;
                await sleep(30);
            }

            if (!hasAnyAnswer) {
                fullMD += '\n> ⚠️ **注意：** 未能自动提取到答案。请在完成作答并显示 Standard Answer 后再导出，或在 .md 文件中手动补充。\n\n';
            }

            // 生成纯题目版（答案挖空）
            let cleanMD = fullMD
                .replace(/\*\*答案：\*\*\s*.+?\n\n/g, '**答案：** ______\n\n');
            cleanMD = cleanMD.replace(/（理论题·含答案）/g, '（理论题·纯题目版）');
            cleanMD = cleanMD.replace(/（含答案）/g, '（纯题目版）');

            // 打包 ZIP
            const zip = new JSZip();
            const root = zip.folder(smartName);
            root.file(`${pageTitle}（含答案）.md`, fullMD);
            root.file(`${pageTitle}（纯题目·自测版）.md`, cleanMD);

            const blob = await zip.generateAsync({ type: "blob" });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${smartName}.zip`;
            a.click();
            btn.innerHTML = "✅ 导出成功";
        } catch (e) {
            console.error(e);
            alert("理论题导出异常，请刷新后重试");
        } finally {
            await sleep(2000);
            btn.disabled = false;
            btn.innerHTML = '📂 导出题目';
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  按钮注入 & 主入口
    // ════════════════════════════════════════════════════════════════
    function injectButton() {
        if (document.getElementById('matrix-download-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'matrix-download-btn';
        btn.innerHTML = '📂 导出题目';
        btn.style = [
            "position:fixed", "bottom:50px", "right:30px", "z-index:99999",
            "padding:12px 24px", "background:#0A4749", "color:white",
            "border:none", "border-radius:30px", "cursor:pointer",
            "font-weight:bold", "box-shadow: 0 4px 15px rgba(0,0,0,0.3)",
            "transition: all 0.3s ease"
        ].join(';');
        document.body.appendChild(btn);

        // hover 效果
        btn.addEventListener('mouseenter', () => {
            btn.style.transform = 'scale(1.05)';
            btn.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.transform = 'scale(1)';
            btn.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3)';
        });

        btn.onclick = () => {
            const mode = getPageMode();
            if (mode === 'coding') {
                runCodingExport();
            } else {
                runTheoryExport();
            }
        };
    }

    setInterval(injectButton, 2000);
})();
