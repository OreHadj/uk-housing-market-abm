# electron-builder 26.8.1 appends APP_FILENAME in instFilesPre. Assisted setup
# uses "UK Housing Model", whereas old one-click installs used the package name.
# Preserve a registered destination when the user leaves it unchanged. New or
# deliberately changed destinations still get the upstream app-subfolder guard.
# The hook runs before MUI_PAGE_INSTFILES; silent setup already retains the path.
!macro customPageAfterChangeDir
  !undef MUI_PAGE_CUSTOMFUNCTION_PRE
  !define MUI_PAGE_CUSTOMFUNCTION_PRE housingPreserveInstallDirectory

  Function housingPreserveInstallDirectory
    Push $R0
    Push $R1
    ReadRegStr $R0 SHCTX "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $R0 != ""
      ${If} $R0 == $INSTDIR
        Goto directoryReady
      ${EndIf}
      GetFullPathName $R0 "$R0"
      GetFullPathName $R1 "$INSTDIR"
      # A failed normalization can return an empty string for a missing path.
      ${If} $R0 != ""
      ${AndIf} $R0 == $R1
        Goto directoryReady
      ${EndIf}
    ${EndIf}
    Call instFilesPre
    directoryReady:
    ClearErrors
    Pop $R1
    Pop $R0
  FunctionEnd
!macroend
