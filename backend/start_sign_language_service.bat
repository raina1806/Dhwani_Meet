@echo off
echo Starting Sign Language Recognition Service...
echo.
cd /d %~dp0
call venv\Scripts\activate.bat
python sign_language_service.py
pause

