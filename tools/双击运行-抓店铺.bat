@echo off
chcp 65001 >nul
title 独立站抓取工具
echo ==========================================
echo   独立站信息抓取（Shopify 目录 + 主图下载）
echo ==========================================
set /p url=请粘贴店铺链接（如 www.example.com）:
node "%~dp0fetch-site.mjs" "%url%"
echo.
echo 结果已存到本文件夹下的 site-data\ 里：
echo   summary.txt    ^> 复制进 DeepSeek「建联文案」对话
echo   main-image.*   ^> 手动插入 Excel
echo.
pause
