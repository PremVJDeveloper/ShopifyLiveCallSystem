@echo off
REM ================================================================
REM  deploy.bat — Windows deployment script
REM  Run from your project folder: deploy\deploy.bat
REM  Usage: deploy\deploy.bat YOUR_EC2_IP path\to\key.pem
REM  Example: deploy\deploy.bat 13.234.56.78 C:\Users\HP\Downloads\vaama-key.pem
REM ================================================================

setlocal

SET EC2_IP=%1
SET KEY_FILE=%2
SET REMOTE_USER=ubuntu
SET REMOTE_DIR=/home/ubuntu/app
SET LOCAL_DIR=%~dp0..

IF "%EC2_IP%"=="" (
    echo.
    echo  ERROR: Missing EC2 IP
    echo  Usage: deploy.bat ^<EC2_IP^> ^<path_to_key.pem^>
    echo  Example: deploy.bat 13.234.56.78 C:\Users\HP\Downloads\vaama-key.pem
    echo.
    pause
    exit /b 1
)

IF "%KEY_FILE%"=="" (
    echo.
    echo  ERROR: Missing key file path
    pause
    exit /b 1
)

echo.
echo ╔══════════════════════════════════════════════╗
echo ║   Deploying to AWS EC2: %EC2_IP%
echo ╚══════════════════════════════════════════════╝
echo.

echo ▶ Step 1/3: Syncing files to EC2...
echo    (excludes node_modules, .git, data folder, logs)

REM Use rsync via ssh if available, otherwise scp
rsync -avz --progress ^
    --exclude="node_modules/" ^
    --exclude=".git/" ^
    --exclude="data/" ^
    --exclude="logs/" ^
    --exclude=".env" ^
    -e "ssh -i %KEY_FILE% -o StrictHostKeyChecking=no" ^
    "%LOCAL_DIR%/" ^
    "%REMOTE_USER%@%EC2_IP%:%REMOTE_DIR%/" 2>nul

IF ERRORLEVEL 1 (
    echo    rsync not found, using scp...
    scp -i "%KEY_FILE%" -o StrictHostKeyChecking=no -r ^
        "%LOCAL_DIR%\public" ^
        "%LOCAL_DIR%\src" ^
        "%LOCAL_DIR%\server.js" ^
        "%LOCAL_DIR%\package.json" ^
        "%LOCAL_DIR%\package-lock.json" ^
        "%LOCAL_DIR%\ecosystem.config.js" ^
        "%LOCAL_DIR%\.env.example" ^
        "%LOCAL_DIR%\deploy" ^
        "%REMOTE_USER%@%EC2_IP%:%REMOTE_DIR%/"
)

echo.
echo ▶ Step 2/3: Uploading .env file...
IF EXIST "%LOCAL_DIR%\.env.production" (
    scp -i "%KEY_FILE%" -o StrictHostKeyChecking=no ^
        "%LOCAL_DIR%\.env.production" ^
        "%REMOTE_USER%@%EC2_IP%:%REMOTE_DIR%/.env"
    echo    ✅ .env.production uploaded as .env
) ELSE (
    echo    ⚠  No .env.production found — you must create it on the server.
    echo       SSH in and run: nano ~/app/.env
)

echo.
echo ▶ Step 3/3: Restarting app on server...
ssh -i "%KEY_FILE%" -o StrictHostKeyChecking=no "%REMOTE_USER%@%EC2_IP%" ^
    "cd %REMOTE_DIR% && npm install --production --silent && pm2 restart livecall 2>/dev/null || pm2 start ecosystem.config.js && pm2 save"

echo.
echo ╔══════════════════════════════════════════════╗
echo ║   ✅ Deployment complete!                    ║
echo ╚══════════════════════════════════════════════╝
echo.
echo   App URL  : http://%EC2_IP%
echo   Admin    : http://%EC2_IP%/admin
echo   SSH in   : ssh -i %KEY_FILE% ubuntu@%EC2_IP%
echo   Logs     : ssh in → pm2 logs livecall
echo.
pause
