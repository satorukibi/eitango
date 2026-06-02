netsh advfirewall firewall add rule name="Eitango HTTP 8000" dir=in action=allow protocol=TCP localport=8000
echo DONE > "%TEMP%\eitango_fw_done2.txt"
