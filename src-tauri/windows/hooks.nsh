; glasshouse's NSIS installer hooks (tauri.conf.json: bundle.windows.nsis.installerHooks).
;
; Uninstalling turns "Open folders with glasshouse" off, as Preferences ->
; Integration does (off_ops in src-tauri/src/commands/integration_win.rs),
; so folders still open after glasshouse is gone. An update runs the old
; uninstaller with /UPDATE, which leaves it on. The MSI does the same in
; windows/integration.wxs.

; A key under HKCU, if nothing is left in it: no subkeys, no named values
; and no default value. (Index 0 can be the default value, whose name is
; empty, so index 1 is checked too.)
!macro GLASSHOUSE_DELETE_IF_EMPTY KEY
  EnumRegKey $R2 HKCU "${KEY}" 0
  EnumRegValue $R3 HKCU "${KEY}" 0
  EnumRegValue $R4 HKCU "${KEY}" 1
  ReadRegStr $R5 HKCU "${KEY}" ""
  ${If} $R2 == ""
  ${AndIf} $R3 == ""
  ${AndIf} $R4 == ""
  ${AndIf} $R5 == ""
    DeleteRegKey HKCU "${KEY}"
  ${EndIf}
!macroend

; One shell key (Directory or Drive): put back the default verb we replaced,
; unless someone has set another since, then remove our verb.
!macro GLASSHOUSE_FOLDERS_OFF CLASS
  ReadRegStr $R0 HKCU "Software\Classes\${CLASS}\shell" ""
  ${If} $R0 == "glasshouse"
    ReadRegStr $R1 HKCU "Software\Classes\${CLASS}\shell\glasshouse" "GlasshousePreviousDefault"
    ${If} $R1 != ""
      WriteRegStr HKCU "Software\Classes\${CLASS}\shell" "" $R1
    ${Else}
      DeleteRegValue HKCU "Software\Classes\${CLASS}\shell" ""
    ${EndIf}
  ${EndIf}
  DeleteRegKey HKCU "Software\Classes\${CLASS}\shell\glasshouse"
  !insertmacro GLASSHOUSE_DELETE_IF_EMPTY "Software\Classes\${CLASS}\shell"
  !insertmacro GLASSHOUSE_DELETE_IF_EMPTY "Software\Classes\${CLASS}"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    !insertmacro GLASSHOUSE_FOLDERS_OFF "Directory"
    !insertmacro GLASSHOUSE_FOLDERS_OFF "Drive"
    ; SHCNE_ASSOCCHANGED, so Explorer stops using the old verb.
    System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ${EndIf}
!macroend
