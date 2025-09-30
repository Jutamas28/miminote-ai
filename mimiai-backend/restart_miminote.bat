@echo off
title Restart MimiNote.AI (server + tunnel)
echo == Stop old tunnels / processes ==
REM ปิด ngrok / cloudflared ถ้ามี
taskkill /IM ngrok.exe /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1

REM ปิด localtunnel (lt รันบน node)
taskkill /IM node.exe /F >nul 2>&1

REM เคลียร์โปรเซสที่จับพอร์ต 5051 (ถ้ามี)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :5051') do (
  echo Killing PID %%p on :5051
  taskkill /PID %%p /F >nul 2>&1
)

echo.
echo == Set Basic Auth for server (change these!) ==
set "BASIC_USER=mimiuser"
set "BASIC_PASS=mimipass123"

echo.
echo == Start server ==
start "" cmd /k "set BASIC_USER=%miminote%&& set BASIC_PASS=%miminote%&& npm start"

echo.
echo == Start LocalTunnel ==
REM เปลี่ยนชื่อ subdomain ได้ตามใจ (ต้องไม่ซ้ำ)
start "" cmd /k "npx localtunnel --port 5051 --subdomain miminoteai2003"

echo.
echo Done! Share: https://miminoteai2003.loca.lt
echo (หากชื่อซ้ำ ให้ปิดหน้าต่าง tunnel แล้วแก้ชื่อในไฟล์นี้ใหม่)
pause
