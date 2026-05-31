@echo off
title QRAttend Pro Launcher
cls

echo =============================================================
echo               QRAttend Pro - Attendance System
echo =============================================================
echo.

set NODE_PATH="C:\Users\ANUSHKA S\AppData\Local\ms-playwright-go\1.57.0\node.exe"

if exist %NODE_PATH% (
    echo [OK] Located embedded Node.js environment.
    echo [INFO] Starting attendance local database server...
    
    :: Start the Node server in a minimized window so it stays running
    start /min "QRAttend Server" %NODE_PATH% server.js
    
    :: Wait 1.5 seconds for the server to bind to port 3000
    timeout /t 2 /nobreak >nul
    
    echo [INFO] Launching Scanner Console in web browser...
    start http://localhost:3000
    
    echo.
    echo [SUCCESS] Application started!
    echo [INFO] Keep this launcher window open, or close it when done.
    echo.
) else (
    echo [WARNING] Embedded Node.js runtime not found at:
    echo %NODE_PATH%
    echo.
    echo [INFO] Falling back to Client-Only mode.
    echo [INFO] In Client-Only mode, logs will be saved to your browser cache.
    echo [INFO] You can click the "Export" buttons to download Excel/CSV files.
    echo.
    echo Press any key to open the application in your browser...
    pause >nul
    
    start index.html
)
echo =============================================================
timeout /t 5 >nul
exit
