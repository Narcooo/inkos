; InkOS Studio — NSIS Installer Script
; Builds a Setup.exe that installs exe + public/ to Program Files,
; creates shortcuts, and supports silent uninstall + overlay upgrades.
; User data in %USERPROFILE%\.inkos\ is NEVER touched.

!include "MUI2.nsh"
!include "FileFunc.nsh"

; ── Metadata ──
!define PRODUCT_NAME    "InkOS Studio"
!define PRODUCT_VERSION "0.1.0"
!define PRODUCT_PUBLISHER "InkOS"
!define PRODUCT_EXE     "inkos-studio.exe"
!define INSTALL_DIR     "$PROGRAMFILES\InkOS Studio"
!define UNINST_KEY      "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "dist\InkOS-Studio-Setup-${PRODUCT_VERSION}.exe"
InstallDir "${INSTALL_DIR}"
InstallDirRegKey HKLM "${UNINST_KEY}" "InstallLocation"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

; ── UI ──
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

; ── Install Section ──
Section "Install"
  SetOutPath "$INSTDIR"

  ; Kill running instance before overwrite
  ExecWait 'taskkill /F /IM ${PRODUCT_EXE} /T'

  ; Core files
  File "dist\${PRODUCT_EXE}"

  ; Static web assets
  SetOutPath "$INSTDIR\public"
  File /r "dist\public\*.*"

  ; Reset output path
  SetOutPath "$INSTDIR"

  ; Uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Registry — Add/Remove Programs entry
  WriteRegStr   HKLM "${UNINST_KEY}" "DisplayName"     "${PRODUCT_NAME}"
  WriteRegStr   HKLM "${UNINST_KEY}" "DisplayVersion"  "${PRODUCT_VERSION}"
  WriteRegStr   HKLM "${UNINST_KEY}" "Publisher"        "${PRODUCT_PUBLISHER}"
  WriteRegStr   HKLM "${UNINST_KEY}" "InstallLocation"  "$INSTDIR"
  WriteRegStr   HKLM "${UNINST_KEY}" "UninstallString"  "$INSTDIR\uninstall.exe"
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1

  ; Compute installed size
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKLM "${UNINST_KEY}" "EstimatedSize" $0

  ; Start Menu shortcuts
  CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
  CreateShortCut  "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}"
  CreateShortCut  "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk"       "$INSTDIR\uninstall.exe"

  ; Desktop shortcut
  CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_EXE}"
SectionEnd

; ── Uninstall Section ──
Section "Uninstall"
  ; Kill running instance
  ExecWait 'taskkill /F /IM ${PRODUCT_EXE} /T'

  ; Remove installed files (NOT user data in ~/.inkos/)
  RMDir /r "$INSTDIR\public"
  Delete   "$INSTDIR\${PRODUCT_EXE}"
  Delete   "$INSTDIR\uninstall.exe"
  RMDir    "$INSTDIR"

  ; Shortcuts
  Delete  "$DESKTOP\${PRODUCT_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${PRODUCT_NAME}"

  ; Registry
  DeleteRegKey HKLM "${UNINST_KEY}"
SectionEnd
