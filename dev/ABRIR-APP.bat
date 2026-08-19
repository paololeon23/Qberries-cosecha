@echo off
cd /d "%~dp0\.."
start "" "%~dp0\..\index.html"
echo Abriendo QBerries Supervisores...
echo.
echo Si no ve cambios, pulse Ctrl+F5 en el navegador.
timeout /t 4 >nul
