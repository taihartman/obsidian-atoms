-- Atoms Capture — append a markdown bullet to today's Daily Note
property vaultPath : (POSIX path of (path to home folder)) & "Documents/Remote Vault"
property dailyFolder : "Quick Notes"

on run argv
	try
		set captureText to ""
		if (count of argv) > 0 then
			set captureText to item 1 of argv as text
		end if
		if captureText is "" then
			set captureText to text returned of (display dialog "Capture for Atoms" default answer "" with title "Atoms Capture" buttons {"Cancel", "Save"} default button "Save")
		end if
		if captureText is "" then return
		my appendBullet(captureText)
		display notification "Saved to daily note" with title "Atoms Capture"
	on error errMsg number errNum
		if errNum is -128 then return
		display alert "Atoms Capture failed" message errMsg
	end try
end run

on appendBullet(captureText)
	set todayStamp to do shell script "date +%Y-%m-%d"
	set dailyPath to vaultPath & "/" & dailyFolder & "/" & todayStamp & ".md"
	do shell script "mkdir -p " & quoted form of (vaultPath & "/" & dailyFolder)
	do shell script "printf '%s\\n' " & quoted form of ("- " & captureText) & " >> " & quoted form of dailyPath
end appendBullet
