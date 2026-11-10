; Lists Tabularis under "Open with" in Explorer for the data files it opens.
;
; Tauri's `bundle.fileAssociations` is not used on Windows: its installer makes
; the app the default handler of every listed extension and replaces their
; icon. Registering the executable's supported types only adds it to the
; "Open with" menu and leaves the user's defaults alone.

!define TABULARIS_APP_KEY "Software\Classes\Applications\${MAINBINARYNAME}.exe"

!macro TABULARIS_OPEN_WITH EXT
  WriteRegStr SHCTX "${TABULARIS_APP_KEY}\SupportedTypes" ".${EXT}" ""
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "${TABULARIS_APP_KEY}" "FriendlyAppName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${TABULARIS_APP_KEY}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  !insertmacro TABULARIS_OPEN_WITH "csv"
  !insertmacro TABULARIS_OPEN_WITH "tsv"
  !insertmacro TABULARIS_OPEN_WITH "tab"
  !insertmacro TABULARIS_OPEN_WITH "json"
  !insertmacro TABULARIS_OPEN_WITH "ndjson"
  !insertmacro TABULARIS_OPEN_WITH "jsonl"
  !insertmacro TABULARIS_OPEN_WITH "parquet"
  !insertmacro TABULARIS_OPEN_WITH "pq"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey SHCTX "${TABULARIS_APP_KEY}"
!macroend
