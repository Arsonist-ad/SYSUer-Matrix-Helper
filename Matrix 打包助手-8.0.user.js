// ==UserScript==
// @name         Matrix 打包助手 (双模练习版 v8.0)
// @namespace    http://tampermonkey.net/
// @version      8.0
// @description  同时生成 1-练习区（清空可编辑文件）和 2-答案区（保留完整代码），支持本地二刷。
// @author       AI Assistant
// @match        *://matrix.sysu.edu.cn/*
// @match        *://matrix.moe/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js
// @grant        unsafeWindow
// ==/UserScript==

(function() {
    'use strict';

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function getPageMode() {
        return !!Array.from(document.querySelectorAll('.code-block-item')).find(t => t.innerText.includes('.')) ? 'coding' : 'theory';
    }

    function getAssignmentContext() {
        const titleEl = document.querySelector('.assignment-title, .ant-page-header-heading-title, .ant-breadcrumb');
        const titleText = titleEl ? titleEl.innerText : document.title;
        let week = "WeekX", typeStr = "Task";
        const weekMatch = titleText.match(/周\s*(\d+)/);
        if (weekMatch) week = `Week${weekMatch[1].padStart(2, '0')}`;
        if (titleText.includes("课后")) typeStr = `AfterClass${(titleText.match(/课后\s*(\d*)/) || [])[1] || ""}`;
        else if (titleText.includes("课堂")) typeStr = `InClass${(titleText.match(/课堂\s*(\d*)/) || [])[1] || ""}`;
        return { week, typeStr };
    }

    function extractTestCases(text) {
        const regex = /(?:输入示例|Sample Input|Input)\s*\d*[:：]?\s*\n([\s\S]*?)(?=\n(?:输出示例|Sample Output|输入示例|Sample Input|Output|$))/gi;
        const matches = [...text.matchAll(regex)];
        if (matches.length > 0) {
            return matches.map(m => m[1].trim()).join('\n\n');
        }
        return "";
    }

    function getActiveEditorValue(editors) {
        for (let ed of editors) {
            const domNode = ed.getDomNode();
            if (domNode && (domNode.offsetWidth > 0 || domNode.offsetHeight > 0)) {
                return ed.getValue();
            }
        }
        return editors.find(ed => ed.hasWidgetFocus())?.getValue() || editors[editors.length - 1]?.getValue() || "";
    }

    async function runCodingExport() {
        const monaco = unsafeWindow.monaco;
        if (!monaco) return alert("Monaco 编辑器未加载");

        const btn = document.getElementById('matrix-download-btn');
        const ctx = getAssignmentContext();
        const probName = (document.querySelector('.markdown-body h1') || document.querySelector('h1'))?.innerText.trim() || "Problem";
        const smartName = `${ctx.week}-${ctx.typeStr}-${probName}`.replace(/[\\/:*?"<>|☆]/g, '').replace(/\s+/g, '_');

        btn.disabled = true;

        try {
            const zip = new JSZip();
            const root = zip.folder(smartName);

            // 1. 导出题目说明与输入样例
            const descBody = document.querySelector('.markdown-body');
            const descText = descBody?.innerText || "";
            root.file("Problem_Description.md", descText);

            const testData = extractTestCases(descText);
            if (testData) {
                root.file("in.txt", testData);
            }

            // 创建两个独立的文件夹
            const practiceFolder = root.folder("1-Practice_Workspace"); // 练习区
            const solutionFolder = root.folder("2-My_Solutions");       // 答案区

            const tabs = Array.from(document.querySelectorAll('.code-block-item')).filter(t => t.innerText.includes('.'));

            for (let tab of tabs) {
                const fName = tab.firstChild.textContent.trim();
                const isLocked = !!tab.querySelector('.anticon-lock'); // 判断是否为只读锁定的文件
                btn.innerHTML = `抓取中: ${fName}`;

                const editors = monaco.editor.getEditors();
                const oldStates = editors.map(ed => ed.getModel()?.id);

                tab.scrollIntoView();
                tab.click();

                for (let i = 0; i < 20; i++) {
                    await sleep(150);
                    const currentEditors = monaco.editor.getEditors();
                    if (tab.classList.contains('active') && currentEditors.some((ed, idx) => ed.getModel()?.id !== oldStates[idx])) break;
                }
                await sleep(250);

                const currentEditors = monaco.editor.getEditors();
                const finalContent = getActiveEditorValue(currentEditors);

                // --- 写入【答案参考区】：保留全部完整代码 ---
                solutionFolder.file(fName, finalContent);

                // --- 写入【练习区】：按文件属性处理 ---
                if (isLocked) {
                    // 如果是锁定的辅助文件或测试主程序，保留完整内容以便编译
                    practiceFolder.file(fName, finalContent);
                } else {
                    // 如果是用户需要实现的文件，清空内容供练习，并自动生成基础头文件引入
                    let practiceTemplate = `// TODO: 请在此处手写你的代码实现\n`;
                    if (fName.endsWith('.cpp')) {
                        const possibleHeader = fName.replace('.cpp', '.h');
                        // 检查是否存在同名的 .h 头文件，有则自动 include
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

            const blob = await zip.generateAsync({type: "blob"});
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

    function injectButton() {
        if (document.getElementById('matrix-download-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'matrix-download-btn';
        btn.innerHTML = '📂 导出题目';
        btn.style = "position:fixed; bottom:50px; right:30px; z-index:99999; padding:12px 24px; background:#0A4749; color:white; border:none; border-radius:30px; cursor:pointer; font-weight:bold; box-shadow: 0 4px 15px rgba(0,0,0,0.3);";
        document.body.appendChild(btn);
        btn.onclick = () => getPageMode() === 'coding' ? runCodingExport() : alert('当前不是代码题页面');
    }
    setInterval(injectButton, 2000);
})();
