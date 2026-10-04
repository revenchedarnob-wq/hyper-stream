; Uninstall: remove the browser extension's link to the app (it is registered again on start).
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\com.hyperstream.bridge"
    DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\com.hyperstream.bridge"
    DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.hyperstream.bridge"
    DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\com.hyperstream.bridge"
  ${EndIf}
!macroend
