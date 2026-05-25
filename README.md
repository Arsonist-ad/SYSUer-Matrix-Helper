# SYSUer-Matrix-Helper
中山大学 Matrix 平台辅助工具，支持编程题目打包下载及理论题自动翻页导出 Word。

由vibe-coding获得

# Matrix SYSU Helper 🎓

这是一个为中山大学 Matrix 在线评测系统打造的油猴脚本 (Tampermonkey Script)。

## ✨ 主要功能
- **编程题一键打包**：自动识别 solution.cpp, messages.h 等所有文件，按周次和题目名打包为 ZIP（这个时候解压之后就可以直接用vscode打开变成做题区了？）。
- **理论题 Word 导出**：支持自动翻页，将所有题目、选项及标准答案导出为排版整齐的 .doc 文档，导出排版可能丑丑的但是懒得改了（体谅一下。
- **智能命名系统**：自动解析页面中的“周次”和“课堂/课后”信息。
- **静默运行**：仅在题目详情页显示按钮，保持界面清爽。

## 🚀 安装方法
1. 首先安装浏览器插件 [Tampermonkey](https://www.tampermonkey.net/)。
2. 导入该脚本（最好再来一下ctrl+s保存？）。
3. 刷新 Matrix 页面即可使用。


## ⚖️ 开源协议
基于 MIT License 开源。
