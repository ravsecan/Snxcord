@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Snxcord kurulum

echo ============================================
echo   Snxcord kurulum
echo   (Bitene kadar bu pencereyi kapatma)
echo ============================================
echo.

if not exist "package.json" (
    echo [HATA] package.json bulunamadi.
    echo ZIP'i cikardiktan sonra, acilan klasorun ICINDEKI KUR.bat'a cift tikla.
    echo.
    pause
    exit /b 1
)

echo [1/4] Node.js kontrol ediliyor...
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [!] Node.js yuklu degil. Indirme sayfasi aciliyor.
    echo     LTS surumunu kur, sonra bu dosyayi TEKRAR calistir.
    start https://nodejs.org/en/download
    echo.
    pause
    exit /b 1
)

for /f "tokens=1 delims=v." %%a in ('node -v') do set NODEV=%%a
if %NODEV% LSS 22 (
    echo [HATA] Node.js 22 veya ustu gerekli. Senin surumun:
    node -v
    echo https://nodejs.org adresinden guncelle.
    echo.
    pause
    exit /b 1
)

echo [2/4] pnpm kontrol ediliyor...
where pnpm >nul 2>nul
if errorlevel 1 (
    echo pnpm kuruluyor...
    call npm install -g pnpm@12.16.1
    if errorlevel 1 (
        echo [HATA] pnpm kurulamadi. Internet baglantini kontrol et.
        echo.
        pause
        exit /b 1
    )
)

echo [3/4] Paketler indiriliyor ve derleniyor (birkac dakika surebilir)...
call pnpm install --frozen-lockfile
if errorlevel 1 (
    echo [HATA] Paket kurulumu basarisiz. Internet baglantini kontrol edip tekrar dene.
    echo.
    pause
    exit /b 1
)
call pnpm build
if errorlevel 1 (
    echo [HATA] Derleme basarisiz oldu.
    echo.
    pause
    exit /b 1
)

echo [4/4] Discord'a kuruluyor... (Acilan pencerede kendi Discord'unu sec)
call pnpm inject
if errorlevel 1 (
    echo [HATA] Kurulum basarisiz oldu.
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   BITTI! Discord'u tamamen kapatip yeniden ac.
echo   Ayarlarda "Snxcord" bolumu gorunecek.
echo ============================================
echo.
pause
