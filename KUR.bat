@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title Snxcord kurulum / installer

echo ============================================
echo   Snxcord kurulum
echo   (Bu pencereyi kapatma, bitince haber verir)
echo ============================================
echo.

if not exist "package.json" (
    echo [HATA] package.json bulunamadi.
    echo Bu dosya, Snxcord klasorunun ICINDE calistirilmali.
    echo ZIP'i cikardiktan sonra acilan klasorun icindeki KUR.bat'a cift tikla.
    pause
    exit /b 1
)

echo [1/4] Node.js kontrol ediliyor...
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [!] Node.js yuklu degil. Kurulum sayfasi aciliyor.
    echo     LTS surumunu kur, sonra bu dosyayi TEKRAR calistir.
    start https://nodejs.org/en/download
    pause
    exit /b 1
)
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODEV=%%a
if "%NODEV%"=="" for /f "tokens=1 delims=." %%a in ('node -v') do set NODEV=%%a
if %NODEV% LSS 22 (
    echo [HATA] Node.js 22 veya ustu gerekli. Senin surumun:
    node -v
    echo https://nodejs.org adresinden guncelle.
    pause
    exit /b 1
)

echo [2/4] pnpm kontrol ediliyor...
where pnpm >nul 2>nul
if errorlevel 1 (
    echo pnpm kuruluyor...
    call npm install -g pnpm@12.16.1
    if errorlevel 1 (
        echo [HATA] pnpm kurulamadi.
        pause
        exit /b 1
    )
)

echo [3/4] Paketler indiriliyor ve derleniyor (birkac dakika surebilir)...
call pnpm install --frozen-lockfile
if errorlevel 1 goto hata
call pnpm build
if errorlevel 1 goto hata

echo [4/4] Discord'a kuruluyor...
echo (Acilan pencerede kendi Discord'unu sec)
call pnpm inject
if errorlevel 1 goto hata

echo.
echo ============================================
echo   BITTI! Discord'u tamamen kapatip yeniden ac.
echo   Ayarlarda "Snxcord" bolumu gorunecek.
echo ============================================
pause
exit /b 0

:hata
echo.
echo [HATA] Bir adim basarisiz oldu. Yukaridaki hatayi kontrol et.
echo Internet baglantini kontrol et ve tekrar dene.
pause
exit /b 1
