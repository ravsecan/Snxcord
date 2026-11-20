@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Snxcord güncelle

echo ============================================
echo   Snxcord güncelle (yeniden kurmadan)
echo   En güncel sürümü indirir, derler.
echo ============================================
echo.

if not exist "package.json" (
    echo [HATA] package.json bulunamadi.
    echo Bu dosya Snxcord klasorunun ICINDE calistirilmali.
    echo.
    pause
    exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
    echo [!] Node.js yuklu degil. Indirme sayfasi aciliyor, kurduktan sonra tekrar calistir.
    start https://nodejs.org/en/download
    echo.
    pause
    exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 call npm install -g pnpm@12.16.1

echo [1/3] En güncel kod aliniyor...
if exist ".git\" (
    where git >nul 2>nul && (
        git pull
    ) || (
        echo [!] Git yok, ZIP ile guncelleniyor...
        call :zipupdate
    )
) else (
    call :zipupdate
)
if errorlevel 1 (
    echo [HATA] Guncel kod alinamadi. Internet baglantini kontrol et.
    echo.
    pause
    exit /b 1
)

echo [2/3] Paketler kontrol ediliyor...
call pnpm install
if errorlevel 1 (
    echo [HATA] Paket kurulumu basarisiz.
    echo.
    pause
    exit /b 1
)

echo [3/3] Derleniyor...
call pnpm build
if errorlevel 1 (
    echo [HATA] Derleme basarisiz.
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   GÜNCELLENDİ!
echo   Acik olan BÜTÜN Discord'lari (normal + Canary)
echo   gorev cubugundan da cikarak tamamen kapat, sonra ac.
echo   Yeniden kurmana / enjekte etmene GEREK YOK.
echo ============================================
echo.
pause
exit /b 0

:zipupdate
echo En güncel surum indiriliyor...
if exist "snx-update.zip" del /f /q snx-update.zip
curl -L -o snx-update.zip https://github.com/ravsecan/Snxcord/archive/refs/heads/main.zip
if errorlevel 1 exit /b 1
if exist "Snxcord-main" rmdir /s /q "Snxcord-main"
tar -xf snx-update.zip
if errorlevel 1 exit /b 1
rem node_modules ve .git haric her seyi uzerine kopyala
robocopy "Snxcord-main" "." /E /XD node_modules .git /NFL /NDL /NJH /NJS /nc /ns /np >nul
if errorlevel 8 exit /b 1
rmdir /s /q "Snxcord-main"
del /f /q snx-update.zip
exit /b 0
