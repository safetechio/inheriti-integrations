!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHELL_CONTEXT "Software\Classes\Inheriti® protected file\DefaultIcon" "" "$\"$INSTDIR\inheriti.ico$\""
  !insertmacro UPDATEFILEASSOC
!macroend
