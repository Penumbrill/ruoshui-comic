Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"
Name "若水漫画"
OutFile "${OUTPUT_EXE}"
InstallDir "$LOCALAPPDATA\Programs\若水漫画"
InstallDirRegKey HKCU "Software\RuoshuiComic" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
Icon "${PROJECT_ROOT}\assets\app-icon.ico"
UninstallIcon "${PROJECT_ROOT}\assets\app-icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\若水漫画.exe"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"
Section "安装"
 InitPluginsDir
 SetOutPath "$PLUGINSDIR"
 File /oname=download-release.ps1 "${PROJECT_ROOT}\scripts\download-release.ps1"
 File /oname=release-packages.json "${PACKAGE_MANIFEST}"
 File /oname=manage-user-path.ps1 "${PROJECT_ROOT}\assets\manage-user-path.ps1"
 DetailPrint "检测网络并下载程序与独立运行环境；不含模型。失败后可再次运行以继续下载。"
 nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\download-release.ps1" -Target "$INSTDIR" -Manifest "$PLUGINSDIR\release-packages.json"'
 Pop $0
 ${If} $0 != 0
  MessageBox MB_ICONSTOP "下载或安装未完成。请检查网络后重试；已下载内容可继续使用。"
  SetErrorLevel 1
  Abort
 ${EndIf}
 SetOutPath "$INSTDIR"
 WriteUninstaller "$INSTDIR\Uninstall若水漫画.exe"
 CreateShortcut "$DESKTOP\若水漫画.lnk" "$INSTDIR\若水漫画.exe"
 CreateDirectory "$SMPROGRAMS\若水漫画"
 CreateShortcut "$SMPROGRAMS\若水漫画\若水漫画.lnk" "$INSTDIR\若水漫画.exe"
 CreateShortcut "$SMPROGRAMS\若水漫画\卸载.lnk" "$INSTDIR\Uninstall若水漫画.exe"
 WriteRegStr HKCU "Software\RuoshuiComic" "InstallLocation" "$INSTDIR"
 nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\manage-user-path.ps1" -Mode Add -Target "$INSTDIR"'
 Pop $0
 ${If} $0 != 0
  MessageBox MB_ICONEXCLAMATION "软件已安装，但未能更新当前用户 PATH。请检查系统环境变量权限。"
 ${EndIf}
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RuoshuiComic" "DisplayName" "若水漫画"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RuoshuiComic" "UninstallString" '$\"$INSTDIR\Uninstall若水漫画.exe$\"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RuoshuiComic" "InstallLocation" "$INSTDIR"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RuoshuiComic" "DisplayIcon" "$INSTDIR\若水漫画.exe"
SectionEnd
Section "Uninstall"
 StrCpy $R6 "true"
 StrCpy $R7 "true"
 MessageBox MB_YESNO|MB_DEFBUTTON1 "是否保留已经下载的全部模型？" IDYES +2
  StrCpy $R6 "false"
 MessageBox MB_YESNO|MB_DEFBUTTON1 "是否保留图片、漫画、聊天、词库与设置？" IDYES +2
  StrCpy $R7 "false"
 InitPluginsDir
 SetOutPath "$PLUGINSDIR"
 File /oname=manage-user-path.ps1 "${PROJECT_ROOT}\assets\manage-user-path.ps1"
 nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\manage-user-path.ps1" -Mode Remove -Target "$INSTDIR"'
 Pop $0
 ${If} $0 != 0
  Abort "无法移除本软件的 PATH 项，文件已保留。请检查环境变量权限后重试。"
 ${EndIf}
 FileOpen $0 "$PLUGINSDIR\uninstall.json" w
 FileWriteWord $0 0xFEFF
 FileWriteUTF16LE $0 '{"appId":"com.guangyingruoshui.comic","keepModels":$R6,"keepWorks":$R7}'
 FileClose $0
 nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\app.asar.unpacked\assets\uninstall-wrapper.ps1" -Root "$INSTDIR" -Plan "$PLUGINSDIR\uninstall.json" -Helper "$INSTDIR\resources\app.asar.unpacked\assets\maintain-installation.ps1"'
 Pop $0
 ${If} $0 != 0
  Abort "卸载未完成，文件已保留。关闭软件后重试。"
 ${EndIf}
 Delete "$DESKTOP\若水漫画.lnk"
 Delete "$SMPROGRAMS\若水漫画\若水漫画.lnk"
 Delete "$SMPROGRAMS\若水漫画\卸载.lnk"
 RMDir "$SMPROGRAMS\若水漫画"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\RuoshuiComic"
 DeleteRegKey HKCU "Software\RuoshuiComic"
 Delete /REBOOTOK "$INSTDIR\Uninstall若水漫画.exe"
 RMDir "$INSTDIR"
SectionEnd
