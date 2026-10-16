; Updating must never run electron-builder's recursive default removal: models
; and all creations live beside the application in a portable installation.
!macro preInit
  ReadRegStr $0 HKCU "Software\RuoshuiComic" "InstallLocation"
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\ruoshui-installation.json"
    StrCpy $INSTDIR $0
  ${EndIf}
!macroend

!macro customInstall
  WriteRegStr HKCU "Software\RuoshuiComic" "InstallLocation" "$INSTDIR"
  FileOpen $0 "$INSTDIR\ruoshui-installation.json" w
  FileWriteWord $0 0xFEFF
  FileWriteUTF16LE $0 '{"appId":"com.guangyingruoshui.comic","version":"${VERSION}"}'
  FileClose $0
!macroend

!macro customRemoveFiles
  ${If} ${isUpdated}
    DetailPrint "保留模型与创作文件，正在更新程序文件。"
  ${Else}
    StrCpy $R6 "true"
    StrCpy $R7 "true"
    MessageBox MB_YESNO|MB_DEFBUTTON1 "是否保留已经下载的全部模型？" IDYES +2
      StrCpy $R6 "false"
    MessageBox MB_YESNO|MB_DEFBUTTON1 "是否保留图片、漫画、聊天、词库与设置？" IDYES +2
      StrCpy $R7 "false"
    InitPluginsDir
    CopyFiles /SILENT "$INSTDIR\resources\app.asar.unpacked\assets\maintain-installation.ps1" "$PLUGINSDIR\maintain-installation.ps1"
    FileOpen $0 "$PLUGINSDIR\ruoshui-uninstall.json" w
    FileWriteWord $0 0xFEFF
    ; Installation roots are encoded by PowerShell rather than interpolated in JSON.
    FileWriteUTF16LE $0 '{"appId":"com.guangyingruoshui.comic","keepModels":$R6,"keepWorks":$R7}'
    FileClose $0
    ; The root is supplied as a literal argument to the helper wrapper.
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\app.asar.unpacked\assets\uninstall-wrapper.ps1" -Root "$INSTDIR" -Plan "$PLUGINSDIR\ruoshui-uninstall.json" -Helper "$PLUGINSDIR\maintain-installation.ps1"'
    Pop $0
    ${If} $0 != 0
      Abort "卸载未完成，文件已保留。请关闭占用本软件文件的程序后重试。"
    ${EndIf}
    Delete /REBOOTOK "$INSTDIR\${UNINSTALL_FILENAME}"
    RMDir "$INSTDIR"
    DeleteRegKey HKCU "Software\RuoshuiComic"
  ${EndIf}
!macroend
