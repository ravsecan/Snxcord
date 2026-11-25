@echo off
chcp 65001 >nul
setlocal EnableExtensions
title Snxcord kurulum

echo ============================================
echo   Snxcord kurulum
echo   (Bitene kadar bu pencereyi kapatma)
echo ============================================
echo.

set "HERE=%~dp0"
set "INSTALL=%LOCALAPPDATA%\Snxcord"

REM === Her zaman KALICI klasore kur ===
REM Native Discord, Snxcord'u kurulum klasorunden yukler. Indirilen klasor
REM (Downloads/Temp) silinirse Discord "Cannot find module" ile cokertir.
REM Bu yuzden kaynagi %LOCALAPPDATA%\Snxcord icine kopyalayip ORADAN kuruyoruz;
REM boylece indirdigin klasoru silebilirsin, Discord yine calisir.
if /i "%HERE%"=="%INSTALL%\" goto build

echo Kalici klasore kuruluyor:
echo   %INSTALL%
echo.

if not exist "%INSTALL%" mkdir "%INSTALL%" >nul 2>nul
robocopy "%HERE%." "%INSTALL%" /E /XD node_modules dist .git /NFL /NDL /NJH /NJS /NC /NS /NP >nul

cd /d "%INSTALL%"
goto build

:build
cd /d "%INSTALL%"

if not exist "package.json" (
    echo [HATA] package.json bulunamadi.
    echo ZIP'i bir klasore CIKAR, sonra icindeki KUR.bat'a cift tikla.
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
echo Not: Acik Discord kapatiliyor.
taskkill /f /im Discord.exe >nul 2>nul
taskkill /f /im DiscordCanary.exe >nul 2>nul
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
echo.
echo   Snxcord su kalici klasore kuruldu:
echo   %INSTALL%
echo   Bu klasoru SILME. Ama indirdigin ZIP/klasoru
echo   simdi silebilirsin, Discord calismaya devam eder.
echo ============================================
echo.
pause
