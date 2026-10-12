@echo off
title Afterbell — localhost test
color 0B

echo.
echo  ============================================
echo   AFTERBELL — start the backend + open the app
echo  ============================================
echo.

rem --- where everything lives ---
set "ROOT=%~dp0"
set "API=%ROOT%NBackend"
set "WEB=%ROOT%Web\index.html"

rem --- is something already on 4000? if so, do not start a second one ---
netstat -ano | findstr /r /c:":4000 .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
    echo  [ok] something is already listening on port 4000 — reusing it.
) else (
    echo  [..] starting the API in a new window...
    start "Afterbell API" cmd /k "cd /d "%API%" && echo. && npm start && echo. && echo --- server stopped, this window stays open for errors ---"
    echo  [..] waiting for it to come up...
    timeout /t 6 /nobreak >nul
)

rem --- confirm it answers before opening anything ---
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:4000/health' -UseBasicParsing -TimeoutSec 5; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [fail] the API did not answer on http://127.0.0.1:4000/health
    echo.
    echo         check the other window for an error. common causes:
    echo           - MongoDB download still in progress on first ever run
    echo           - port 4000 taken by something else
    echo.
    pause
    exit /b 1
)

echo  [ok] API is answering.
echo.
echo  opening the frontend and the health page...
echo.

rem --- open both. frontend first, then health as a second tab ---
start "" "%WEB%"
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:4000/health"

echo  ============================================
echo   WHAT TO DO NOW
echo  ============================================
echo.
echo  1. In the app: unlock the calculator (type 0 / 0), then at the
echo     invite gate skip or use a demo code.
echo.
echo  2. Connect the backend:
echo       Settings  -^>  Backend  -^>  Endpoint
echo       click "Use localhost:4000", then "Test and save"
echo.
echo  3. Reload the page. Go through the gate again with a real code:
echo       DEMO-AAAA-1111   (then DEMO-BBBB-2222 for a second user)
echo.
echo  4. Post something. It goes in as PENDING.
echo.
echo  5. Open the app in a second browser or an incognito window.
echo     Connect it too, and sign in as a moderator:
echo       the seeded mod is "meera" — but you need a code, so the
echo       easier test is to approve from the SAME window:
echo       Moderation screen shows "Posts awaiting review".
echo.
echo  6. Approve. Switch back to the feed. It is live.
echo.
echo  The server window stays open. Close it to stop the API.
echo  ============================================
echo.
pause
