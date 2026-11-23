!macro customInit
  ${GetFileExt} "${APP_ID}" $1
  ${If} $1 == "dev"
  ${OrIf} $1 == "stg"
  ${OrIf} $1 == "local"
    !insertmacro selectPreviewDirectory
  ${EndIf}
  !insertmacro checkOtherInstaller "$perUserInstallationFolder"
  !insertmacro checkOtherInstaller "$INSTDIR"
!macroend

!macro selectPreviewDirectory
  # A legacy preview uninstaller could remove Production's files from the shared directory.
  ${GetFileName} "$perUserInstallationFolder" $0
  ${If} $0 == "${APP_FILENAME}"
    MessageBox MB_OK|MB_ICONSTOP "Remove the older preview versions from Windows Installed apps before continuing. If Production shared that folder, reinstall Production before installing this preview." /SD IDOK
    !insertmacro quitSharedInstall
  ${EndIf}
  !insertmacro GetDParameter $0
  ${If} $0 != ""
    ${GetFileName} "$INSTDIR" $0
    ${If} $0 == "${APP_FILENAME}"
      MessageBox MB_OK|MB_ICONSTOP "Choose a different folder with /D. The selected folder name is reserved for Production." /SD IDOK
      !insertmacro quitSharedInstall
    ${EndIf}
  ${ElseIf} $perUserInstallationFolder == ""
    ${GetParent} "$INSTDIR" $0
    StrCpy $INSTDIR "$0\${APP_FILENAME}-$1"
  ${EndIf}
!macroend

!macro checkOtherInstaller DIRECTORY
  ${If} "${DIRECTORY}" != ""
    ClearErrors
    FindFirst $2 $3 "${DIRECTORY}\Uninstall Inheriti*.exe"
    ${IfNot} ${Errors}
      ${DoUntil} ${Errors}
        ${If} $3 != "${UNINSTALL_FILENAME}"
          FindClose $2
          MessageBox MB_OK|MB_ICONSTOP "Another Inheriti installation uses this folder. Choose a different folder if using /D. If an older preview shared this folder, remove the preview versions in Windows Installed apps before reinstalling." /SD IDOK
          !insertmacro quitSharedInstall
        ${EndIf}
        FindNext $2 $3
      ${Loop}
      FindClose $2
    ${EndIf}
    ClearErrors
  ${EndIf}
!macroend

!macro quitSharedInstall
  SetErrorLevel 2
  Quit
!macroend
